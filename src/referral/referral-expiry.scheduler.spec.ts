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

  it('게시 기간이 지난 PUBLISHED 게시물만 EXPIRED, 비공개·삭제 게시물은 그대로', async () => {
    const posts = [
      { id: 'p-expired', status: 'PUBLISHED', expiresAt: new Date(NOW.getTime() - 1000) },
      { id: 'p-live', status: 'PUBLISHED', expiresAt: new Date(NOW.getTime() + 1000) },
      { id: 'p-hidden', status: 'HIDDEN', expiresAt: new Date(NOW.getTime() - 1000) },
      { id: 'p-deleted', status: 'DELETED', expiresAt: new Date(NOW.getTime() - 1000) },
    ];
    const prisma: any = {
      referralPost: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const targets = posts.filter((p) => p.status === where.status && p.expiresAt <= where.expiresAt.lte);
          targets.forEach((p) => Object.assign(p, data));
          return { count: targets.length };
        }),
      },
    };

    const count = await new ReferralExpiryScheduler(prisma as PrismaService).expirePublishedPosts(NOW);

    expect(count).toBe(1);
    expect(Object.fromEntries(posts.map((p) => [p.id, p.status]))).toEqual({
      'p-expired': 'EXPIRED',
      'p-live': 'PUBLISHED',
      'p-hidden': 'HIDDEN',
      'p-deleted': 'DELETED',
    });
  });

  it('run은 동의 요청과 게시물 만료를 모두 처리한다', async () => {
    const consentSpy = jest.spyOn(scheduler, 'expirePendingConsents').mockResolvedValue(1);
    const postSpy = jest.spyOn(scheduler, 'expirePublishedPosts').mockResolvedValue(2);
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await scheduler.run();

    expect(consentSpy).toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('추천 만료 처리: 동의 요청 1건, 게시물 2건');
    logSpy.mockRestore();
  });

  it('처리 중 오류가 나도 예외를 던지지 않고 로그만 남긴다', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(scheduler, 'expirePendingConsents').mockRejectedValue(new Error('DB down'));

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
