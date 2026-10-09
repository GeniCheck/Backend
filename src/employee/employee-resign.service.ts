import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { resolveCompanyId } from '../core/utils/company-scope';
import { endOfDayKstAfter } from '../core/utils/kst-date';
import { MailService } from '../notification/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { RequestMeta } from './employee.service';

/** 자기평가 마감 = 퇴사일 + 3일, 대표 검증 마감 = 퇴사일 + 15일 (KST 23:59:59) */
export const SELF_EVALUATION_DUE_DAYS = 3;
export const CEO_EVALUATION_DUE_DAYS = 15;

/**
 * 신규 흐름의 퇴사 등록 (Employee 기준).
 * 레거시 EmploymentService.resign(Applicant/Employment 기준)을 대체한다.
 */
@Injectable()
export class EmployeeResignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLinkService: AccessLinkService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
  ) {}

  async resign(user: JwtPayload, dto: ResignEmployeeDto, meta: RequestMeta) {
    const companyId = await resolveCompanyId(user, this.prisma);

    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: '직원을 찾을 수 없습니다.' });
    }
    if (employee.companyId !== companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '다른 기업의 직원은 퇴사 처리할 수 없습니다.',
      });
    }
    if (employee.employmentStatus === 'RESIGNED') {
      throw alreadyResigned();
    }

    // 평가 항목은 가장 최근 자기선언의 질문 스냅샷으로 만든다
    const declaration = await this.prisma.declaration.findFirst({
      where: { employeeId: employee.id },
      orderBy: { sentAt: 'desc' },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    if (!declaration || declaration.status !== 'SUBMITTED') {
      throw new ConflictException({
        code: 'DECLARATION_NOT_SUBMITTED',
        message: '입사 자기선언을 제출한 직원만 퇴사 평가를 시작할 수 있습니다.',
      });
    }

    const resignationDate = parseResignationDate(dto.resignationDate);
    if (!resignationDate || resignationDate < employee.employmentStartDate) {
      throw new UnprocessableEntityException({
        code: 'INVALID_RESIGNATION_DATE',
        message: '퇴사일이 유효하지 않거나 입사일보다 이릅니다.',
      });
    }

    const selfEvaluationDueAt = endOfDayKstAfter(resignationDate, SELF_EVALUATION_DUE_DAYS);
    const ceoEvaluationDueAt = endOfDayKstAfter(resignationDate, CEO_EVALUATION_DUE_DAYS);
    const evaluationQuestions = declaration.questions.filter((q) => q.evaluationEnabled);

    // 트랜잭션 안에서는 데이터와 링크 저장만 한다. 메일은 커밋 후.
    const { evaluation, token } = await this.prisma.$transaction(async (tx) => {
      // 동시에 두 번 요청해도 한 번만 퇴사 처리되도록 재직 중일 때만 갱신
      const { count } = await tx.employee.updateMany({
        where: { id: employee.id, employmentStatus: 'EMPLOYED' },
        data: { employmentStatus: 'RESIGNED', resignationDate },
      });
      if (count === 0) {
        throw alreadyResigned();
      }

      const created = await tx.evaluation.create({
        data: {
          companyId,
          employeeId: employee.id,
          declarationId: declaration.id,
          status: 'SELF_PENDING',
          resignationDate,
          selfEvaluationDueAt,
          ceoEvaluationDueAt,
          // evaluationEnabled=true 질문만 평가 항목으로, 자기선언 순서 유지, 점수는 비워 둔다
          items: {
            create: evaluationQuestions.map((q) => ({ snapshotQuestionId: q.id, order: q.order })),
          },
        },
      });

      const issuedToken = await this.accessLinkService.issue(
        'SELF_EVALUATION',
        created.id,
        selfEvaluationDueAt,
        tx,
      );

      await this.auditService.log(
        {
          actorType: 'COMPANY',
          actorId: user.sub,
          action: 'EMPLOYEE_RESIGNED',
          targetType: 'Employee',
          targetId: employee.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          metadata: {
            evaluationId: created.id,
            resignationDate: dto.resignationDate,
            evaluationItemCount: evaluationQuestions.length,
          },
        },
        tx,
      );

      return { evaluation: created, token: issuedToken };
    });

    // 커밋 후 발송. 실패해도 퇴사·평가 데이터는 유지되고 linkSent=false로 알린다.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { companyName: true },
    });
    const linkSent = await this.mailService.sendSelfEvaluationLink({
      to: employee.email,
      token,
      employeeName: employee.name,
      companyName: company?.companyName,
      expiresAt: selfEvaluationDueAt,
    });

    return {
      // 명세 필드명은 employmentId지만 신규 흐름에는 Employment가 없으므로 employeeId를 담는다
      employmentId: employee.id,
      evaluationId: evaluation.id,
      employmentStatus: 'RESIGNED' as const,
      evaluationStatus: evaluation.status,
      selfEvaluationDueAt,
      ceoEvaluationDueAt,
      linkSent,
    };
  }
}

function alreadyResigned(): ConflictException {
  return new ConflictException({ code: 'ALREADY_RESIGNED', message: '이미 퇴사 처리된 직원입니다.' });
}

/** 'YYYY-MM-DD' → UTC 자정 Date. 달력에 없는 날짜(2026-02-30 등)는 null */
function parseResignationDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return date;
}
