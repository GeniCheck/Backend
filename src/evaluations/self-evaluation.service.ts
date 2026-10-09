import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeclarationQuestionSnapshot, DeclarationResponse } from '@prisma/client';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { SnapshotOption } from '../declaration/declaration.constants';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitSelfEvaluationDto } from './dto/submit-self-evaluation.dto';
import { SCORE_MAX, SCORE_MIN, isValidScore } from './evaluation.constants';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class SelfEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLinkService: AccessLinkService,
    private readonly auditService: AuditService,
  ) {}

  /** 퇴사 직원이 링크로 자기평가 폼을 조회한다. 조회만으로는 링크를 소비하지 않는다. */
  async getForm(token: string) {
    const link = await this.accessLinkService.verify(token, 'SELF_EVALUATION');

    const evaluation = await this.prisma.evaluation.findUnique({
      where: { id: link.targetId },
      include: {
        employee: { select: { name: true } },
        items: {
          orderBy: { order: 'asc' },
          include: { snapshotQuestion: { include: { response: true } } },
        },
      },
    });
    if (!evaluation) {
      throw linkExpired();
    }
    if (evaluation.status !== 'SELF_PENDING') {
      throw new ConflictException({
        code: 'INVALID_EVALUATION_STATUS',
        message: '자기평가를 진행할 수 있는 상태가 아닙니다.',
        details: { status: evaluation.status },
      });
    }

    const company = await this.prisma.company.findUnique({
      where: { id: evaluation.companyId },
      select: { companyName: true },
    });

    return {
      evaluationId: evaluation.id,
      employee: { name: evaluation.employee.name, companyName: company?.companyName ?? null },
      status: evaluation.status,
      dueAt: evaluation.selfEvaluationDueAt,
      scoreMin: SCORE_MIN,
      scoreMax: SCORE_MAX,
      items: evaluation.items.map((item) => ({
        questionId: item.snapshotQuestionId,
        order: item.order,
        question: item.snapshotQuestion.text,
        declarationAnswer: toDeclarationAnswer(item.snapshotQuestion),
        selfScore: item.selfScore,
      })),
    };
  }

  /** 자기점수를 제출하고 대표 검증 단계(CEO_PENDING)로 넘긴다. 이후 수정할 수 없다. */
  async submit(token: string, dto: SubmitSelfEvaluationDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const link = await this.accessLinkService.verify(token, 'SELF_EVALUATION', tx);

      const evaluation = await tx.evaluation.findUnique({
        where: { id: link.targetId },
        include: { items: { select: { snapshotQuestionId: true } } },
      });
      if (!evaluation) {
        throw linkExpired();
      }
      if (evaluation.status !== 'SELF_PENDING') {
        throw alreadySubmitted();
      }

      assertAllItemsOnce(
        evaluation.items.map((item) => item.snapshotQuestionId),
        dto.items.map((item) => item.questionId),
      );

      const invalid = dto.items.filter((item) => !isValidScore(item.selfScore));
      if (invalid.length > 0) {
        throw new UnprocessableEntityException({
          code: 'INVALID_SCORE',
          message: `점수는 ${SCORE_MIN}~${SCORE_MAX} 사이의 정수여야 합니다.`,
          details: { questionIds: invalid.map((item) => item.questionId) },
        });
      }

      const submittedAt = new Date();

      // 동시 제출 시 하나만 통과 (SELF_PENDING일 때만 CEO_PENDING으로 전환)
      const { count } = await tx.evaluation.updateMany({
        where: { id: evaluation.id, status: 'SELF_PENDING' },
        data: { status: 'CEO_PENDING', selfSubmittedAt: submittedAt },
      });
      if (count === 0) {
        throw alreadySubmitted();
      }

      for (const item of dto.items) {
        await tx.evaluationItem.updateMany({
          where: { evaluationId: evaluation.id, snapshotQuestionId: item.questionId },
          data: { selfScore: item.selfScore },
        });
      }

      await this.accessLinkService.consume(link.id, tx);

      await this.auditService.log(
        {
          actorType: 'EMPLOYEE',
          actorId: evaluation.employeeId,
          action: 'SELF_EVALUATION_SUBMITTED',
          targetType: 'Evaluation',
          targetId: evaluation.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          metadata: { itemCount: dto.items.length },
        },
        tx,
      );

      return {
        evaluationId: evaluation.id,
        status: 'CEO_PENDING' as const,
        submittedAt,
        ceoEvaluationDueAt: evaluation.ceoEvaluationDueAt,
      };
    });
  }
}

/** 평가 항목이 빠짐없이, 한 번씩만 들어왔는지 확인 (없는 항목 포함 시에도 400) */
function assertAllItemsOnce(expectedIds: string[], receivedIds: string[]): void {
  const expected = new Set(expectedIds);
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const unknown: string[] = [];

  for (const id of receivedIds) {
    if (seen.has(id)) duplicated.add(id);
    seen.add(id);
    if (!expected.has(id)) unknown.push(id);
  }
  const missing = expectedIds.filter((id) => !seen.has(id));

  if (missing.length > 0 || duplicated.size > 0 || unknown.length > 0) {
    throw new BadRequestException({
      code: 'MISSING_EVALUATION_ITEM',
      message: '모든 평가 항목에 한 번씩 점수를 입력해야 합니다.',
      details: { missing, duplicated: [...duplicated], unknown },
    });
  }
}

/** 자기선언 때 직원이 한 답변. 미응답이면 값은 null (자기평가·대표 검증 폼 공용) */
export function toDeclarationAnswer(
  snapshot: DeclarationQuestionSnapshot & { response: DeclarationResponse | null },
) {
  const response = snapshot.response;
  switch (snapshot.type) {
    case 'SCORE':
      return { type: 'SCORE' as const, score: response?.answerScore ?? null };
    case 'SINGLE_CHOICE': {
      const options = (snapshot.options as SnapshotOption[] | null) ?? [];
      const option = options.find((o) => o.optionId === response?.answerOptionId);
      return { type: 'SINGLE_CHOICE' as const, optionId: option?.optionId ?? null, label: option?.label ?? null };
    }
    case 'TEXT':
      return { type: 'TEXT' as const, text: response?.answerText ?? null };
  }
}

function alreadySubmitted(): ConflictException {
  return new ConflictException({
    code: 'ALREADY_SUBMITTED',
    message: '이미 자기평가를 제출했습니다.',
  });
}

function linkExpired(): GoneException {
  return new GoneException({
    code: 'LINK_EXPIRED',
    message: '만료되었거나 유효하지 않은 링크입니다.',
  });
}
