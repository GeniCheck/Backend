import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notification/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CeoEvaluationService } from './ceo-evaluation.service';
import { SubmitCeoEvaluationDto } from './dto/submit-ceo-evaluation.dto';

// 법적 로직 테스트 — 시간은 모두 jest fake timers로 고정한다
const CEO = { sub: 'comp-1', role: 'COMPANY' as const };
const META = { ip: '127.0.0.1', userAgent: 'jest' };
const CEO_DUE = new Date('2026-05-15T14:59:59.000Z'); // 퇴사일 2026-04-30 + 15일 KST 23:59:59
const BEFORE_DUE = new Date('2026-05-10T01:00:00.000Z'); // KST 5/10 10:00
const ONE_SECOND = 1000;

type State = Record<string, any>;

const snapshot = (id: string, order: number, type: string, response: Record<string, unknown>) => ({
  id, declarationId: 'decl-1', order, type, text: `질문 ${order}`, required: true,
  scoreMin: 1, scoreMax: 10, options: null, maxLength: 500, evaluationEnabled: true,
  response: { id: `r-${id}`, snapshotQuestionId: id, answerScore: null, answerOptionId: null, answerText: null, ...response },
});

const ITEMS_DB = [
  { id: 'it-1', evaluationId: 'ev-1', snapshotQuestionId: 'snap-1', order: 1, selfScore: 8, ceoScore: null,
    snapshotQuestion: snapshot('snap-1', 1, 'SCORE', { answerScore: 8 }) },
  { id: 'it-2', evaluationId: 'ev-1', snapshotQuestionId: 'snap-3', order: 3, selfScore: 7, ceoScore: null,
    snapshotQuestion: snapshot('snap-3', 3, 'TEXT', { answerText: 'React 성능 개선 경험' }) },
];

const COMPETENCIES = [
  { key: 'TRUST', score: 8 },
  { key: 'DILIGENCE', score: 9 },
  { key: 'RESPONSIBILITY', score: 8 },
  { key: 'COLLABORATION', score: 7 },
  { key: 'COMMUNICATION', score: 7 },
  { key: 'GROWTH_POTENTIAL', score: 9 },
] as SubmitCeoEvaluationDto['commonCompetencies'];

const validDto = (over: Partial<SubmitCeoEvaluationDto> = {}): SubmitCeoEvaluationDto => ({
  items: [
    { questionId: 'snap-1', ceoScore: 7 },
    { questionId: 'snap-3', ceoScore: 8 },
  ],
  commonCompetencies: COMPETENCIES,
  rehireIntent: true,
  ...over,
});

