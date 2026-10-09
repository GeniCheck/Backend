import { Logger } from '@nestjs/common';
import { AccessLinkService } from '../access-link/access-link.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvaluationExpiryScheduler } from './evaluation-expiry.scheduler';

type Row = Record<string, any>;

// evaluations·access_links를 메모리로 흉내 낸 가짜 DB (상태 전환 결과를 직접 확인하기 위함)
function createFakeDb(evaluations: Row[], links: Row[]) {
  const matchValue = (actual: any, expected: any) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('lte' in expected) return actual <= expected.lte;
      if ('in' in expected) return expected.in.includes(actual);
    }
    return actual === expected;
  };
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => matchValue(row[k], v));
  const updateMany = (rows: Row[]) => async ({ where, data }: any) => {
    const targets = rows.filter((r) => matches(r, where));
    targets.forEach((r) => Object.assign(r, data));
    return { count: targets.length };
  };

  const client: any = {
    evaluation: {
      findMany: async ({ where }: any) => evaluations.filter((e) => matches(e, where)).map((e) => ({ id: e.id })),
      updateMany: updateMany(evaluations),
    },
    accessLink: { updateMany: updateMany(links) },
  };
  client.$transaction = async (fn: any) => fn(client);
  return client;
}

describe('EvaluationExpiryScheduler', () => {
  const NOW = new Date('2026-05-04T00:00:00.000Z'); // KST 5/4 09:00
  const PAST_SELF_DUE = new Date('2026-05-03T14:59:59.000Z');
  const FUTURE_SELF_DUE = new Date('2026-05-10T14:59:59.000Z');
  const PAST_CEO_DUE = new Date('2026-05-03T14:59:59.000Z');
  const FUTURE_CEO_DUE = new Date('2026-05-15T14:59:59.000Z');

  let evaluations: Row[];
  let links: Row[];
  let scheduler: EvaluationExpiryScheduler;

  const link = (id: string, targetId: string, over: Row = {}) => ({
    id, purpose: 'SELF_EVALUATION', targetId, usedAt: null, revokedAt: null, ...over,
  });

  beforeEach(() => {
    evaluations = [
      { id: 'ev-self-expired', status: 'SELF_PENDING', selfEvaluationDueAt: PAST_SELF_DUE, ceoEvaluationDueAt: FUTURE_CEO_DUE },
      { id: 'ev-self-pending', status: 'SELF_PENDING', selfEvaluationDueAt: FUTURE_SELF_DUE, ceoEvaluationDueAt: FUTURE_CEO_DUE },
      { id: 'ev-ceo-expired', status: 'CEO_PENDING', selfEvaluationDueAt: PAST_SELF_DUE, ceoEvaluationDueAt: PAST_CEO_DUE },
      { id: 'ev-ceo-pending', status: 'CEO_PENDING', selfEvaluationDueAt: PAST_SELF_DUE, ceoEvaluationDueAt: FUTURE_CEO_DUE },
      { id: 'ev-self-exp-ceo-past', status: 'SELF_EXPIRED', selfEvaluationDueAt: PAST_SELF_DUE, ceoEvaluationDueAt: PAST_CEO_DUE },
      { id: 'ev-completed', status: 'COMPLETED', selfEvaluationDueAt: PAST_SELF_DUE, ceoEvaluationDueAt: PAST_CEO_DUE },
    ];
    links = [
      link('l-1', 'ev-self-expired'),
      link('l-2', 'ev-self-pending'),
      link('l-3', 'ev-self-expired', { purpose: 'EVALUATION_RESULT' }),
    ];
    const prisma = createFakeDb(evaluations, links) as unknown as PrismaService;
    scheduler = new EvaluationExpiryScheduler(prisma, new AccessLinkService(prisma));
  });

  const statusOf = (id: string) => evaluations.find((e) => e.id === id)!.status;

  it('자기평가 마감이 지난 SELF_PENDING만 SELF_EXPIRED로 바꾸고 그 평가의 자기평가 링크만 폐기한다', async () => {
    const count = await scheduler.expireSelfEvaluations(NOW);

    expect(count).toBe(1);
    expect(statusOf('ev-self-expired')).toBe('SELF_EXPIRED');
    expect(statusOf('ev-self-pending')).toBe('SELF_PENDING');
    expect(links.find((l) => l.id === 'l-1')!.revokedAt).toBeInstanceOf(Date);
    expect(links.find((l) => l.id === 'l-2')!.revokedAt).toBeNull(); // 마감 전 평가의 링크
    expect(links.find((l) => l.id === 'l-3')!.revokedAt).toBeNull(); // 다른 목적 링크
  });

  it('대표 검증 마감이 지난 CEO_PENDING·SELF_EXPIRED만 CEO_EXPIRED로 바꾼다', async () => {
    const count = await scheduler.expireCeoEvaluations(NOW);

    expect(count).toBe(2);
    expect(statusOf('ev-ceo-expired')).toBe('CEO_EXPIRED');
    expect(statusOf('ev-self-exp-ceo-past')).toBe('CEO_EXPIRED');
    expect(statusOf('ev-ceo-pending')).toBe('CEO_PENDING');
    expect(statusOf('ev-completed')).toBe('COMPLETED'); // 완료된 평가는 건드리지 않음
    expect(statusOf('ev-self-expired')).toBe('SELF_PENDING'); // 상태 조건 불일치
  });

  it('한 회차에서 자기평가 마감 → 대표 검증 마감까지 지난 평가는 CEO_EXPIRED까지 간다', async () => {
    evaluations.push({ id: 'ev-both-past', status: 'SELF_PENDING', selfEvaluationDueAt: PAST_SELF_DUE, ceoEvaluationDueAt: PAST_CEO_DUE });
    jest.useFakeTimers().setSystemTime(NOW);
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await scheduler.run();

    expect(statusOf('ev-both-past')).toBe('CEO_EXPIRED');
    expect(statusOf('ev-self-expired')).toBe('SELF_EXPIRED');
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
    jest.useRealTimers();
  });

  it('조회 직후 직원이 제출했으면(상태 변경) 만료 처리하지 않고 링크도 폐기하지 않는다', async () => {
    const prisma: any = createFakeDb(evaluations, links);
    const originalFindMany = prisma.evaluation.findMany;
    prisma.evaluation.findMany = async (args: any) => {
      const result = await originalFindMany(args);
      evaluations.find((e) => e.id === 'ev-self-expired')!.status = 'CEO_PENDING'; // 그 사이 제출
      return result;
    };
    const racing = new EvaluationExpiryScheduler(prisma, new AccessLinkService(prisma));

    const count = await racing.expireSelfEvaluations(NOW);

    expect(count).toBe(0);
    expect(statusOf('ev-self-expired')).toBe('CEO_PENDING');
    expect(links.find((l) => l.id === 'l-1')!.revokedAt).toBeNull();
  });

  it('처리 중 오류가 나도 예외를 밖으로 던지지 않고 로그만 남긴다', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(scheduler, 'expireSelfEvaluations').mockRejectedValue(new Error('DB down'));

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
