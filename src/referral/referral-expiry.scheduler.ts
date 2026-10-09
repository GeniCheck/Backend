import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 인재 추천 만료 처리 (매시간).
 * ScheduleModule.forRoot()는 이미 등록돼 있어 @Cron만 사용한다.
 */
@Injectable()
export class ReferralExpiryScheduler {
  private readonly logger = new Logger(ReferralExpiryScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      const expired = await this.expirePendingConsents();
      if (expired > 0) {
        this.logger.log(`추천 동의 요청 만료 처리: ${expired}건`);
      }
    } catch (error) {
      this.logger.error('추천 만료 처리 실패', error instanceof Error ? error.stack : String(error));
    }
  }

  /** 응답 기한이 지난 PENDING 동의 요청 → EXPIRED. 동의(AGREED)된 건은 건드리지 않는다. 처리 건수 반환 */
  async expirePendingConsents(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.referralConsent.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }
}
