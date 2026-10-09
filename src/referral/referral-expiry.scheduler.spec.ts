import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralExpiryScheduler } from './referral-expiry.scheduler';

describe('ReferralExpiryScheduler', () => {
  const NOW = new Date('2026-05-10T01:00:00.000Z');
  let consents: Record<string, any>[];
  let scheduler: ReferralExpiryScheduler;

  beforeEach(() => {
    consents = [
      { id: 'c-expired', status: 'PENDING', expiresAt: new Date(NOW.getTime() - 1000) },
      { id: 'c-just-due', status: 'PENDING', expiresAt: NOW },
      { id: 'c-pending', status: 'PENDING', expiresAt: new Date(NOW.getTime() + 1000) },
      { id: 'c-agreed', status: 'AGREED', expiresAt: new Date(NOW.getTime() - 1000) },
      { id: 'c-withdrawn', status: 'WITHDRAWN', expiresAt: new Date(NOW.getTime() - 1000) },
    ];
    const prisma: any = {
      referralConsent: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const targets = consents.filter((c) => c.status === where.status && c.expiresAt <= where.expiresAt.lte);
          targets.forEach((c) => Object.assign(c, data));
          return { count: targets.length };
        }),
      },
    };
    scheduler = new ReferralExpiryScheduler(prisma as PrismaService);
  });

  const statusOf = (id: string) => consents.find((c) => c.id === id)!.status;

  it('응답 기한이 지난 PENDING만 EXPIRED, 동의·철회된 건은 그대로', async () => {
    const count = await scheduler.expirePendingConsents(NOW);

    expect(count).toBe(2);
    expect(statusOf('c-expired')).toBe('EXPIRED');
    expect(statusOf('c-just-due')).toBe('EXPIRED');
    expect(statusOf('c-pending')).toBe('PENDING');
    expect(statusOf('c-agreed')).toBe('AGREED');
    expect(statusOf('c-withdrawn')).toBe('WITHDRAWN');
  });

  it('처리 중 오류가 나도 예외를 던지지 않고 로그만 남긴다', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(scheduler, 'expirePendingConsents').mockRejectedValue(new Error('DB down'));

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
