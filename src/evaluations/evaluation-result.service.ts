import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { resolveCompanyId } from '../core/utils/company-scope';
import { PrismaService } from '../prisma/prisma.service';
import {
  COMMON_COMPETENCIES,
  OPINION_MAX_LENGTH,
  RESULT_NOTIFIED_ACTION,
  scoreGap,
} from './competency.constants';
import { SubmitOpinionDto } from './dto/submit-opinion.dto';
import { RequestMeta, toDeclarationAnswer } from './self-evaluation.service';

const RESULT_INCLUDE = {
  items: {
    orderBy: { order: 'asc' },
    include: { snapshotQuestion: { include: { response: true } } },
  },
  competencyScores: true,
  opinion: true,
  employee: { select: { id: true, name: true } },
} satisfies Prisma.EvaluationInclude;

type EvaluationWithResult = Prisma.EvaluationGetPayload<{ include: typeof RESULT_INCLUDE }>;

/**
 * 평가 결과 조회(대표·직원)와 직원 의견 제출.
 * 의견은 EvaluationOpinion에만 저장하며 자기점수·대표점수는 절대 바꾸지 않는다.
 */
@Injectable()
export class EvaluationResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLinkService: AccessLinkService,
    private readonly auditService: AuditService,
  ) {}

  /** 대표: 자기선언 답변·자기점수·대표점수·점수 차이·역량·결과 통보·직원 의견 */
  async getCompanyResult(user: JwtPayload, evaluationId: string) {
    const companyId = await resolveCompanyId(user, this.prisma);

    const evaluation = await this.prisma.evaluation.findUnique({
      where: { id: evaluationId },
      include: RESULT_INCLUDE,
    });
    if (!evaluation) {
      throw new NotFoundException({ code: 'EVALUATION_NOT_FOUND', message: '평가를 찾을 수 없습니다.' });
    }
    if (evaluation.companyId !== companyId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: '다른 기업의 평가에는 접근할 수 없습니다.' });
    }
    assertCompleted(evaluation);

    const notification = await this.prisma.auditLog.findFirst({
      where: { action: RESULT_NOTIFIED_ACTION, targetType: 'Evaluation', targetId: evaluationId },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });

    return {
      evaluationId: evaluation.id,
      employeeId: evaluation.employeeId,
      status: evaluation.status,
      completedAt: evaluation.completedAt,
      items: evaluation.items.map((item) => ({
        questionId: item.snapshotQuestionId,
        order: item.order,
        question: item.snapshotQuestion.text,
        declarationAnswer: toDeclarationAnswer(item.snapshotQuestion),
        selfScore: item.selfScore,
        ceoScore: item.ceoScore,
        scoreGap: scoreGap(item.selfScore, item.ceoScore),
      })),
      commonCompetencies: toCompetencies(evaluation),
      rehireIntent: evaluation.rehireIntent,
      notification: {
        sent: (notification?.metadata as { sent?: boolean } | null)?.sent === true,
        viewedAt: evaluation.resultViewedAt,
      },
      employeeOpinion: {
        submitted: !!evaluation.opinion,
        content: evaluation.opinion?.content ?? null,
        submittedAt: evaluation.opinion?.submittedAt ?? null,
        dueAt: evaluation.opinionDueAt,
      },
    };
  }

  /** 직원: 결과 링크로 비교 결과 조회. 링크는 소비하지 않고, 최초 조회 시각만 기록한다. */
  async getEmployeeResult(token: string) {
    const link = await this.accessLinkService.verify(token, 'EVALUATION_RESULT');

    const evaluation = await this.prisma.evaluation.findUnique({
      where: { id: link.targetId },
      include: RESULT_INCLUDE,
    });
    if (!evaluation) {
      throw linkExpired();
    }
    assertCompleted(evaluation);

    if (!evaluation.resultViewedAt) {
      // 조건부 갱신이라 동시에 여러 번 열어도 최초 시각만 남는다
      await this.prisma.evaluation.updateMany({
        where: { id: evaluation.id, resultViewedAt: null },
        data: { resultViewedAt: new Date() },
      });
    }

    const company = await this.prisma.company.findUnique({
      where: { id: evaluation.companyId },
      select: { companyName: true },
    });
    const submitted = !!evaluation.opinion;

    return {
      evaluationId: evaluation.id,
      employee: { name: evaluation.employee.name, companyName: company?.companyName ?? null },
      completedAt: evaluation.completedAt,
      items: evaluation.items.map((item) => ({
        questionId: item.snapshotQuestionId,
        question: item.snapshotQuestion.text,
        selfScore: item.selfScore,
        ceoScore: item.ceoScore,
        scoreGap: scoreGap(item.selfScore, item.ceoScore),
      })),
      commonCompetencies: toCompetencies(evaluation),
      rehireIntent: evaluation.rehireIntent,
      opinion: {
        allowed: !submitted && isWithinOpinionPeriod(evaluation.opinionDueAt, new Date()),
        submitted,
        dueAt: evaluation.opinionDueAt,
      },
    };
  }

  /**
   * 직원: 결과에 대한 의견 1회 제출. 링크는 소비하지 않는다(제출 후에도 결과 조회 가능).
   * 판정 순서: 링크(410/403) → 미완료 409 → 이미 제출 409 → 기한 초과 410 → 내용 422
   */
  async submitOpinion(token: string, dto: SubmitOpinionDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const link = await this.accessLinkService.verify(token, 'EVALUATION_RESULT', tx);

      const evaluation = await tx.evaluation.findUnique({
        where: { id: link.targetId },
        include: { opinion: { select: { id: true } } },
      });
      if (!evaluation) {
        throw linkExpired();
      }
      assertCompleted(evaluation);
      if (evaluation.opinion) {
        throw opinionAlreadySubmitted();
      }

      const now = new Date();
      if (!isWithinOpinionPeriod(evaluation.opinionDueAt, now)) {
        throw new GoneException({
          code: 'OPINION_PERIOD_EXPIRED',
          message: '의견 제출 기한(대표 검증 완료 + 7일)이 지났습니다.',
          details: { opinionDueAt: evaluation.opinionDueAt },
        });
      }

      const content = dto.content.trim();
      if (!content || content.length > OPINION_MAX_LENGTH) {
        throw new UnprocessableEntityException({
          code: 'INVALID_OPINION',
          message: `의견은 1~${OPINION_MAX_LENGTH}자로 입력해 주세요.`,
          details: { length: content.length, maxLength: OPINION_MAX_LENGTH },
        });
      }

      let opinion;
      try {
        // 점수(EvaluationItem·CompetencyScore)는 건드리지 않고 의견만 저장한다
        opinion = await tx.evaluationOpinion.create({
          data: { evaluationId: evaluation.id, content, submittedAt: now },
        });
      } catch (error) {
        // 동시 제출: evaluationId @unique 위반
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw opinionAlreadySubmitted();
        }
        throw error;
      }

      await this.auditService.log(
        {
          actorType: 'EMPLOYEE',
          actorId: evaluation.employeeId,
          action: 'OPINION_SUBMITTED',
          targetType: 'Evaluation',
          targetId: evaluation.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          metadata: { opinionId: opinion.id, length: content.length },
        },
        tx,
      );

      return { evaluationId: evaluation.id, opinionId: opinion.id, submittedAt: opinion.submittedAt };
    });
  }
}

function toCompetencies(evaluation: EvaluationWithResult) {
  return COMMON_COMPETENCIES.map(({ key, name }) => ({
    key,
    name,
    ceoScore: evaluation.competencyScores.find((c) => c.key === key)?.score ?? null,
  }));
}

/** 의견 마감 시각(KST 23:59:59)까지는 허용 */
function isWithinOpinionPeriod(opinionDueAt: Date | null, now: Date): boolean {
  return !!opinionDueAt && now.getTime() <= opinionDueAt.getTime();
}

function assertCompleted(evaluation: { status: string }): void {
  if (evaluation.status !== 'COMPLETED') {
    throw new ConflictException({
      code: 'EVALUATION_NOT_COMPLETED',
      message: '대표 검증이 완료되지 않은 평가입니다.',
      details: { status: evaluation.status },
    });
  }
}

function opinionAlreadySubmitted(): ConflictException {
  return new ConflictException({
    code: 'OPINION_ALREADY_SUBMITTED',
    message: '이미 의견을 제출했습니다.',
  });
}

function linkExpired(): GoneException {
  return new GoneException({
    code: 'LINK_EXPIRED',
    message: '만료되었거나 유효하지 않은 링크입니다.',
  });
}
