import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Evaluation, Prisma } from '@prisma/client';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { resolveCompanyId } from '../core/utils/company-scope';
import { endOfDayKstAfter } from '../core/utils/kst-date';
import { MailService } from '../notification/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMMON_COMPETENCIES,
  OPINION_DUE_DAYS,
  RESULT_LINK_EXTRA_DAYS,
} from './competency.constants';
import { SubmitCeoEvaluationDto } from './dto/submit-ceo-evaluation.dto';
import { SCORE_MAX, SCORE_MIN, isValidScore } from './evaluation.constants';
import { RequestMeta, toDeclarationAnswer } from './self-evaluation.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 대표 검증이 가능한 상태. 자기평가 만료(SELF_EXPIRED)여도 대표 검증은 진행할 수 있다 */
const CEO_EVALUABLE_STATUSES = ['CEO_PENDING', 'SELF_EXPIRED'] as const;

type Client = PrismaService | Prisma.TransactionClient;
type EvaluationWithEmployee = Evaluation & {
  employee: { id: string; name: string; email: string; department: string | null; position: string | null; employmentStatus: string };
};

/**
 * 대표 검증 (법적 안전 로직)
 * - 퇴사 처리된 직원만 평가할 수 있다 (재직 중 403 STILL_EMPLOYED)
 * - 대표 검증 마감(퇴사일 + 15일 KST 23:59:59)이 지나면 조회·제출 모두 막는다 (410 EVALUATION_EXPIRED).
 *   스케줄러는 매시간 돌기 때문에 상태값만 믿지 않고 요청 시각을 마감과 직접 비교한다.
 * - 점수와 재고용 의사(boolean)만 받고 서술형은 받지 않는다. 제출 후 점수 수정 API는 없다.
 */
@Injectable()
export class CeoEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLinkService: AccessLinkService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
  ) {}

  async getForm(user: JwtPayload, evaluationId: string) {
    const companyId = await resolveCompanyId(user, this.prisma);
    const evaluation = await this.findEvaluation(this.prisma, evaluationId);
    assertCeoEvaluable(evaluation, companyId, new Date());

    const items = await this.prisma.evaluationItem.findMany({
      where: { evaluationId },
      orderBy: { order: 'asc' },
      include: { snapshotQuestion: { include: { response: true } } },
    });
    const selfExpired = evaluation.status === 'SELF_EXPIRED';

    return {
      evaluationId: evaluation.id,
      employee: {
        employeeId: evaluation.employee.id,
        name: evaluation.employee.name,
        department: evaluation.employee.department,
        position: evaluation.employee.position,
      },
      status: evaluation.status,
      ceoEvaluationDueAt: evaluation.ceoEvaluationDueAt,
      scoreMin: SCORE_MIN,
      scoreMax: SCORE_MAX,
      items: items.map((item) => ({
        questionId: item.snapshotQuestionId,
        order: item.order,
        question: item.snapshotQuestion.text,
        declarationAnswer: toDeclarationAnswer(item.snapshotQuestion),
        // 자기평가 기한이 지나 제출되지 않았으면 자기점수는 없다
        selfScore: selfExpired ? null : item.selfScore,
        ceoScore: null,
      })),
      commonCompetencies: COMMON_COMPETENCIES.map(({ key, name }) => ({ key, name, ceoScore: null })),
    };
  }

  async submit(user: JwtPayload, evaluationId: string, dto: SubmitCeoEvaluationDto, meta: RequestMeta) {
    const companyId = await resolveCompanyId(user, this.prisma);

    // 트랜잭션 안에서는 데이터와 링크 저장만 한다. 메일은 커밋 후.
    const { evaluation, completedAt, opinionDueAt, linkExpiresAt, token } = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const current = await this.findEvaluation(tx, evaluationId);
      assertCeoEvaluable(current, companyId, now);

      const items = await tx.evaluationItem.findMany({
        where: { evaluationId },
        select: { snapshotQuestionId: true },
      });
      assertExactlyOnce(
        'items',
        items.map((item) => item.snapshotQuestionId),
        dto.items.map((item) => item.questionId),
      );
      assertExactlyOnce(
        'commonCompetencies',
        COMMON_COMPETENCIES.map((c) => c.key),
        dto.commonCompetencies.map((c) => c.key),
      );

      const invalidItems = dto.items.filter((item) => !isValidScore(item.ceoScore)).map((item) => item.questionId);
      const invalidCompetencies = dto.commonCompetencies.filter((c) => !isValidScore(c.score)).map((c) => c.key);
      if (invalidItems.length > 0 || invalidCompetencies.length > 0) {
        throw new UnprocessableEntityException({
          code: 'INVALID_SCORE',
          message: `점수는 ${SCORE_MIN}~${SCORE_MAX} 사이의 정수여야 합니다.`,
          details: { items: invalidItems, commonCompetencies: invalidCompetencies },
        });
      }

      const opinionDue = endOfDayKstAfter(now, OPINION_DUE_DAYS);

      // 동시 제출·마감 경합 방지: 검증 가능 상태이고 마감 전일 때만 COMPLETED로 전환
      const { count } = await tx.evaluation.updateMany({
        where: {
          id: evaluationId,
          status: { in: [...CEO_EVALUABLE_STATUSES] },
          ceoEvaluationDueAt: { gte: now },
        },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          rehireIntent: dto.rehireIntent,
          opinionDueAt: opinionDue,
        },
      });
      if (count === 0) {
        // 그 사이 상태가 바뀌었다 → 바뀐 상태 기준으로 409/410을 다시 판정
        const latest = await this.findEvaluation(tx, evaluationId);
        assertCeoEvaluable(latest, companyId, now);
        throw alreadyCompleted();
      }

      for (const item of dto.items) {
        await tx.evaluationItem.updateMany({
          where: { evaluationId, snapshotQuestionId: item.questionId },
          data: { ceoScore: item.ceoScore },
        });
      }

      await tx.competencyScore.createMany({
        data: dto.commonCompetencies.map((c) => ({ evaluationId, key: c.key, score: c.score })),
      });

      // 결과 링크는 의견 마감 후에도 결과 열람용으로 30일 더 유지
      const resultLinkExpiresAt = new Date(opinionDue.getTime() + RESULT_LINK_EXTRA_DAYS * DAY_MS);
      const resultToken = await this.accessLinkService.issue(
        'EVALUATION_RESULT',
        evaluationId,
        resultLinkExpiresAt,
        tx,
      );

      await this.auditService.log(
        {
          actorType: 'COMPANY',
          actorId: user.sub,
          action: 'EVALUATION_COMPLETED',
          targetType: 'Evaluation',
          targetId: evaluationId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          metadata: {
            employeeId: current.employeeId,
            itemCount: dto.items.length,
            rehireIntent: dto.rehireIntent,
          },
        },
        tx,
      );

      return {
        evaluation: current,
        completedAt: now,
        opinionDueAt: opinionDue,
        linkExpiresAt: resultLinkExpiresAt,
        token: resultToken,
      };
    });

    // 커밋 후 결과 통보. 실패해도 COMPLETED는 유지되고 resultNotified=false로 알린다.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { companyName: true },
    });
    const resultNotified = await this.mailService.sendEvaluationResult({
      to: evaluation.employee.email,
      token,
      employeeName: evaluation.employee.name,
      companyName: company?.companyName,
      expiresAt: linkExpiresAt,
    });

    return {
      evaluationId,
      status: 'COMPLETED' as const,
      completedAt,
      resultNotified,
      opinionDueAt,
    };
  }

  private async findEvaluation(client: Client, evaluationId: string): Promise<EvaluationWithEmployee | null> {
    return client.evaluation.findUnique({
      where: { id: evaluationId },
      include: {
        employee: {
          select: { id: true, name: true, email: true, department: true, position: true, employmentStatus: true },
        },
      },
    });
  }
}

