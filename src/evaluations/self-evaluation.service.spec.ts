import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SelfEvaluationService } from './self-evaluation.service';

const META = { ip: '127.0.0.1', userAgent: 'jest' };
const CEO_DUE = new Date('2026-05-15T14:59:59.000Z');

const snapshot = (id: string, order: number, type: string, extra: Record<string, unknown>, response: Record<string, unknown> | null) => ({
  id, declarationId: 'decl-1', order, type, text: `질문 ${order}`, required: true,
  scoreMin: null, scoreMax: null, options: null, maxLength: null, evaluationEnabled: true,
  ...extra,
  response: response && { id: `resp-${id}`, snapshotQuestionId: id, answerScore: null, answerOptionId: null, answerText: null, ...response },
});

const evaluationWithItems = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  companyId: 'comp-1',
  employeeId: 'emp-1',
  status: 'SELF_PENDING',
  selfEvaluationDueAt: new Date('2026-05-03T14:59:59.000Z'),
  ceoEvaluationDueAt: CEO_DUE,
  employee: { name: '김민준' },
  items: [
    { id: 'it-1', snapshotQuestionId: 'snap-1', order: 1, selfScore: null, ceoScore: null,
      snapshotQuestion: snapshot('snap-1', 1, 'SCORE', { scoreMin: 1, scoreMax: 10 }, { answerScore: 8 }) },
    { id: 'it-2', snapshotQuestionId: 'snap-2', order: 2, selfScore: null, ceoScore: null,
      snapshotQuestion: snapshot('snap-2', 2, 'SINGLE_CHOICE', { options: [{ optionId: 'opt-a', label: '개인' }, { optionId: 'opt-b', label: '팀' }] }, { answerOptionId: 'opt-b' }) },
    { id: 'it-3', snapshotQuestionId: 'snap-3', order: 3, selfScore: null, ceoScore: null,
      snapshotQuestion: snapshot('snap-3', 3, 'TEXT', { maxLength: 500 }, { answerText: 'React 성능 개선' }) },
  ],
  ...over,
});

const ITEMS = [
  { questionId: 'snap-1', selfScore: 8 },
  { questionId: 'snap-2', selfScore: 7 },
  { questionId: 'snap-3', selfScore: 9 },
];

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

