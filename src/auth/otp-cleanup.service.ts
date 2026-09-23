import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OtpCleanupService {
  private readonly logger = new Logger(OtpCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  // 매일 새벽 4시 — 만료된 지 1일 넘은 OTP/이메일 인증 코드 정리 (테이블 무한 증가 방지)
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupExpiredCodes(): Promise<void> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [otpResult, emailResult] = await Promise.all([
      this.prisma.otpVerification.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      }),
      this.prisma.emailVerification.deleteMany({
        where: { expiresAt: { lt: cutoff } },
      }),
    ]);

    if (otpResult.count > 0 || emailResult.count > 0) {
      this.logger.log(
        `만료 코드 정리: OTP ${otpResult.count}건, 이메일 인증 ${emailResult.count}건`,
      );
    }
  }
}