async function expectCode(
  promise: Promise<unknown>,
  type: new (...args: any[]) => HttpException,
  code: string,
) {
  const error = await promise.then(
    () => {
      throw new Error('예외가 발생해야 합니다.');
    },
    (e) => e,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject({ code });
}

describe('CeoEvaluationService (법적 안전 로직)', () => {
  let state: State; // DB의 evaluation 한 건
  let prismaMock: any;
  let accessLinkMock: { issue: jest.Mock };
  let mailMock: { sendEvaluationResult: jest.Mock };
  let auditMock: { log: jest.Mock };
  let service: CeoEvaluationService;
  let committed: boolean;

  const setNow = (date: Date) => jest.setSystemTime(date);

  beforeEach(() => {
    jest.useFakeTimers();
    setNow(BEFORE_DUE);
    committed = false;
    state = {
      id: 'ev-1',
      companyId: 'comp-1',
      employeeId: 'emp-1',
      declarationId: 'decl-1',
      status: 'CEO_PENDING',
      resignationDate: new Date('2026-04-30T00:00:00.000Z'),
      selfEvaluationDueAt: new Date('2026-05-03T14:59:59.000Z'),
      ceoEvaluationDueAt: CEO_DUE,
      completedAt: null,
      rehireIntent: null,
      opinionDueAt: null,
      employee: {
        id: 'emp-1', name: '김민준', email: 'minjun@example.com', department: '개발팀', position: '과장',
        employmentStatus: 'RESIGNED',
      },
    };

    prismaMock = {
      hrManager: { findUnique: jest.fn() },
      evaluation: {
        findUnique: jest.fn(async () => ({ ...state, employee: { ...state.employee } })),
        // 실제 조건(상태 + 마감 시각)을 그대로 흉내 낸 조건부 갱신
        updateMany: jest.fn(async ({ where, data }: any) => {
          const ok =
            where.id === state.id &&
            where.status.in.includes(state.status) &&
            state.ceoEvaluationDueAt.getTime() >= where.ceoEvaluationDueAt.gte.getTime();
          if (ok) Object.assign(state, data);
          return { count: ok ? 1 : 0 };
        }),
      },
      evaluationItem: {
        findMany: jest.fn(async () => ITEMS_DB.map((i) => ({ ...i }))),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      competencyScore: { createMany: jest.fn().mockResolvedValue({ count: 6 }) },
      company: { findUnique: jest.fn().mockResolvedValue({ companyName: '테크플러스' }) },
      $transaction: jest.fn(async (fn: any) => {
        const result = await fn(prismaMock);
        committed = true;
        return result;
      }),
    };
    accessLinkMock = { issue: jest.fn().mockResolvedValue('result-token') };
    mailMock = {
      sendEvaluationResult: jest.fn(async () => {
        expect(committed).toBe(true); // 결과 메일은 커밋 후에만
        return true;
      }),
    };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };
    service = new CeoEvaluationService(
      prismaMock as unknown as PrismaService,
      accessLinkMock as unknown as AccessLinkService,
      mailMock as unknown as MailService,
      auditMock as unknown as AuditService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // 1
  it('재직 중(EMPLOYED) 직원이면 조회·제출 모두 403 STILL_EMPLOYED', async () => {
    state.employee.employmentStatus = 'EMPLOYED';

    await expectCode(service.getForm(CEO, 'ev-1'), ForbiddenException, 'STILL_EMPLOYED');
    await expectCode(service.submit(CEO, 'ev-1', validDto(), META), ForbiddenException, 'STILL_EMPLOYED');
    expect(prismaMock.evaluation.updateMany).not.toHaveBeenCalled();
  });

  // 2
  it('마감 1초 전 제출은 성공, 1초 후 제출은 410 EVALUATION_EXPIRED', async () => {
    setNow(new Date(CEO_DUE.getTime() + ONE_SECOND));
    await expectCode(service.submit(CEO, 'ev-1', validDto(), META), GoneException, 'EVALUATION_EXPIRED');
    expect(state.status).toBe('CEO_PENDING');

    setNow(new Date(CEO_DUE.getTime() - ONE_SECOND));
    await expect(service.submit(CEO, 'ev-1', validDto(), META)).resolves.toMatchObject({ status: 'COMPLETED' });
    expect(state.status).toBe('COMPLETED');
  });

  // 3
  it('마감 시각 정각(KST 23:59:59.000) 제출은 성공', async () => {
    setNow(CEO_DUE);
    await expect(service.submit(CEO, 'ev-1', validDto(), META)).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  // 4
  it('마감 1초 후에는 폼 조회도 410 EVALUATION_EXPIRED (스케줄러가 상태를 바꾸기 전이어도)', async () => {
    setNow(new Date(CEO_DUE.getTime() + ONE_SECOND));
    expect(state.status).toBe('CEO_PENDING');
    await expectCode(service.getForm(CEO, 'ev-1'), GoneException, 'EVALUATION_EXPIRED');
  });

  // 5
  it('CEO_EXPIRED 상태면 마감 전 시각이어도 조회·제출 410 EVALUATION_EXPIRED', async () => {
    state.status = 'CEO_EXPIRED';
    await expectCode(service.getForm(CEO, 'ev-1'), GoneException, 'EVALUATION_EXPIRED');
    await expectCode(service.submit(CEO, 'ev-1', validDto(), META), GoneException, 'EVALUATION_EXPIRED');
  });

  // 6
  it('재제출은 409 ALREADY_COMPLETED', async () => {
    await service.submit(CEO, 'ev-1', validDto(), META);
    await expectCode(service.submit(CEO, 'ev-1', validDto(), META), ConflictException, 'ALREADY_COMPLETED');
    await expectCode(service.getForm(CEO, 'ev-1'), ConflictException, 'ALREADY_COMPLETED');
    expect(prismaMock.competencyScore.createMany).toHaveBeenCalledTimes(1);
  });

  it('동시 제출로 조회 직후 다른 요청이 먼저 완료했으면(갱신 0건) 409 ALREADY_COMPLETED, 점수·역량을 저장하지 않는다', async () => {
    prismaMock.evaluation.findUnique
      .mockResolvedValueOnce({ ...state, employee: { ...state.employee } }) // 트랜잭션 시작 시 CEO_PENDING
      .mockResolvedValueOnce({ ...state, status: 'COMPLETED', employee: { ...state.employee } }); // 재판정 시 COMPLETED
    prismaMock.evaluation.updateMany.mockResolvedValueOnce({ count: 0 });

    await expectCode(service.submit(CEO, 'ev-1', validDto(), META), ConflictException, 'ALREADY_COMPLETED');
    expect(prismaMock.evaluationItem.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.competencyScore.createMany).not.toHaveBeenCalled();
    expect(accessLinkMock.issue).not.toHaveBeenCalled();
    expect(mailMock.sendEvaluationResult).not.toHaveBeenCalled();
  });

  // 7
  it('다른 기업 평가는 403 FORBIDDEN, 없는 평가는 404 EVALUATION_NOT_FOUND', async () => {
    state.companyId = 'comp-other';
    await expectCode(service.getForm(CEO, 'ev-1'), ForbiddenException, 'FORBIDDEN');
    await expectCode(service.submit(CEO, 'ev-1', validDto(), META), ForbiddenException, 'FORBIDDEN');

    prismaMock.evaluation.findUnique.mockResolvedValue(null);
    await expectCode(service.getForm(CEO, 'nope'), NotFoundException, 'EVALUATION_NOT_FOUND');
    await expectCode(service.submit(CEO, 'nope', validDto(), META), NotFoundException, 'EVALUATION_NOT_FOUND');
  });

  // 8
  it('자기평가 진행 중(SELF_PENDING)이면 409 INVALID_EVALUATION_STATUS', async () => {
    state.status = 'SELF_PENDING';
    await expectCode(service.getForm(CEO, 'ev-1'), ConflictException, 'INVALID_EVALUATION_STATUS');
    await expectCode(service.submit(CEO, 'ev-1', validDto(), META), ConflictException, 'INVALID_EVALUATION_STATUS');
  });

  // 9
  describe('400 MISSING_EVALUATION_ITEM', () => {
    it('공통 역량 누락·중복·없는 키', async () => {
      await expectCode(
        service.submit(CEO, 'ev-1', validDto({ commonCompetencies: COMPETENCIES.slice(0, 5) }), META),
        BadRequestException,
        'MISSING_EVALUATION_ITEM',
      );
      await expectCode(
        service.submit(CEO, 'ev-1', validDto({ commonCompetencies: [...COMPETENCIES.slice(0, 5), COMPETENCIES[0]] }), META),
        BadRequestException,
        'MISSING_EVALUATION_ITEM',
      );
      await expectCode(
        service.submit(CEO, 'ev-1', validDto({ commonCompetencies: [...COMPETENCIES, { key: 'LEADERSHIP' as any, score: 5 }] }), META),
        BadRequestException,
        'MISSING_EVALUATION_ITEM',
      );
    });

    it('평가 항목 누락·중복·없는 항목', async () => {
      await expectCode(
        service.submit(CEO, 'ev-1', validDto({ items: [{ questionId: 'snap-1', ceoScore: 7 }] }), META),
        BadRequestException,
        'MISSING_EVALUATION_ITEM',
      );
      await expectCode(
        service.submit(CEO, 'ev-1', validDto({ items: [...validDto().items, { questionId: 'snap-1', ceoScore: 7 }] }), META),
        BadRequestException,
        'MISSING_EVALUATION_ITEM',
      );
      await expectCode(
        service.submit(CEO, 'ev-1', validDto({ items: [...validDto().items, { questionId: 'snap-x', ceoScore: 7 }] }), META),
        BadRequestException,
        'MISSING_EVALUATION_ITEM',
      );
      expect(state.status).toBe('CEO_PENDING');
    });
  });

  // 10
  it.each([0, 11, 7.5])('항목 점수 %s는 422 INVALID_SCORE', async (score) => {
    await expectCode(
      service.submit(CEO, 'ev-1', validDto({ items: [{ questionId: 'snap-1', ceoScore: score }, { questionId: 'snap-3', ceoScore: 8 }] }), META),
      UnprocessableEntityException,
      'INVALID_SCORE',
    );
    expect(state.status).toBe('CEO_PENDING');
  });

  it.each([0, 11, 7.5])('공통 역량 점수 %s는 422 INVALID_SCORE', async (score) => {
    const competencies = COMPETENCIES.map((c, i) => (i === 2 ? { ...c, score } : c));
    await expectCode(
      service.submit(CEO, 'ev-1', validDto({ commonCompetencies: competencies }), META),
      UnprocessableEntityException,
      'INVALID_SCORE',
    );
  });

  // 13
  it('SELF_EXPIRED면 폼의 selfScore는 null이고 대표 검증 제출은 성공한다', async () => {
    state.status = 'SELF_EXPIRED';

    const form = await service.getForm(CEO, 'ev-1');
    expect(form.items.map((i) => i.selfScore)).toEqual([null, null]);

    await expect(service.submit(CEO, 'ev-1', validDto(), META)).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  // 14
  it('결과 메일 발송이 실패해도 COMPLETED는 유지되고 resultNotified=false', async () => {
    mailMock.sendEvaluationResult.mockResolvedValue(false);

    const result = await service.submit(CEO, 'ev-1', validDto(), META);

    expect(result.resultNotified).toBe(false);
    expect(result.status).toBe('COMPLETED');
    expect(state.status).toBe('COMPLETED');
    expect(committed).toBe(true);
  });

  // 15
  it('정상 제출: COMPLETED·대표 점수·역량 6개·의견 마감(+7일)·결과 링크(+30일)·감사 로그·커밋 후 메일', async () => {
    setNow(new Date('2026-05-05T01:00:00.000Z')); // KST 5/5 10:00 완료

    const result = await service.submit(CEO, 'ev-1', validDto({ rehireIntent: false }), META);

    const completedAt = new Date('2026-05-05T01:00:00.000Z');
    const opinionDueAt = new Date('2026-05-12T14:59:59.000Z'); // KST 5/12 23:59:59 (명세 예시)
    expect(result).toEqual({ evaluationId: 'ev-1', status: 'COMPLETED', completedAt, resultNotified: true, opinionDueAt });
    expect(state).toMatchObject({ status: 'COMPLETED', completedAt, rehireIntent: false, opinionDueAt });

    expect(prismaMock.evaluationItem.updateMany).toHaveBeenCalledWith({
      where: { evaluationId: 'ev-1', snapshotQuestionId: 'snap-1' },
      data: { ceoScore: 7 },
    });
    expect(prismaMock.evaluationItem.updateMany).toHaveBeenCalledWith({
      where: { evaluationId: 'ev-1', snapshotQuestionId: 'snap-3' },
      data: { ceoScore: 8 },
    });
    expect(prismaMock.competencyScore.createMany).toHaveBeenCalledWith({
      data: COMPETENCIES.map((c) => ({ evaluationId: 'ev-1', key: c.key, score: c.score })),
    });

    const linkExpiresAt = new Date(opinionDueAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(accessLinkMock.issue).toHaveBeenCalledWith('EVALUATION_RESULT', 'ev-1', linkExpiresAt, prismaMock);
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'COMPANY', action: 'EVALUATION_COMPLETED', targetType: 'Evaluation', targetId: 'ev-1' }),
      prismaMock,
    );
    expect(mailMock.sendEvaluationResult).toHaveBeenCalledWith({
      to: 'minjun@example.com',
      token: 'result-token',
      employeeName: '김민준',
      companyName: '테크플러스',
      expiresAt: linkExpiresAt,
    });
  });

  // 16
  describe('검사 우선순위 (프롬프트 순서)', () => {
    it('재직 중 + COMPLETED → 403 STILL_EMPLOYED가 먼저', async () => {
      state.employee.employmentStatus = 'EMPLOYED';
      state.status = 'COMPLETED';
      await expectCode(service.getForm(CEO, 'ev-1'), ForbiddenException, 'STILL_EMPLOYED');
    });

    it('COMPLETED + 마감 지남 → 409 ALREADY_COMPLETED가 먼저', async () => {
      state.status = 'COMPLETED';
      setNow(new Date(CEO_DUE.getTime() + ONE_SECOND));
      await expectCode(service.getForm(CEO, 'ev-1'), ConflictException, 'ALREADY_COMPLETED');
    });

    it('SELF_PENDING + 마감 지남 → 410 EVALUATION_EXPIRED가 먼저', async () => {
      state.status = 'SELF_PENDING';
      setNow(new Date(CEO_DUE.getTime() + ONE_SECOND));
      await expectCode(service.getForm(CEO, 'ev-1'), GoneException, 'EVALUATION_EXPIRED');
    });

    it('타사 + 재직 중 → 403 FORBIDDEN이 먼저', async () => {
      state.companyId = 'comp-other';
      state.employee.employmentStatus = 'EMPLOYED';
      await expectCode(service.getForm(CEO, 'ev-1'), ForbiddenException, 'FORBIDDEN');
    });
  });

  // 17
  it('폼 조회: 자기선언 답변·자기점수, ceoScore null, 공통 역량 6개(이름·순서)', async () => {
    const form = await service.getForm(CEO, 'ev-1');

    expect(form).toEqual({
      evaluationId: 'ev-1',
      employee: { employeeId: 'emp-1', name: '김민준', department: '개발팀', position: '과장' },
      status: 'CEO_PENDING',
      ceoEvaluationDueAt: CEO_DUE,
      scoreMin: 1,
      scoreMax: 10,
      items: [
        { questionId: 'snap-1', order: 1, question: '질문 1', declarationAnswer: { type: 'SCORE', score: 8 }, selfScore: 8, ceoScore: null },
        { questionId: 'snap-3', order: 3, question: '질문 3', declarationAnswer: { type: 'TEXT', text: 'React 성능 개선 경험' }, selfScore: 7, ceoScore: null },
      ],
      commonCompetencies: [
        { key: 'TRUST', name: '신뢰', ceoScore: null },
        { key: 'DILIGENCE', name: '성실성', ceoScore: null },
        { key: 'RESPONSIBILITY', name: '책임감', ceoScore: null },
        { key: 'COLLABORATION', name: '협업', ceoScore: null },
        { key: 'COMMUNICATION', name: '의사소통', ceoScore: null },
        { key: 'GROWTH_POTENTIAL', name: '성장 가능성', ceoScore: null },
      ],
    });
  });
});
