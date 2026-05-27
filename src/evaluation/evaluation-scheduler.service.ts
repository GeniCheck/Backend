import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EvaluationSchedulerService {
  private readonly logger = new Logger(EvaluationSchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // 매 시간 정각 실행 — 골든타임 만료된 Employment windowClosed 처리
  @Cron(CronExpression.EVERY_HOUR)
  async closeExpiredWindows(): Promise<void> {
    const result = await this.prisma.employment.updateMany({
      where: {
        windowClosed: false,
        evaluationCloseAt: { lte: new Date() },
        evaluationOpenAt: { not: null },
      },
      data: { windowClosed: true },
    });

    if (result.count > 0) {
      this.logger.log(`골든타임 만료 처리: ${result.count}건`);
    }
  }
}
