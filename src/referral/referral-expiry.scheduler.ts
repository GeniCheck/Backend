import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 인재 추천 만료 처리 (매시간).
 * ScheduleModule.forRoot()는 이미 등록돼 있어 @Cron만 사용한다.
 * 게시물 목록·상세는 만료 시각을 직접 비교하므로, 스케줄러가 돌기 전에도 만료된 게시물은 보이지 않는다.
 */
@Injectable()
export class ReferralExpiryScheduler {
  private readonly logger = new Logger(ReferralExpiryScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run(): Promise<void> {
    try {
      const now = new Date();
      const consents = await this.expirePendingConsents(now);
      const posts = await this.expirePublishedPosts(now);
      if (consents + posts > 0) {
        this.logger.log(`추천 만료 처리: 동의 요청 ${consents}건, 게시물 ${posts}건`);
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

  /** 게시 기간이 지난 PUBLISHED 게시물 → EXPIRED. 비공개·삭제된 게시물은 건드리지 않는다. 처리 건수 반환 */
  async expirePublishedPosts(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.referralPost.updateMany({
      where: { status: 'PUBLISHED', expiresAt: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }
}
