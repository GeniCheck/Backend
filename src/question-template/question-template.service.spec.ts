import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTemplateService } from './question-template.service';
import { QuestionDto } from './dto/question.dto';

const CEO = { sub: 'comp-1', role: 'COMPANY' as const };

const scoreQuestion = (over: Partial<QuestionDto> = {}): QuestionDto => ({
  order: 1,
  type: 'SCORE',
  text: '업무 책임감을 평가해 주세요.',
  required: true,
  scoreMin: 1,
  scoreMax: 10,
  evaluationEnabled: true,
  ...over,
});

// DB에 저장된 형태의 템플릿 질문
const storedScore = {
  id: 'q-1',
  templateId: 'tpl-1',
  order: 1,
  type: 'SCORE',
  text: '업무 책임감을 평가해 주세요.',
  required: true,
  scoreMin: 1,
  scoreMax: 10,
  options: null,
  maxLength: null,
  evaluationEnabled: true,
};

const storedTemplate = (over: Record<string, unknown> = {}) => ({
  id: 'tpl-1',
  companyId: 'comp-1',
  name: '개발직군 입사 자기선언',
  description: null,
  version: 1,
  status: 'ACTIVE',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  questions: [storedScore],
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

describe('QuestionTemplateService', () => {
  let prismaMock: any;
  let service: QuestionTemplateService;

  beforeEach(() => {
    prismaMock = {
      hrManager: { findUnique: jest.fn() },
      questionTemplate: {
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      templateQuestion: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
      ),
    };
    service = new QuestionTemplateService(prismaMock as unknown as PrismaService);
  });

  describe('create', () => {
    it('대표 기업으로 version 1 템플릿을 만들고 요약을 반환한다', async () => {
      prismaMock.questionTemplate.create.mockResolvedValue(storedTemplate());

      const result = await service.create(CEO, {
        name: ' 개발직군 입사 자기선언 ',
        questions: [scoreQuestion()],
      });

      expect(result).toEqual({ templateId: 'tpl-1', version: 1, questionCount: 1, status: 'ACTIVE' });
      const { data } = prismaMock.questionTemplate.create.mock.calls[0][0];
      expect(data.companyId).toBe('comp-1');
      expect(data.name).toBe('개발직군 입사 자기선언');
      expect(data.questions.create).toEqual([
        expect.objectContaining({ order: 1, type: 'SCORE', scoreMin: 1, scoreMax: 10, maxLength: null }),
      ]);
    });

    it('질문 제약조건 위반이면 422 INVALID_QUESTION_SET이고 저장하지 않는다', async () => {
      await expectCode(
        service.create(CEO, { name: 't', questions: [scoreQuestion({ scoreMax: 11 })] }),
        UnprocessableEntityException,
        'INVALID_QUESTION_SET',
      );
      expect(prismaMock.questionTemplate.create).not.toHaveBeenCalled();
    });

    it('대표·인사팀장이 아닌 역할은 403', async () => {
      await expectCode(
        service.create({ sub: 'app-1', role: 'APPLICANT' }, { name: 't', questions: [scoreQuestion()] }),
        ForbiddenException,
        'FORBIDDEN',
      );
    });
  });

  describe('list', () => {
    it('본인 기업만 최신 수정순으로 조회하고 페이지 정보를 반환한다', async () => {
      prismaMock.questionTemplate.count.mockResolvedValue(21);
      prismaMock.questionTemplate.findMany.mockResolvedValue([
        { ...storedTemplate({ version: 2 }), _count: { questions: 3 } },
      ]);

      const result = await service.list(CEO, { status: 'ACTIVE', keyword: ' 개발 ', page: 2, size: 20 });

      const args = prismaMock.questionTemplate.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        companyId: 'comp-1',
        status: 'ACTIVE',
        OR: [
          { name: { contains: '개발', mode: 'insensitive' } },
          { description: { contains: '개발', mode: 'insensitive' } },
        ],
      });
      expect(args.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'asc' }]);
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(result).toEqual({
        items: [{
          templateId: 'tpl-1', name: '개발직군 입사 자기선언', version: 2, questionCount: 3,
          status: 'ACTIVE', updatedAt: new Date('2026-10-01T00:00:00Z'),
        }],
        page: 2,
        size: 20,
        totalElements: 21,
      });
    });

    it('page·size 기본값은 1·20', async () => {
      prismaMock.questionTemplate.count.mockResolvedValue(0);
      prismaMock.questionTemplate.findMany.mockResolvedValue([]);

      const result = await service.list(CEO, {});

      expect(prismaMock.questionTemplate.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
      expect(result).toMatchObject({ page: 1, size: 20, totalElements: 0 });
    });
  });

  describe('findOne', () => {
    it('질문을 order순으로, 유형에 맞는 필드만 반환한다', async () => {
      prismaMock.questionTemplate.findUnique.mockResolvedValue(storedTemplate({
        questions: [
          storedScore,
          { ...storedScore, id: 'q-2', order: 2, type: 'SINGLE_CHOICE', scoreMin: null, scoreMax: null, options: ['A', 'B'] },
          { ...storedScore, id: 'q-3', order: 3, type: 'TEXT', scoreMin: null, scoreMax: null, maxLength: 500 },
        ],
      }));

      const result = await service.findOne(CEO, 'tpl-1');

      expect(prismaMock.questionTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: 'tpl-1' },
        include: { questions: { orderBy: { order: 'asc' } } },
      });
      expect(result.questions).toEqual([
        { questionId: 'q-1', order: 1, type: 'SCORE', text: storedScore.text, required: true, scoreMin: 1, scoreMax: 10, evaluationEnabled: true },
        { questionId: 'q-2', order: 2, type: 'SINGLE_CHOICE', text: storedScore.text, required: true, options: ['A', 'B'], evaluationEnabled: true },
        { questionId: 'q-3', order: 3, type: 'TEXT', text: storedScore.text, required: true, maxLength: 500, evaluationEnabled: true },
      ]);
    });

    it('없으면 404 QUESTION_TEMPLATE_NOT_FOUND', async () => {
      prismaMock.questionTemplate.findUnique.mockResolvedValue(null);
      await expectCode(service.findOne(CEO, 'nope'), NotFoundException, 'QUESTION_TEMPLATE_NOT_FOUND');
    });

    it('다른 기업 템플릿이면 403 FORBIDDEN', async () => {
      prismaMock.questionTemplate.findUnique.mockResolvedValue(storedTemplate({ companyId: 'comp-other' }));
      await expectCode(service.findOne(CEO, 'tpl-1'), ForbiddenException, 'FORBIDDEN');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prismaMock.questionTemplate.findUnique.mockResolvedValue(storedTemplate());
    });

    it('질문이 바뀌면 트랜잭션으로 질문을 교체하고 version을 1 올린다', async () => {
      const result = await service.update(CEO, 'tpl-1', {
        version: 1,
        questions: [scoreQuestion({ scoreMax: 5 }), scoreQuestion({ order: 2, text: '협업 능력' })],
      });

      expect(result).toEqual({ templateId: 'tpl-1', version: 2, questionCount: 2, status: 'ACTIVE' });
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.questionTemplate.updateMany).toHaveBeenCalledWith({
        where: { id: 'tpl-1', version: 1 },
        data: { version: { increment: 1 } },
      });
      expect(prismaMock.templateQuestion.deleteMany).toHaveBeenCalledWith({ where: { templateId: 'tpl-1' } });
      expect(prismaMock.templateQuestion.createMany.mock.calls[0][0].data).toHaveLength(2);
    });

    it('이름·상태만 바꾸면 질문은 그대로 두고 version도 유지한다 (ARCHIVED 전환)', async () => {
      const result = await service.update(CEO, 'tpl-1', { version: 1, name: '새 이름', status: 'ARCHIVED' });

      expect(result).toEqual({ templateId: 'tpl-1', version: 1, questionCount: 1, status: 'ARCHIVED' });
      expect(prismaMock.questionTemplate.updateMany).toHaveBeenCalledWith({
        where: { id: 'tpl-1', version: 1 },
        data: { name: '새 이름', status: 'ARCHIVED' },
      });
      expect(prismaMock.templateQuestion.deleteMany).not.toHaveBeenCalled();
    });

    it('기존과 같은 질문을 보내면 version을 올리지 않는다', async () => {
      const result = await service.update(CEO, 'tpl-1', { version: 1, questions: [scoreQuestion()] });

      expect(result.version).toBe(1);
      expect(prismaMock.questionTemplate.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.templateQuestion.deleteMany).not.toHaveBeenCalled();
    });

    it('요청 버전이 현재 버전과 다르면 409 TEMPLATE_VERSION_CONFLICT', async () => {
      await expectCode(
        service.update(CEO, 'tpl-1', { version: 2, name: 'x' }),
        ConflictException,
        'TEMPLATE_VERSION_CONFLICT',
      );
      expect(prismaMock.questionTemplate.updateMany).not.toHaveBeenCalled();
    });

    it('조회 직후 다른 요청이 먼저 수정했으면(갱신 0건) 409', async () => {
      prismaMock.questionTemplate.updateMany.mockResolvedValue({ count: 0 });
      await expectCode(
        service.update(CEO, 'tpl-1', { version: 1, questions: [scoreQuestion({ scoreMax: 5 })] }),
        ConflictException,
        'TEMPLATE_VERSION_CONFLICT',
      );
      expect(prismaMock.templateQuestion.deleteMany).not.toHaveBeenCalled();
    });

    it('다른 기업 템플릿 수정은 403, 없는 템플릿은 404', async () => {
      prismaMock.questionTemplate.findUnique.mockResolvedValueOnce(storedTemplate({ companyId: 'comp-other' }));
      await expectCode(service.update(CEO, 'tpl-1', { version: 1, name: 'x' }), ForbiddenException, 'FORBIDDEN');

      prismaMock.questionTemplate.findUnique.mockResolvedValueOnce(null);
      await expectCode(
        service.update(CEO, 'nope', { version: 1, name: 'x' }),
        NotFoundException,
        'QUESTION_TEMPLATE_NOT_FOUND',
      );
      expect(prismaMock.questionTemplate.updateMany).not.toHaveBeenCalled();
    });

    it('질문 제약조건 위반이면 DB 조회 전에 422', async () => {
      await expectCode(
        service.update(CEO, 'tpl-1', { version: 1, questions: [scoreQuestion({ scoreMin: 0 })] }),
        UnprocessableEntityException,
        'INVALID_QUESTION_SET',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