describe('SelfEvaluationService', () => {
  let prismaMock: any;
  let accessLinkMock: { verify: jest.Mock; consume: jest.Mock };
  let auditMock: { log: jest.Mock };
  let service: SelfEvaluationService;

  beforeEach(() => {
    prismaMock = {
      evaluation: {
        findUnique: jest.fn().mockResolvedValue(evaluationWithItems()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      evaluationItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      company: { findUnique: jest.fn().mockResolvedValue({ companyName: '테크플러스 주식회사' }) },
      $transaction: jest.fn(async (fn: any) => fn(prismaMock)),
    };
    accessLinkMock = {
      verify: jest.fn().mockResolvedValue({ id: 'link-1', purpose: 'SELF_EVALUATION', targetId: 'ev-1', expiresAt: new Date() }),
      consume: jest.fn().mockResolvedValue(undefined),
    };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };
    service = new SelfEvaluationService(
      prismaMock as unknown as PrismaService,
      accessLinkMock as unknown as AccessLinkService,
      auditMock as unknown as AuditService,
    );
  });

  describe('getForm', () => {
    it('자기선언 답변과 평가 항목을 order순으로 반환하고 링크는 소비하지 않는다', async () => {
      const form = await service.getForm('tok');

      expect(accessLinkMock.verify).toHaveBeenCalledWith('tok', 'SELF_EVALUATION');
      expect(accessLinkMock.consume).not.toHaveBeenCalled();
      expect(form).toEqual({
        evaluationId: 'ev-1',
        employee: { name: '김민준', companyName: '테크플러스 주식회사' },
        status: 'SELF_PENDING',
        dueAt: new Date('2026-05-03T14:59:59.000Z'),
        scoreMin: 1,
        scoreMax: 10,
        items: [
          { questionId: 'snap-1', order: 1, question: '질문 1', declarationAnswer: { type: 'SCORE', score: 8 }, selfScore: null },
          { questionId: 'snap-2', order: 2, question: '질문 2', declarationAnswer: { type: 'SINGLE_CHOICE', optionId: 'opt-b', label: '팀' }, selfScore: null },
          { questionId: 'snap-3', order: 3, question: '질문 3', declarationAnswer: { type: 'TEXT', text: 'React 성능 개선' }, selfScore: null },
        ],
      });
    });

    it('자기선언에서 답하지 않은 선택 질문은 답변 값이 null', async () => {
      const ev = evaluationWithItems();
      ev.items[2].snapshotQuestion = snapshot('snap-3', 3, 'TEXT', { maxLength: 500, required: false }, null);
      prismaMock.evaluation.findUnique.mockResolvedValue(ev);

      const form = await service.getForm('tok');

      expect(form.items[2].declarationAnswer).toEqual({ type: 'TEXT', text: null });
    });

    it.each(['CEO_PENDING', 'SELF_EXPIRED', 'COMPLETED', 'CEO_EXPIRED'])(
      'SELF_PENDING이 아니면(%s) 409 INVALID_EVALUATION_STATUS',
      async (status) => {
        prismaMock.evaluation.findUnique.mockResolvedValue(evaluationWithItems({ status }));
        await expectCode(service.getForm('tok'), ConflictException, 'INVALID_EVALUATION_STATUS');
      },
    );

    it('링크 검증 오류(410 만료, 403 목적 불일치)는 그대로 전달된다', async () => {
      accessLinkMock.verify.mockRejectedValueOnce(new GoneException({ code: 'LINK_EXPIRED' }));
      await expectCode(service.getForm('tok'), GoneException, 'LINK_EXPIRED');

      accessLinkMock.verify.mockRejectedValueOnce(new ForbiddenException({ code: 'INVALID_LINK_PURPOSE' }));
      await expectCode(service.getForm('tok'), ForbiddenException, 'INVALID_LINK_PURPOSE');
    });
  });

  describe('submit', () => {
    it('자기점수 저장 → CEO_PENDING 전환 → 링크 소비를 한 트랜잭션에서 처리한다', async () => {
      const result = await service.submit('tok', { items: ITEMS }, META);

      expect(result).toEqual({
        evaluationId: 'ev-1',
        status: 'CEO_PENDING',
        submittedAt: expect.any(Date),
        ceoEvaluationDueAt: CEO_DUE,
      });
      expect(accessLinkMock.verify).toHaveBeenCalledWith('tok', 'SELF_EVALUATION', prismaMock);
      expect(prismaMock.evaluation.updateMany).toHaveBeenCalledWith({
        where: { id: 'ev-1', status: 'SELF_PENDING' },
        data: { status: 'CEO_PENDING', selfSubmittedAt: result.submittedAt },
      });
      expect(prismaMock.evaluationItem.updateMany).toHaveBeenCalledTimes(3);
      expect(prismaMock.evaluationItem.updateMany).toHaveBeenCalledWith({
        where: { evaluationId: 'ev-1', snapshotQuestionId: 'snap-2' },
        data: { selfScore: 7 },
      });
      expect(accessLinkMock.consume).toHaveBeenCalledWith('link-1', prismaMock);
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'EMPLOYEE', action: 'SELF_EVALUATION_SUBMITTED', targetId: 'ev-1' }),
        prismaMock,
      );
    });

    it('항목 누락·중복·없는 항목이면 400 MISSING_EVALUATION_ITEM이고 저장하지 않는다', async () => {
      await expectCode(service.submit('tok', { items: ITEMS.slice(0, 2) }, META), BadRequestException, 'MISSING_EVALUATION_ITEM');
      await expectCode(service.submit('tok', { items: [...ITEMS, ITEMS[0]] }, META), BadRequestException, 'MISSING_EVALUATION_ITEM');
      await expectCode(
        service.submit('tok', { items: [...ITEMS, { questionId: 'snap-x', selfScore: 5 }] }, META),
        BadRequestException,
        'MISSING_EVALUATION_ITEM',
      );
      expect(prismaMock.evaluation.updateMany).not.toHaveBeenCalled();
      expect(accessLinkMock.consume).not.toHaveBeenCalled();
    });

    it.each([0, 11, 7.5, -1])('점수가 1~10 정수가 아니면(%s) 422 INVALID_SCORE', async (score) => {
      await expectCode(
        service.submit('tok', { items: [{ questionId: 'snap-1', selfScore: score }, ITEMS[1], ITEMS[2]] }, META),
        UnprocessableEntityException,
        'INVALID_SCORE',
      );
      expect(prismaMock.evaluation.updateMany).not.toHaveBeenCalled();
    });

    it('SELF_PENDING이 아니면 409 ALREADY_SUBMITTED', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValue(evaluationWithItems({ status: 'CEO_PENDING' }));
      await expectCode(service.submit('tok', { items: ITEMS }, META), ConflictException, 'ALREADY_SUBMITTED');
    });

    it('동시 제출로 먼저 전환됐으면(갱신 0건) 409 ALREADY_SUBMITTED이고 점수·링크를 건드리지 않는다', async () => {
      prismaMock.evaluation.updateMany.mockResolvedValue({ count: 0 });
      await expectCode(service.submit('tok', { items: ITEMS }, META), ConflictException, 'ALREADY_SUBMITTED');
      expect(prismaMock.evaluationItem.updateMany).not.toHaveBeenCalled();
      expect(accessLinkMock.consume).not.toHaveBeenCalled();
    });

    it('이미 사용된 링크(409)·만료 링크(410)는 링크 검증에서 막힌다', async () => {
      accessLinkMock.verify.mockRejectedValueOnce(new ConflictException({ code: 'ALREADY_SUBMITTED' }));
      await expectCode(service.submit('tok', { items: ITEMS }, META), ConflictException, 'ALREADY_SUBMITTED');

      accessLinkMock.verify.mockRejectedValueOnce(new GoneException({ code: 'LINK_EXPIRED' }));
      await expectCode(service.submit('tok', { items: ITEMS }, META), GoneException, 'LINK_EXPIRED');
      expect(prismaMock.evaluation.updateMany).not.toHaveBeenCalled();
    });

    it('평가 항목이 0개면 빈 items로 제출할 수 있다', async () => {
      prismaMock.evaluation.findUnique.mockResolvedValue(evaluationWithItems({ items: [] }));
      await expect(service.submit('tok', { items: [] }, META)).resolves.toMatchObject({ status: 'CEO_PENDING' });
    });
  });
});
