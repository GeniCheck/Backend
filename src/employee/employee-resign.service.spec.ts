import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notification/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeResignService } from './employee-resign.service';

const CEO = { sub: 'comp-1', role: 'COMPANY' as const };
const META = { ip: '127.0.0.1', userAgent: 'jest' };
const DTO = { employeeId: 'emp-1', resignationDate: '2026-04-30', selfEvaluationSendChannel: 'EMAIL' as const };

const employee = (over: Record<string, unknown> = {}) => ({
  id: 'emp-1',
  companyId: 'comp-1',
  name: '김민준',
  email: 'minjun@example.com',
  employmentStartDate: new Date('2025-01-02T00:00:00.000Z'),
  employmentStatus: 'EMPLOYED',
  declarationStatus: 'SUBMITTED',
  ...over,
});

const snapshot = (id: string, order: number, evaluationEnabled: boolean) => ({
  id, declarationId: 'decl-1', order, type: 'SCORE', text: `질문 ${order}`, required: true,
  scoreMin: 1, scoreMax: 10, options: null, maxLength: null, evaluationEnabled,
});

const submittedDeclaration = (over: Record<string, unknown> = {}) => ({
  id: 'decl-1',
  employeeId: 'emp-1',
  status: 'SUBMITTED',
  questions: [snapshot('snap-1', 1, true), snapshot('snap-2', 2, false), snapshot('snap-3', 3, true)],
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

describe('EmployeeResignService', () => {
  let prismaMock: any;
  let accessLinkMock: { issue: jest.Mock };
  let mailMock: { sendSelfEvaluationLink: jest.Mock };
  let auditMock: { log: jest.Mock };
  let service: EmployeeResignService;
  let committed: boolean;

  beforeEach(() => {
    committed = false;
    prismaMock = {
      hrManager: { findUnique: jest.fn() },
      employee: {
        findUnique: jest.fn().mockResolvedValue(employee()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      declaration: { findFirst: jest.fn().mockResolvedValue(submittedDeclaration()) },
      evaluation: {
        create: jest.fn(async ({ data }: any) => ({ id: 'ev-1', ...data })),
      },
      company: { findUnique: jest.fn().mockResolvedValue({ companyName: '테크플러스' }) },
      $transaction: jest.fn(async (fn: any) => {
        const result = await fn(prismaMock);
        committed = true;
        return result;
      }),
    };
    accessLinkMock = { issue: jest.fn().mockResolvedValue('raw-token') };
    mailMock = {
      sendSelfEvaluationLink: jest.fn(async () => {
        // 메일은 트랜잭션 커밋 후에만 나가야 한다
        expect(committed).toBe(true);
        return true;
      }),
    };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };
    service = new EmployeeResignService(
      prismaMock as unknown as PrismaService,
      accessLinkMock as unknown as AccessLinkService,
      mailMock as unknown as MailService,
      auditMock as unknown as AuditService,
    );
  });

  it('퇴사 처리 + SELF_PENDING 평가 생성 + 마감일(+3, +15일 KST 23:59:59) + 자기평가 링크 발급', async () => {
    const result = await service.resign(CEO, DTO, META);

    // 2026-04-30 퇴사 → 자기평가 2026-05-03 23:59:59 KST, 대표 검증 2026-05-15 23:59:59 KST
    expect(result).toEqual({
      employmentId: 'emp-1',
      evaluationId: 'ev-1',
      employmentStatus: 'RESIGNED',
      evaluationStatus: 'SELF_PENDING',
      selfEvaluationDueAt: new Date('2026-05-03T14:59:59.000Z'),
      ceoEvaluationDueAt: new Date('2026-05-15T14:59:59.000Z'),
      linkSent: true,
    });

    expect(prismaMock.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', employmentStatus: 'EMPLOYED' },
      data: { employmentStatus: 'RESIGNED', resignationDate: new Date('2026-04-30T00:00:00.000Z') },
    });

    const { data } = prismaMock.evaluation.create.mock.calls[0][0];
    expect(data).toMatchObject({
      companyId: 'comp-1',
      employeeId: 'emp-1',
      declarationId: 'decl-1',
      status: 'SELF_PENDING',
      resignationDate: new Date('2026-04-30T00:00:00.000Z'),
      selfEvaluationDueAt: new Date('2026-05-03T14:59:59.000Z'),
      ceoEvaluationDueAt: new Date('2026-05-15T14:59:59.000Z'),
    });

    expect(accessLinkMock.issue).toHaveBeenCalledWith(
      'SELF_EVALUATION',
      'ev-1',
      new Date('2026-05-03T14:59:59.000Z'),
      prismaMock,
    );
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EMPLOYEE_RESIGNED', targetType: 'Employee', targetId: 'emp-1' }),
      prismaMock,
    );
    expect(mailMock.sendSelfEvaluationLink).toHaveBeenCalledWith({
      to: 'minjun@example.com',
      token: 'raw-token',
      employeeName: '김민준',
      companyName: '테크플러스',
      expiresAt: new Date('2026-05-03T14:59:59.000Z'),
    });
  });

  it('evaluationEnabled=false 질문은 평가 항목에서 빼고, 자기선언 순서를 유지하며 점수는 비워 둔다', async () => {
    await service.resign(CEO, DTO, META);

    const { data } = prismaMock.evaluation.create.mock.calls[0][0];
    expect(data.items.create).toEqual([
      { snapshotQuestionId: 'snap-1', order: 1 },
      { snapshotQuestionId: 'snap-3', order: 3 },
    ]);
  });

  it('마감일은 월말·연말을 넘겨도 KST 기준으로 계산한다', async () => {
    const result = await service.resign(CEO, { ...DTO, resignationDate: '2026-12-30' }, META);

    expect(result.selfEvaluationDueAt).toEqual(new Date('2027-01-02T14:59:59.000Z'));
    expect(result.ceoEvaluationDueAt).toEqual(new Date('2027-01-14T14:59:59.000Z'));
  });

  it('메일 발송이 실패해도 커밋된 퇴사·평가 데이터는 유지되고 linkSent=false', async () => {
    mailMock.sendSelfEvaluationLink.mockResolvedValue(false);

    const result = await service.resign(CEO, DTO, META);

    expect(result.linkSent).toBe(false);
    expect(committed).toBe(true);
    expect(prismaMock.evaluation.create).toHaveBeenCalled();
    expect(accessLinkMock.issue).toHaveBeenCalled();
  });

  describe('에러', () => {
    it('다른 기업 직원이면 403 FORBIDDEN', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(employee({ companyId: 'comp-other' }));
      await expectCode(service.resign(CEO, DTO, META), ForbiddenException, 'FORBIDDEN');
    });

    it('이미 퇴사한 직원이면 409 ALREADY_RESIGNED', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(employee({ employmentStatus: 'RESIGNED' }));
      await expectCode(service.resign(CEO, DTO, META), ConflictException, 'ALREADY_RESIGNED');
    });

    it('동시 요청으로 먼저 퇴사 처리됐으면(갱신 0건) 409 ALREADY_RESIGNED이고 평가를 만들지 않는다', async () => {
      prismaMock.employee.updateMany.mockResolvedValue({ count: 0 });
      await expectCode(service.resign(CEO, DTO, META), ConflictException, 'ALREADY_RESIGNED');
      expect(prismaMock.evaluation.create).not.toHaveBeenCalled();
      expect(mailMock.sendSelfEvaluationLink).not.toHaveBeenCalled();
    });

    it('최근 자기선언이 없거나 미제출(SENT)이면 409 DECLARATION_NOT_SUBMITTED', async () => {
      prismaMock.declaration.findFirst.mockResolvedValueOnce(null);
      await expectCode(service.resign(CEO, DTO, META), ConflictException, 'DECLARATION_NOT_SUBMITTED');

      prismaMock.declaration.findFirst.mockResolvedValueOnce(submittedDeclaration({ status: 'SENT' }));
      await expectCode(service.resign(CEO, DTO, META), ConflictException, 'DECLARATION_NOT_SUBMITTED');

      expect(prismaMock.declaration.findFirst).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1' },
        orderBy: { sentAt: 'desc' },
        include: { questions: { orderBy: { order: 'asc' } } },
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('입사일 이전이거나 달력에 없는 날짜면 422 INVALID_RESIGNATION_DATE', async () => {
      await expectCode(
        service.resign(CEO, { ...DTO, resignationDate: '2025-01-01' }, META),
        UnprocessableEntityException,
        'INVALID_RESIGNATION_DATE',
      );
      await expectCode(
        service.resign(CEO, { ...DTO, resignationDate: '2026-02-30' }, META),
        UnprocessableEntityException,
        'INVALID_RESIGNATION_DATE',
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('입사일 당일 퇴사는 허용한다', async () => {
      await expect(service.resign(CEO, { ...DTO, resignationDate: '2025-01-02' }, META)).resolves.toMatchObject({
        employmentStatus: 'RESIGNED',
      });
    });

    it('없는 직원이면 404 EMPLOYEE_NOT_FOUND', async () => {
      prismaMock.employee.findUnique.mockResolvedValue(null);
      await expectCode(service.resign(CEO, DTO, META), NotFoundException, 'EMPLOYEE_NOT_FOUND');
    });
  });
});
