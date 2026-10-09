import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvaluationResultService } from './evaluation-result.service';

const CEO = { sub: 'comp-1', role: 'COMPANY' as const };
const META = { ip: '127.0.0.1', userAgent: 'jest' };
const COMPLETED_AT = new Date('2026-05-05T01:00:00.000Z'); // KST 5/5 10:00
const OPINION_DUE = new Date('2026-05-12T14:59:59.000Z'); // KST 5/12 23:59:59

const snapshot = (id: string, order: number, type: string, response: Record<string, unknown>) => ({
  id, declarationId: 'decl-1', order, type, text: `질문 ${order}`, required: true,
  scoreMin: 1, scoreMax: 10, options: null, maxLength: 500, evaluationEnabled: true,
  response: { id: `r-${id}`, snapshotQuestionId: id, answerScore: null, answerOptionId: null, answerText: null, ...response },
});

const completedEvaluation = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  companyId: 'comp-1',
  employeeId: 'emp-1',
  status: 'COMPLETED',
  completedAt: COMPLETED_AT,
  opinionDueAt: OPINION_DUE,
  rehireIntent: true,
  resultViewedAt: null,
  employee: { id: 'emp-1', name: '김민준' },
  items: [
    { id: 'it-1', snapshotQuestionId: 'snap-1', order: 1, selfScore: 8, ceoScore: 7, snapshotQuestion: snapshot('snap-1', 1, 'SCORE', { answerScore: 8 }) },
    { id: 'it-2', snapshotQuestionId: 'snap-3', order: 3, selfScore: null, ceoScore: 8, snapshotQuestion: snapshot('snap-3', 3, 'TEXT', { answerText: 'React' }) },
  ],
  competencyScores: [
    { key: 'GROWTH_POTENTIAL', score: 9 }, { key: 'TRUST', score: 8 }, { key: 'DILIGENCE', score: 9 },
    { key: 'RESPONSIBILITY', score: 8 }, { key: 'COLLABORATION', score: 7 }, { key: 'COMMUNICATION', score: 7 },
  ],
  opinion: null,
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

