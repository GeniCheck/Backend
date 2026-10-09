import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Employee, Prisma } from '@prisma/client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { AuditService } from '../audit/audit.service';
import { resolveCompanyId } from '../core/utils/company-scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** 감사 로그에 변경 전후를 남기는 수정 가능 필드 */
const UPDATABLE_FIELDS = ['name', 'phone', 'department', 'position', 'employmentStartDate'] as const;
type UpdatableField = (typeof UPDATABLE_FIELDS)[number];

type Client = PrismaService | Prisma.TransactionClient;

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: JwtPayload, dto: CreateEmployeeDto, meta: RequestMeta) {
    const companyId = await resolveCompanyId(user, this.prisma);
    // auth와 같은 규칙: 앞뒤 공백 제거 + 소문자
    const email = normalizeEmail(dto.email);

    const existing = await this.prisma.employee.findUnique({
      where: { companyId_email: { companyId, email } },
      select: { id: true },
    });
    if (existing) {
      throw employeeAlreadyExists();
    }

    try {
      const employee = await this.prisma.$transaction(async (tx) => {
        const created = await tx.employee.create({
          data: {
            companyId,
            name: dto.name.trim(),
            email,
            phone: blankToNull(dto.phone),
            department: blankToNull(dto.department),
            position: blankToNull(dto.position),
            employmentStartDate: parseDateOnly(dto.employmentStartDate),
            employmentStatus: 'EMPLOYED',
            declarationStatus: 'NOT_SENT',
          },
        });

        await this.auditService.log(
          {
            actorType: 'COMPANY',
            actorId: user.sub,
            action: 'EMPLOYEE_CREATED',
            targetType: 'Employee',
            targetId: created.id,
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
          tx,
        );

        return created;
      });

      return {
        employeeId: employee.id,
        employmentStatus: employee.employmentStatus,
        declarationStatus: employee.declarationStatus,
      };
    } catch (error) {
      // 중복 확인 직후 같은 이메일이 동시에 등록된 경우 (companyId, email) unique 위반
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw employeeAlreadyExists();
      }
      throw error;
    }
  }

  async list(user: JwtPayload, query: ListEmployeesQueryDto) {
    const companyId = await resolveCompanyId(user, this.prisma);
    const page = query.page ?? DEFAULT_PAGE;
    const size = query.size ?? DEFAULT_SIZE;
    const keyword = query.keyword?.trim();

    const where: Prisma.EmployeeWhereInput = {
      companyId,
      ...(query.status && { employmentStatus: query.status }),
      ...(query.declarationStatus && { declarationStatus: query.declarationStatus }),
      ...(keyword && {
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { department: { contains: keyword, mode: 'insensitive' } },
          { position: { contains: keyword, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, employees] = await this.prisma.$transaction([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * size,
        take: size,
        // 대표 평가 화면 진입용으로 최근 평가 1건의 id·상태·마감만 가져온다 (점수 등 민감 데이터 제외)
        include: {
          evaluations: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, ceoEvaluationDueAt: true },
          },
        },
      }),
    ]);

    return {
      items: employees.map((employee) => {
        const latestEvaluation = employee.evaluations[0] ?? null;
        return {
          employeeId: employee.id,
          name: employee.name,
          department: employee.department,
          position: employee.position,
          employmentStatus: employee.employmentStatus,
          declarationStatus: employee.declarationStatus,
          evaluationId: latestEvaluation?.id ?? null,
          evaluationStatus: latestEvaluation?.status ?? null,
          ceoEvaluationDueAt: latestEvaluation?.ceoEvaluationDueAt ?? null,
        };
      }),
      page,
      size,
      total,
    };
  }

  async findOne(user: JwtPayload, employeeId: string) {
    const companyId = await resolveCompanyId(user, this.prisma);
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        declarations: {
          orderBy: { sentAt: 'desc' },
          take: 1,
          select: { id: true, status: true, sentAt: true, submittedAt: true },
        },
        evaluations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            selfEvaluationDueAt: true,
            ceoEvaluationDueAt: true,
            opinionDueAt: true,
          },
        },
      },
    });
    assertOwned(employee, companyId);

    const declaration = employee.declarations[0] ?? null;
    const evaluation = employee.evaluations[0] ?? null;

    return {
      employeeId: employee.id,
      name: employee.name,
      email: employee.email,
      phone: employee.phone,
      department: employee.department,
      position: employee.position,
      employmentStartDate: formatDateOnly(employee.employmentStartDate),
      resignationDate: employee.resignationDate ? formatDateOnly(employee.resignationDate) : null,
      employmentStatus: employee.employmentStatus,
      declarationStatus: employee.declarationStatus,
      evaluationStatus: evaluation?.status ?? null,
      declaration: declaration && {
        declarationId: declaration.id,
        status: declaration.status,
        sentAt: declaration.sentAt,
        submittedAt: declaration.submittedAt,
      },
      evaluation: evaluation && {
        evaluationId: evaluation.id,
        status: evaluation.status,
        selfEvaluationDueAt: evaluation.selfEvaluationDueAt,
        ceoEvaluationDueAt: evaluation.ceoEvaluationDueAt,
        opinionDueAt: evaluation.opinionDueAt,
      },
    };
  }

  async update(user: JwtPayload, employeeId: string, dto: UpdateEmployeeDto, meta: RequestMeta) {
    // 재직·선언 상태는 이 API로 바꿀 수 없다 (퇴사는 별도 API)
    if (dto.employmentStatus !== undefined || dto.declarationStatus !== undefined) {
      throw new ConflictException({
        code: 'INVALID_STATUS_CHANGE',
        message: '재직·자기선언 상태는 이 API로 변경할 수 없습니다.',
      });
    }

    const companyId = await resolveCompanyId(user, this.prisma);

    return this.prisma.$transaction(async (tx) => {
      const employee = await findOwnedEmployee(tx, employeeId, companyId);

      const next: Partial<Record<UpdatableField, string | Date | null>> = {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.phone !== undefined && { phone: blankToNull(dto.phone) }),
        ...(dto.department !== undefined && { department: blankToNull(dto.department) }),
        ...(dto.position !== undefined && { position: blankToNull(dto.position) }),
        ...(dto.employmentStartDate !== undefined && {
          employmentStartDate: parseDateOnly(dto.employmentStartDate),
        }),
      };

      // 실제로 값이 바뀐 필드만 저장·기록
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const field of UPDATABLE_FIELDS) {
        if (!(field in next)) continue;
        const prev = auditValue(employee[field]);
        const value = auditValue(next[field] ?? null);
        if (prev !== value) {
          before[field] = prev;
          after[field] = value;
        }
      }

      let updated = employee;
      if (Object.keys(after).length > 0) {
        const changes = Object.fromEntries(
          Object.keys(after).map((field) => [field, next[field as UpdatableField]]),
        );
        updated = await tx.employee.update({ where: { id: employeeId }, data: changes });

        await this.auditService.log(
          {
            actorType: 'COMPANY',
            actorId: user.sub,
            action: 'EMPLOYEE_UPDATED',
            targetType: 'Employee',
            targetId: employeeId,
            ip: meta.ip,
            userAgent: meta.userAgent,
            metadata: { before, after } as Prisma.InputJsonValue,
          },
          tx,
        );
      }

      return {
        employeeId: updated.id,
        name: updated.name,
        phone: updated.phone,
        department: updated.department,
        position: updated.position,
        employmentStartDate: formatDateOnly(updated.employmentStartDate),
        updatedAt: updated.updatedAt,
      };
    });
  }
}

async function findOwnedEmployee(client: Client, employeeId: string, companyId: string): Promise<Employee> {
  const employee = await client.employee.findUnique({ where: { id: employeeId } });
  assertOwned(employee, companyId);
  return employee;
}

function assertOwned<T extends { companyId: string }>(
  employee: T | null,
  companyId: string,
): asserts employee is T {
  if (!employee) {
    throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: '직원을 찾을 수 없습니다.' });
  }
  if (employee.companyId !== companyId) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: '다른 기업의 직원에는 접근할 수 없습니다.',
    });
  }
}

function employeeAlreadyExists(): ConflictException {
  return new ConflictException({
    code: 'EMPLOYEE_ALREADY_EXISTS',
    message: '이미 등록된 직원 이메일입니다.',
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** 'YYYY-MM-DD'를 UTC 자정 Date로 저장 (KST로도 같은 날짜) */
function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function auditValue(value: string | Date | null): string | null {
  return value instanceof Date ? formatDateOnly(value) : value;
}
