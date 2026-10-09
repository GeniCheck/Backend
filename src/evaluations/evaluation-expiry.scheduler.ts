import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AccessLinkService } from '../access-link/access-link.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 신규 흐름 평가(evaluations 테이블) 마감 처리.
 * 레거시 EvaluationSchedulerService(employments 테이블)와는 대상이 다르다.
 * ScheduleModule.forRoot()는 이미 등록돼 있어 @Cron만 사용한다.
 */
@Injectable()
export class EvaluationExpiryScheduler {
  private readonly logger = new Logger(EvaluationExpiryScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLinkService: AccessLinkService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      // 자기평가 만료를 먼저 처리해야, 같은 회차에 대표 검증 마감도 지난 건이 CEO_EXPIRED까지 간다
      const selfExpired = await this.expireSelfEvaluations();
      const ceoExpired = await this.expireCeoEvaluations();
      if (selfExpired + ceoExpired > 0) {
        this.logger.log(`평가 만료 처리: SELF_EXPIRED ${selfExpired}건, CEO_EXPIRED ${ceoExpired}건`);
      }
    } catch (error) {
      this.logger.error('평가 만료 처리 실패', error instanceof Error ? error.stack : String(error));
    }
  }

  /** 자기평가 마감이 지난 SELF_PENDING → SELF_EXPIRED, 남은 자기평가 링크 폐기. 처리 건수 반환 */
  async expireSelfEvaluations(now: Date = new Date()): Promise<number> {
    const targets = await this.prisma.evaluation.findMany({
      where: { status: 'SELF_PENDING', selfEvaluationDueAt: { lte: now } },
      select: { id: true },
    });

    let expired = 0;
    for (const { id } of targets) {
      // 건별 트랜잭션: 조회 직후 직원이 제출했다면 상태 조건에 걸려 0건 → 링크도 건드리지 않는다
      const changed = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.evaluation.updateMany({
          where: { id, status: 'SELF_PENDING', selfEvaluationDueAt: { lte: now } },
          data: { status: 'SELF_EXPIRED' },
        });
        if (count === 0) {
          return false;
        }
        await this.accessLinkService.revokeActive('SELF_EVALUATION', id, tx);
        return true;
      });
      if (changed) expired++;
    }
    return expired;
  }

  /** 대표 검증 마감이 지난 CEO_PENDING·SELF_EXPIRED → CEO_EXPIRED. 처리 건수 반환 */
  async expireCeoEvaluations(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.evaluation.updateMany({
      where: {
        status: { in: ['CEO_PENDING', 'SELF_EXPIRED'] },
        ceoEvaluationDueAt: { lte: now },
      },
      data: { status: 'CEO_EXPIRED' },
    });
    return count;
  }
}