/**
 * 대표 검증 가능 여부를 정해진 순서로 판정한다 (GET·POST 공통).
 * 1. 없음 404 / 타사 403  2. 재직 중 403  3. 완료 409  4. 마감 초과·CEO_EXPIRED 410  5. 그 외 상태 409
 */
export function assertCeoEvaluable(
  evaluation: EvaluationWithEmployee | null,
  companyId: string,
  now: Date,
): asserts evaluation is EvaluationWithEmployee {
  if (!evaluation) {
    throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: '평가를 찾을 수 없습니다.' });
  }
  if (evaluation.companyId !== companyId) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: '다른 기업의 평가에는 접근할 수 없습니다.' });
  }
  if (evaluation.employee.employmentStatus === 'EMPLOYED') {
    throw new ForbiddenException({
      code: 'STILL_EMPLOYED',
      message: '재직 중인 직원은 평가할 수 없습니다.',
    });
  }
  if (evaluation.status === 'COMPLETED') {
    throw alreadyCompleted();
  }
  // 마감 시각(23:59:59.000)까지는 허용, 그 이후는 상태값과 무관하게 차단
  if (evaluation.status === 'CEO_EXPIRED' || now.getTime() > evaluation.ceoEvaluationDueAt.getTime()) {
    throw new GoneException({
      code: 'EVALUATION_EXPIRED',
      message: '대표 검증 기한(퇴사일 + 15일)이 지났습니다.',
      details: { ceoEvaluationDueAt: evaluation.ceoEvaluationDueAt },
    });
  }
  if (!(CEO_EVALUABLE_STATUSES as readonly string[]).includes(evaluation.status)) {
    throw new ConflictException({
      code: 'INVALID_EVALUATION_STATUS',
      message: '대표 검증을 진행할 수 있는 상태가 아닙니다.',
      details: { status: evaluation.status },
    });
  }
}

/** 기대한 키가 빠짐없이 한 번씩 들어왔는지 확인 (누락·중복·없는 키 → 400) */
function assertExactlyOnce(field: string, expected: string[], received: string[]): void {
  const expectedSet = new Set(expected);
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const unknown: string[] = [];

  for (const key of received) {
    if (seen.has(key)) duplicated.add(key);
    seen.add(key);
    if (!expectedSet.has(key)) unknown.push(key);
  }
  const missing = expected.filter((key) => !seen.has(key));

  if (missing.length > 0 || duplicated.size > 0 || unknown.length > 0) {
    throw new BadRequestException({
      code: 'MISSING_EVALUATION_ITEM',
      message:
        field === 'commonCompetencies'
          ? '공통 역량 6개에 한 번씩 점수를 입력해야 합니다.'
          : '모든 평가 항목에 한 번씩 점수를 입력해야 합니다.',
      details: { field, missing, duplicated: [...duplicated], unknown },
    });
  }
}

function alreadyCompleted(): ConflictException {
  return new ConflictException({
    code: 'ALREADY_COMPLETED',
    message: '이미 대표 검증이 완료된 평가입니다.',
  });
}
