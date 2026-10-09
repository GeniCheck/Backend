import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeService } from './employee.service';

const CEO = { sub: 'comp-1', role: 'COMPANY' as const };
const META = { ip: '127.0.0.1', userAgent: 'jest' };

const storedEmployee = (over: Record<string, unknown> = {}) => ({
  id: 'emp-1',
  companyId: 'comp-1',
  name: '김민준',
  email: 'minjun@example.com',
  phone: '010-5555-6666',
  department: '개발팀',
  position: '과장',
  employmentStartDate: new Date('2026-05-09T00:00:00.000Z'),
  employmentStatus: 'EMPLOYED',
  declarationStatus: 'NOT_SENT',
  resignationDate: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
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

describe('EmployeeService', () => {
  let prismaMock: any;
  let auditMock: { log: jest.Mock };
  let service: EmployeeService;

  beforeEach(() => {
    prismaMock = {
      hrManager: { findUnique: jest.fn() },
      employee: {
        findUnique: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg),
      ),
    };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };
    service = new EmployeeService(
      prismaMock as unknown as PrismaService,
      auditMock as unknown as AuditService,
    );
  });

  describe('create', () => {
    const dto = {
      name: ' 김민준 ',
      email: '  MinJun@Example.COM ',
      phone: '010-5555-6666',
      department: '',
      employmentStartDate: '2026-05-09',
    };

    it('이메일을 정규화해 EMPLOYED/NOT_SENT로 만들고 감사 로그를 같은 트랜잭션에 남긴다', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      prismaMock.employee.create.mockResolvedValue(storedEmployee());

      const result = await service.create(CEO, dto, META);

      expect(result).toEqual({ employeeId: 'emp-1', employmentStatus: 'EMPLOYED', declarationStatus: 'NOT_SENT' });
      expect(prismaMock.employee.findUnique).toHaveBeenCalledWith({
        where: { companyId_email: { companyId: 'comp-1', email: 'minjun@example.com' } },
        select: { id: true },
      });
      expect(prismaMock.employee.create).toHaveBeenCalledWith({
        data: {
          companyId: 'comp-1',
          name: '김민준',
          email: 'minjun@example.com',
          phone: '010-5555-6666',
          department: null,
          position: null,
          employmentStartDate: new Date('2026-05-09T00:00:00.000Z'),
          employmentStatus: 'EMPLOYED',
          declarationStatus: 'NOT_SENT',
        },
      });
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'COMPANY',
          actorId: 'comp-1',
          action: 'EMPLOYEE_CREATED',
          targetType: 'Employee',
          targetId: 'emp-1',
          ip: '127.0.0.1',
          userAgent: 'jest',
        }),
        prismaMock,
      );
    });

    it('같은 기업에 같은 이메일(대소문자 무시)이 있으면 409 EMPLOYEE_ALREADY_EXISTS', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-0' });

      await expectCode(service.create(CEO, dto, META), ConflictException, 'EMPLOYEE_ALREADY_EXISTS');
      expect(prismaMock.employee.create).not.toHaveBeenCalled();
      expect(auditMock.log).not.toHaveBeenCalled();
    });

    it('동시 등록으로 unique 제약에 걸려도 409 EMPLOYEE_ALREADY_EXISTS', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      prismaMock.employee.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );

      await expectCode(service.create(CEO, dto, META), ConflictException, 'EMPLOYEE_ALREADY_EXISTS');
    });
  });

  describe('list', () => {
    it('본인 기업 + 상태·선언상태·검색어 필터와 페이지네이션을 적용한다', async () => {
      prismaMock.employee.count.mockResolvedValue(48);
      prismaMock.employee.findMany.mockResolvedValue([]);

      const result = await service.list(CEO, {
        status: 'RESIGNED',
        declarationStatus: 'SUBMITTED',
        keyword: ' 개발 ',
        page: 3,
        size: 10,
      });

      const args = prismaMock.employee.findMany.mock.calls[0][0];
      const expectedWhere = {
        companyId: 'comp-1',
        employmentStatus: 'RESIGNED',
        declarationStatus: 'SUBMITTED',
        OR: [
          { name: { contains: '개발', mode: 'insensitive' } },
          { department: { contains: '개발', mode: 'insensitive' } },
          { position: { contains: '개발', mode: 'insensitive' } },
        ],
      };
      expect(args.where).toEqual(expectedWhere);
      expect(prismaMock.employee.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
      expect(result).toEqual({ items: [], page: 3, size: 10, total: 48 });
    });

    it('page·size 기본값은 1·20이고 필터가 없으면 companyId만 건다', async () => {
      prismaMock.employee.count.mockResolvedValue(0);
      prismaMock.employee.findMany.mockResolvedValue([]);

      const result = await service.list(CEO, {});

      expect(prismaMock.employee.findMany.mock.calls[0][0]).toMatchObject({
        where: { companyId: 'comp-1' },
        skip: 0,
        take: 20,
      });
      expect(result).toMatchObject({ page: 1, size: 20, total: 0 });
    });

    it('items에 최근 평가의 id·상태·대표 마감을 넣고, 평가가 없으면 null (이메일·점수 미포함)', async () => {
      prismaMock.employee.count.mockResolvedValue(2);
      prismaMock.employee.findMany.mockResolvedValue([
        { ...storedEmployee(), evaluations: [] },
        {
          ...storedEmployee({ id: 'emp-2', employmentStatus: 'RESIGNED', declarationStatus: 'SUBMITTED' }),
          evaluations: [{ id: 'ev-9', status: 'CEO_PENDING', ceoEvaluationDueAt: new Date('2026-05-15T14:59:59Z') }],
        },
      ]);

      const { items } = await service.list(CEO, {});

      expect(items).toEqual([
        {
          employeeId: 'emp-1', name: '김민준', department: '개발팀', position: '과장',
          employmentStatus: 'EMPLOYED', declarationStatus: 'NOT_SENT',
          evaluationId: null, evaluationStatus: null, ceoEvaluationDueAt: null,
        },
        {
          employeeId: 'emp-2', name: '김민준', department: '개발팀', position: '과장',
          employmentStatus: 'RESIGNED', declarationStatus: 'SUBMITTED',
          evaluationId: 'ev-9', evaluationStatus: 'CEO_PENDING', ceoEvaluationDueAt: new Date('2026-05-15T14:59:59Z'),
        },
      ]);
      expect(prismaMock.employee.findMany.mock.calls[0][0].include.evaluations).toEqual({
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, ceoEvaluationDueAt: true },
      });
    });
  });

  describe('findOne', () => {
    it('기본 정보와 최근 자기선언·평가 요약을 반환한다', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({
        ...storedEmployee({ declarationStatus: 'SUBMITTED' }),
        declarations: [{ id: 'decl-1', status: 'SUBMITTED', sentAt: new Date('2026-05-10T00:00:00Z'), submittedAt: new Date('2026-05-11T00:00:00Z') }],
        evaluations: [],
      });

      const result = await service.findOne(CEO, 'emp-1');

      expect(result).toMatchObject({
        employeeId: 'emp-1',
        email: 'minjun@example.com',
        employmentStartDate: '2026-05-09',
        resignationDate: null,
        declarationStatus: 'SUBMITTED',
        evaluationStatus: null,
        declaration: { declarationId: 'decl-1', status: 'SUBMITTED' },
        evaluation: null,
      });
    });

    it('없으면 404 EMPLOYEE_NOT_FOUND, 다른 기업 직원이면 403 FORBIDDEN', async () => {
      prismaMock.employee.findUnique.mockResolvedValueOnce(null);
      await expectCode(service.findOne(CEO, 'nope'), NotFoundException, 'EMPLOYEE_NOT_FOUND');

      prismaMock.employee.findUnique.mockResolvedValueOnce({
        ...storedEmployee({ companyId: 'comp-other' }), declarations: [], evaluations: [],
      });
      await expectCode(service.findOne(CEO, 'emp-1'), ForbiddenException, 'FORBIDDEN');
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prismaMock.employee.findUnique.mockResolvedValue(storedEmployee());
      prismaMock.employee.update.mockImplementation(async ({ data }: any) => storedEmployee(data));
    });

    it('바뀐 필드만 저장하고 변경 전후를 감사 로그에 남긴다', async () => {
      const result = await service.update(
        CEO,
        'emp-1',
        { department: '플랫폼 개발팀', position: '과장', phone: null, employmentStartDate: '2026-05-01' },
        META,
      );

      expect(prismaMock.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: {
          phone: null,
          department: '플랫폼 개발팀',
          employmentStartDate: new Date('2026-05-01T00:00:00.000Z'),
        },
      });
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'EMPLOYEE_UPDATED',
          targetId: 'emp-1',
          metadata: {
            before: { phone: '010-5555-6666', department: '개발팀', employmentStartDate: '2026-05-09' },
            after: { phone: null, department: '플랫폼 개발팀', employmentStartDate: '2026-05-01' },
          },
        }),
        prismaMock,
      );
      expect(result).toMatchObject({
        employeeId: 'emp-1',
        department: '플랫폼 개발팀',
        position: '과장',
        phone: null,
        employmentStartDate: '2026-05-01',
      });
    });

    it('바뀐 값이 없으면 저장·감사 로그를 남기지 않는다', async () => {
      await service.update(CEO, 'emp-1', { name: '김민준', department: '개발팀' }, META);

      expect(prismaMock.employee.update).not.toHaveBeenCalled();
      expect(auditMock.log).not.toHaveBeenCalled();
    });

    it('재직·선언 상태를 바꾸려 하면 409 INVALID_STATUS_CHANGE', async () => {
      await expectCode(
        service.update(CEO, 'emp-1', { employmentStatus: 'RESIGNED' }, META),
        ConflictException,
        'INVALID_STATUS_CHANGE',
      );
      await expectCode(
        service.update(CEO, 'emp-1', { declarationStatus: 'SUBMITTED' }, META),
        ConflictException,
        'INVALID_STATUS_CHANGE',
      );
      expect(prismaMock.employee.update).not.toHaveBeenCalled();
    });

    it('다른 기업 직원은 403, 없는 직원은 404', async () => {
      prismaMock.employee.findUnique.mockResolvedValueOnce(storedEmployee({ companyId: 'comp-other' }));
      await expectCode(service.update(CEO, 'emp-1', { name: 'x' }, META), ForbiddenException, 'FORBIDDEN');

      prismaMock.employee.findUnique.mockResolvedValueOnce(null);
      await expectCode(service.update(CEO, 'nope', { name: 'x' }, META), NotFoundException, 'EMPLOYEE_NOT_FOUND');
      expect(prismaMock.employee.update).not.toHaveBeenCalled();
    });
  });
});