describe('EvaluationResultService', () => {
  let prismaMock: any;
  let accessLinkMock: { verify: jest.Mock; consume: jest.Mock };
  let auditMock: { log: jest.Mock };
  let service: EvaluationResultService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-06T00:00:00.000Z'));
    prismaMock = {
      hrManager: { findUnique: jest.fn() },
      evaluation: {
        findUnique: jest.fn().mockResolvedValue(completedEvaluation()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      evaluationItem: { update: jest.fn(), updateMany: jest.fn() },
      competencyScore: { update: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
      evaluationOpinion: {
        create: jest.fn(async ({ data }: any) => ({ id: 'op-1', ...data })),
      },
      auditLog: { findFirst: jest.fn().mockResolvedValue({ metadata: { sent: true } }) },
      company: { findUnique: jest.fn().mockResolvedValue({ companyName: '테크플러스 주식회사' }) },
      $transaction: jest.fn(async (fn: any) => fn(prismaMock)),
    };
    accessLinkMock = {
      verify: jest.fn().mockResolvedValue({ id: 'link-1', purpose: 'EVALUATION_RESULT', targetId: 'ev-1' }),
      consume: jest.fn(),
    };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };
    service = new EvaluationResultService(
      prismaMock as unknown as PrismaService,
      accessLinkMock as unknown as AccessLinkService,
      auditMock as unknown as AuditService,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('대표 결과 조회', () => {
    it('자기선언·자기점수·대표점수·점수 차이(대표-자기)·역량(정해진 순서)·통보·의견을 반환한다', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValue(completedEvaluation({
        resultViewedAt: new Date('2026-05-06T00:00:00.000Z'),
        opinion: { id: 'op-1', content: '보완 설명', submittedAt: new Date('2026-05-07T01:00:00.000Z') },
      }));

      const result = await service.getCompanyResult(CEO, 'ev-1');

      expect(result).toEqual({
        evaluationId: 'ev-1',
        employeeId: 'emp-1',
        status: 'COMPLETED',
        completedAt: COMPLETED_AT,
        items: [
          { questionId: 'snap-1', order: 1, question: '질문 1', declarationAnswer: { type: 'SCORE', score: 8 }, selfScore: 8, ceoScore: 7, scoreGap: -1 },
          // 자기평가 만료로 자기점수가 없으면 점수 차이도 null
          { questionId: 'snap-3', order: 3, question: '질문 3', declarationAnswer: { type: 'TEXT', text: 'React' }, selfScore: null, ceoScore: 8, scoreGap: null },
        ],
        commonCompetencies: [
          { key: 'TRUST', name: '신뢰', ceoScore: 8 },
          { key: 'DILIGENCE', name: '성실성', ceoScore: 9 },
          { key: 'RESPONSIBILITY', name: '책임감', ceoScore: 8 },
          { key: 'COLLABORATION', name: '협업', ceoScore: 7 },
          { key: 'COMMUNICATION', name: '의사소통', ceoScore: 7 },
          { key: 'GROWTH_POTENTIAL', name: '성장 가능성', ceoScore: 9 },
        ],
        rehireIntent: true,
        notification: { sent: true, viewedAt: new Date('2026-05-06T00:00:00.000Z') },
        employeeOpinion: {
          submitted: true,
          content: '보완 설명',
          submittedAt: new Date('2026-05-07T01:00:00.000Z'),
          dueAt: OPINION_DUE,
        },
      });
      expect(prismaMock.auditLog.findFirst).toHaveBeenCalledWith({
        where: { action: 'EVALUATION_RESULT_NOTIFIED', targetType: 'Evaluation', targetId: 'ev-1' },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      });
    });

    it('결과 메일 실패 기록이거나 기록이 없으면 notification.sent=false, 의견 미제출이면 submitted=false', async () => {
      prismaMock.auditLog.findFirst.mockResolvedValueOnce({ metadata: { sent: false } });
      const failed = await service.getCompanyResult(CEO, 'ev-1');
      expect(failed.notification).toEqual({ sent: false, viewedAt: null });
      expect(failed.employeeOpinion).toEqual({ submitted: false, content: null, submittedAt: null, dueAt: OPINION_DUE });

      prismaMock.auditLog.findFirst.mockResolvedValueOnce(null);
      expect((await service.getCompanyResult(CEO, 'ev-1')).notification.sent).toBe(false);
    });

    it('대표 검증 전이면 409 EVALUATION_NOT_COMPLETED', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValue(completedEvaluation({ status: 'CEO_PENDING' }));
      await expectCode(service.getCompanyResult(CEO, 'ev-1'), ConflictException, 'EVALUATION_NOT_COMPLETED');
    });

    it('다른 기업 403 FORBIDDEN, 없는 평가 404 EVALUATION_NOT_FOUND', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValueOnce(completedEvaluation({ companyId: 'comp-other' }));
      await expectCode(service.getCompanyResult(CEO, 'ev-1'), ForbiddenException, 'FORBIDDEN');
      prismaMock.evaluation.findUnique.mockResolvedValueOnce(null);
      await expectCode(service.getCompanyResult(CEO, 'nope'), NotFoundException, 'EVALUATION_NOT_FOUND');
    });
  });

  describe('직원 결과 조회', () => {
    it('점수 비교·역량·의견 가능 여부를 반환하고, 링크는 소비하지 않으며 최초 조회 시각을 기록한다', async () => {
      const result = await service.getEmployeeResult('tok');

      expect(accessLinkMock.verify).toHaveBeenCalledWith('tok', 'EVALUATION_RESULT');
      expect(accessLinkMock.consume).not.toHaveBeenCalled();
      expect(result).toEqual({
        evaluationId: 'ev-1',
        employee: { name: '김민준', companyName: '테크플러스 주식회사' },
        completedAt: COMPLETED_AT,
        items: [
          { questionId: 'snap-1', question: '질문 1', selfScore: 8, ceoScore: 7, scoreGap: -1 },
          { questionId: 'snap-3', question: '질문 3', selfScore: null, ceoScore: 8, scoreGap: null },
        ],
        commonCompetencies: expect.arrayContaining([{ key: 'TRUST', name: '신뢰', ceoScore: 8 }]),
        rehireIntent: true,
        opinion: { allowed: true, submitted: false, dueAt: OPINION_DUE },
      });
      expect(prismaMock.evaluation.updateMany).toHaveBeenCalledWith({
        where: { id: 'ev-1', resultViewedAt: null },
        data: { resultViewedAt: new Date('2026-05-06T00:00:00.000Z') },
      });
    });

    it('이미 조회한 적 있으면 조회 시각을 다시 쓰지 않는다', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValue(completedEvaluation({ resultViewedAt: new Date('2026-05-05T12:00:00Z') }));
      await service.getEmployeeResult('tok');
      expect(prismaMock.evaluation.updateMany).not.toHaveBeenCalled();
    });

    it('의견을 이미 냈거나 기한이 지나면 opinion.allowed=false', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValueOnce(completedEvaluation({ opinion: { id: 'op-1' } }));
      expect((await service.getEmployeeResult('tok')).opinion).toEqual({ allowed: false, submitted: true, dueAt: OPINION_DUE });

      jest.setSystemTime(new Date(OPINION_DUE.getTime() + 1000));
      expect((await service.getEmployeeResult('tok')).opinion).toEqual({ allowed: false, submitted: false, dueAt: OPINION_DUE });
    });

    it('대표 검증 전이면 409 EVALUATION_NOT_COMPLETED, 링크 오류(410·403)는 그대로', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValueOnce(completedEvaluation({ status: 'CEO_PENDING' }));
      await expectCode(service.getEmployeeResult('tok'), ConflictException, 'EVALUATION_NOT_COMPLETED');

      accessLinkMock.verify.mockRejectedValueOnce(new GoneException({ code: 'LINK_EXPIRED' }));
      await expectCode(service.getEmployeeResult('tok'), GoneException, 'LINK_EXPIRED');
      accessLinkMock.verify.mockRejectedValueOnce(new ForbiddenException({ code: 'INVALID_LINK_PURPOSE' }));
      await expectCode(service.getEmployeeResult('tok'), ForbiddenException, 'INVALID_LINK_PURPOSE');
    });
  });

  describe('의견 제출', () => {
    it('trim한 의견만 저장하고 점수는 건드리지 않으며 링크도 소비하지 않는다', async () => {
      const result = await service.submitOpinion('tok', { content: '  협업 점수 보완 설명  ' }, META);

      expect(result).toEqual({ evaluationId: 'ev-1', opinionId: 'op-1', submittedAt: new Date('2026-05-06T00:00:00.000Z') });
      expect(prismaMock.evaluationOpinion.create).toHaveBeenCalledWith({
        data: { evaluationId: 'ev-1', content: '협업 점수 보완 설명', submittedAt: new Date('2026-05-06T00:00:00.000Z') },
      });
      // 점수 불변: 자기점수·대표점수·역량 점수와 평가 본문에 대한 쓰기가 전혀 없다
      expect(prismaMock.evaluationItem.update).not.toHaveBeenCalled();
      expect(prismaMock.evaluationItem.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.competencyScore.update).not.toHaveBeenCalled();
      expect(prismaMock.competencyScore.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.competencyScore.createMany).not.toHaveBeenCalled();
      expect(prismaMock.evaluation.updateMany).not.toHaveBeenCalled();
      expect(accessLinkMock.consume).not.toHaveBeenCalled();
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'EMPLOYEE', action: 'OPINION_SUBMITTED', targetId: 'ev-1' }),
        prismaMock,
      );
    });

    it('이미 제출했으면 409 OPINION_ALREADY_SUBMITTED', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValue(completedEvaluation({ opinion: { id: 'op-0' } }));
      await expectCode(service.submitOpinion('tok', { content: '또 제출' }, META), ConflictException, 'OPINION_ALREADY_SUBMITTED');
      expect(prismaMock.evaluationOpinion.create).not.toHaveBeenCalled();
    });

    it('동시 제출로 unique 제약에 걸려도 409 OPINION_ALREADY_SUBMITTED', async () => {
      prismaMock.evaluationOpinion.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' }),
      );
      await expectCode(service.submitOpinion('tok', { content: '의견' }, META), ConflictException, 'OPINION_ALREADY_SUBMITTED');
    });

    it('의견 마감 1초 후 410 OPINION_PERIOD_EXPIRED, 마감 정각은 허용', async () => {
      jest.setSystemTime(new Date(OPINION_DUE.getTime() + 1000));
      await expectCode(service.submitOpinion('tok', { content: '늦은 의견' }, META), GoneException, 'OPINION_PERIOD_EXPIRED');
      expect(prismaMock.evaluationOpinion.create).not.toHaveBeenCalled();

      jest.setSystemTime(OPINION_DUE);
      await expect(service.submitOpinion('tok', { content: '정각 의견' }, META)).resolves.toMatchObject({ opinionId: 'op-1' });
    });

    it.each([
      ['빈 문자열', ''],
      ['공백만', '   \n\t '],
      ['1001자', '가'.repeat(1001)],
    ])('%s이면 422 INVALID_OPINION', async (_label, content) => {
      await expectCode(service.submitOpinion('tok', { content }, META), UnprocessableEntityException, 'INVALID_OPINION');
      expect(prismaMock.evaluationOpinion.create).not.toHaveBeenCalled();
    });

    it('정확히 1000자는 허용 (앞뒤 공백은 글자 수에서 제외)', async () => {
      await expect(service.submitOpinion('tok', { content: ` ${'가'.repeat(1000)} ` }, META)).resolves.toMatchObject({ opinionId: 'op-1' });
    });

    it('대표 검증 전이면 409 EVALUATION_NOT_COMPLETED', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValue(completedEvaluation({ status: 'CEO_PENDING' }));
      await expectCode(service.submitOpinion('tok', { content: '의견' }, META), ConflictException, 'EVALUATION_NOT_COMPLETED');
    });

    it('이미 제출 + 기한 지남이면 409가 410보다 먼저', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValue(completedEvaluation({ opinion: { id: 'op-0' } }));
      jest.setSystemTime(new Date(OPINION_DUE.getTime() + 1000));
      await expectCode(service.submitOpinion('tok', { content: '의견' }, META), ConflictException, 'OPINION_ALREADY_SUBMITTED');
    });

    it('만료·폐기 링크는 410 LINK_EXPIRED', async () => {
      accessLinkMock.verify.mockRejectedValueOnce(new GoneException({ code: 'LINK_EXPIRED' }));
      await expectCode(service.submitOpinion('tok', { content: '의견' }, META), GoneException, 'LINK_EXPIRED');
    });
  });
});
