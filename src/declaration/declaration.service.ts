import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DeclarationQuestionSnapshot, DeclarationResponse, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { resolveCompanyId } from '../core/utils/company-scope';
import { endOfDayKstAfter } from '../core/utils/kst-date';
import { MailService } from '../notification/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { validateAnswers } from './answer.validator';
import {
  CURRENT_CONSENT_VERSION,
  DECLARATION_LINK_VALID_DAYS,
  REQUIRED_CONSENTS,
  SnapshotOption,
} from './declaration.constants';
import { AssignDeclarationDto } from './dto/assign-declaration.dto';
import { SubmitDeclarationDto } from './dto/submit-declaration.dto';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class DeclarationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLinkService: AccessLinkService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 대표가 직원에게 질문 템플릿을 할당하고 자기선언 링크를 발송한다.
   * 발송 시점의 템플릿 질문을 DeclarationQuestionSnapshot으로 복사하므로
   * 이후 템플릿을 수정해도 이 질문지와 답변은 바뀌지 않는다.
   */
  async assign(user: JwtPayload, employeeId: string, dto: AssignDeclarationDto) {
    const companyId = await resolveCompanyId(user, this.prisma);

    const [employee, template] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: employeeId } }),
      this.prisma.questionTemplate.findUnique({
        where: { id: dto.templateId },
        include: { questions: { orderBy: { order: 'asc' } } },
      }),
    ]);

    if (!employee || !template) {
      throw new NotFoundException({
        code: 'EMPLOYEE_OR_TEMPLATE_NOT_FOUND',
        message: '직원 또는 질문 템플릿을 찾을 수 없습니다.',
      });
    }
    if (employee.companyId !== companyId || template.companyId !== companyId) {
      throw forbidden();
    }
    if (template.status !== 'ACTIVE') {
      throw new UnprocessableEntityException({
        code: 'TEMPLATE_NOT_ACTIVE',
        message: '사용할 수 없는 질문 템플릿입니다.',
      });
    }

    const activeDeclaration = await this.prisma.declaration.findFirst({
      where: { employeeId, status: 'SENT' },
      select: { id: true },
    });
    if (activeDeclaration) {
      throw activeDeclarationExists();
    }

    const now = new Date();
    const linkExpiresAt = endOfDayKstAfter(now, DECLARATION_LINK_VALID_DAYS);

    // 트랜잭션 안에서는 데이터와 링크 저장만 한다. 메일은 커밋 후.
    const { declaration, token } = await this.prisma.$transaction(async (tx) => {
      // 동시에 두 번 발송해도 하나만 통과하도록 조건부 갱신으로 선점
      const { count } = await tx.employee.updateMany({
        where: { id: employeeId, declarationStatus: { not: 'SENT' } },
        data: { declarationStatus: 'SENT' },
      });
      if (count === 0) {
        throw activeDeclarationExists();
      }

      const created = await tx.declaration.create({
        data: {
          companyId,
          employeeId,
          templateId: template.id,
          templateName: template.name,
          templateVersion: template.version,
          status: 'SENT',
          sentAt: now,
          questions: {
            create: template.questions.map((q) => ({
              order: q.order,
              type: q.type,
              text: q.text,
              required: q.required,
              scoreMin: q.scoreMin,
              scoreMax: q.scoreMax,
              options: toSnapshotOptions(q.options),
              maxLength: q.maxLength,
              evaluationEnabled: q.evaluationEnabled,
            })),
          },
        },
      });

      const issuedToken = await this.accessLinkService.issue('DECLARATION', created.id, linkExpiresAt, tx);

      await this.auditService.log(
        {
          actorType: 'COMPANY',
          actorId: user.sub,
          action: 'DECLARATION_SENT',
          targetType: 'Declaration',
          targetId: created.id,
          metadata: { employeeId, templateId: template.id, templateVersion: template.version },
        },
        tx,
      );

      return { declaration: created, token: issuedToken };
    });

    // 커밋 후 발송. 실패해도 데이터는 유지되고 linkSent=false로 알린다.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { companyName: true },
    });
    const linkSent = await this.mailService.sendDeclarationLink({
      to: employee.email,
      token,
      employeeName: employee.name,
      companyName: company?.companyName,
      expiresAt: linkExpiresAt,
    });

    return {
      declarationId: declaration.id,
      templateId: template.id,
      templateVersion: template.version,
      questionCount: template.questions.length,
      status: declaration.status,
      linkExpiresAt,
      linkSent,
    };
  }

  /** 직원이 링크로 질문지를 조회한다. 조회만으로는 링크를 소비하지 않는다. */
  async getForm(token: string) {
    const link = await this.accessLinkService.verify(token, 'DECLARATION');

    const declaration = await this.prisma.declaration.findUnique({
      where: { id: link.targetId },
      include: {
        questions: { orderBy: { order: 'asc' } },
        employee: { select: { name: true, position: true } },
      },
    });
    if (!declaration) {
      throw linkExpired();
    }
    if (declaration.status === 'SUBMITTED') {
      throw alreadySubmitted();
    }

    const company = await this.prisma.company.findUnique({
      where: { id: declaration.companyId },
      select: { companyName: true },
    });

    return {
      declarationId: declaration.id,
      templateName: declaration.templateName,
      templateVersion: declaration.templateVersion,
      employee: {
        name: declaration.employee.name,
        companyName: company?.companyName ?? null,
        position: declaration.employee.position,
      },
      status: declaration.status,
      expiresAt: link.expiresAt,
      questions: declaration.questions.map(toFormQuestion),
      requiredConsents: [...REQUIRED_CONSENTS],
      consentVersion: CURRENT_CONSENT_VERSION,
    };
  }

  /** 직원이 답변과 필수 동의를 제출한다. 성공 시 링크를 소비하고 이후 수정할 수 없다. */
  async submit(token: string, dto: SubmitDeclarationDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const link = await this.accessLinkService.verify(token, 'DECLARATION', tx);

      const declaration = await tx.declaration.findUnique({
        where: { id: link.targetId },
        include: { questions: { orderBy: { order: 'asc' } } },
      });
      if (!declaration) {
        throw linkExpired();
      }
      if (declaration.status === 'SUBMITTED') {
        throw alreadySubmitted();
      }

      assertConsentsGiven(dto.consents);
      const answers = validateAnswers(declaration.questions, dto.answers);

      const submittedAt = new Date();

      // 동시 제출 시 하나만 통과 (SENT일 때만 SUBMITTED로 전환)
      const { count } = await tx.declaration.updateMany({
        where: { id: declaration.id, status: 'SENT' },
        data: {
          status: 'SUBMITTED',
          submittedAt,
          consentEvaluation: true,
          consentDataAccess: true,
          consentEvidenceRetention: true,
          consentVersion: dto.consents.consentVersion,
          consentAgreedAt: submittedAt,
          consentIp: meta.ip ?? null,
          consentUserAgent: meta.userAgent ?? null,
        },
      });
      if (count === 0) {
        throw alreadySubmitted();
      }

      if (answers.length > 0) {
        await tx.declarationResponse.createMany({ data: answers });
      }

      await tx.employee.update({
        where: { id: declaration.employeeId },
        data: { declarationStatus: 'SUBMITTED' },
      });

      await this.accessLinkService.consume(link.id, tx);

      await this.auditService.log(
        {
          actorType: 'EMPLOYEE',
          actorId: declaration.employeeId,
          action: 'DECLARATION_SUBMITTED',
          targetType: 'Declaration',
          targetId: declaration.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          metadata: { consentVersion: dto.consents.consentVersion, answerCount: answers.length },
        },
        tx,
      );

      return {
        declarationId: declaration.id,
        status: 'SUBMITTED' as const,
        submittedAt,
        linkConsumed: true,
      };
    });
  }

  /** 대표가 직원의 제출된 자기선언(질문·답변·동의 이력)을 최신순으로 조회한다. */
  async getEmployeeDeclarations(user: JwtPayload, employeeId: string) {
    const companyId = await resolveCompanyId(user, this.prisma);

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, companyId: true },
    });
    if (!employee) {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: '직원을 찾을 수 없습니다.' });
    }
    if (employee.companyId !== companyId) {
      throw forbidden();
    }

    const declarations = await this.prisma.declaration.findMany({
      where: { employeeId, status: 'SUBMITTED' },
      orderBy: { submittedAt: 'desc' },
      include: {
        questions: { orderBy: { order: 'asc' }, include: { response: true } },
      },
    });
    if (declarations.length === 0) {
      throw new NotFoundException({
        code: 'DECLARATION_NOT_FOUND',
        message: '제출된 자기선언이 없습니다.',
      });
    }

    return {
      employeeId,
      declarations: declarations.map((declaration) => ({
        declarationId: declaration.id,
        templateId: declaration.templateId,
        templateName: declaration.templateName,
        templateVersion: declaration.templateVersion,
        status: declaration.status,
        submittedAt: declaration.submittedAt,
        items: declaration.questions.map(toDeclarationItem),
        consents: {
          evaluationAgreed: declaration.consentEvaluation,
          dataAccessAgreed: declaration.consentDataAccess,
          evidenceRetentionAgreed: declaration.consentEvidenceRetention,
          consentVersion: declaration.consentVersion,
          agreedAt: declaration.consentAgreedAt,
        },
      })),
    };
  }
}

/** 템플릿 선택지(string[])를 스냅샷 선택지([{optionId, label}])로 변환. 선택형이 아니면 저장하지 않음 */
function toSnapshotOptions(options: Prisma.JsonValue | null): SnapshotOption[] | undefined {
  if (!Array.isArray(options)) {
    return undefined;
  }
  return options.map((label) => ({ optionId: randomUUID(), label: String(label) }));
}

function toFormQuestion(q: DeclarationQuestionSnapshot) {
  return {
    questionId: q.id,
    order: q.order,
    type: q.type,
    text: q.text,
    required: q.required,
    ...(q.type === 'SCORE' && { scoreMin: q.scoreMin, scoreMax: q.scoreMax }),
    ...(q.type === 'SINGLE_CHOICE' && { options: (q.options as SnapshotOption[] | null) ?? [] }),
    ...(q.type === 'TEXT' && { maxLength: q.maxLength }),
    evaluationEnabled: q.evaluationEnabled,
  };
}

function toDeclarationItem(q: DeclarationQuestionSnapshot & { response: DeclarationResponse | null }) {
  const base = {
    questionId: q.id,
    order: q.order,
    type: q.type,
    question: q.text,
    required: q.required,
    evaluationEnabled: q.evaluationEnabled,
  };

  switch (q.type) {
    case 'SCORE':
      return { ...base, answerScore: q.response?.answerScore ?? null };
    case 'SINGLE_CHOICE': {
      const options = (q.options as SnapshotOption[] | null) ?? [];
      const option = options.find((o) => o.optionId === q.response?.answerOptionId);
      return { ...base, answerOption: option ?? null };
    }
    case 'TEXT':
      return { ...base, answerText: q.response?.answerText ?? null };
  }
}

function assertConsentsGiven(consents: SubmitDeclarationDto['consents']): void {
  const allAgreed =
    consents.evaluationAgreed && consents.dataAccessAgreed && consents.evidenceRetentionAgreed;

  if (!allAgreed) {
    throw new ForbiddenException({
      code: 'CONSENT_NOT_GIVEN',
      message: '필수 동의 항목에 모두 동의해야 제출할 수 있습니다.',
    });
  }
  // 직원이 본 동의서와 현재 동의서 버전이 다르면 유효한 동의로 보지 않는다
  if (consents.consentVersion !== CURRENT_CONSENT_VERSION) {
    throw new ForbiddenException({
      code: 'CONSENT_NOT_GIVEN',
      message: '동의서가 변경되었습니다. 질문지를 다시 불러와 최신 동의서에 동의해 주세요.',
      details: { currentConsentVersion: CURRENT_CONSENT_VERSION },
    });
  }
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: '다른 기업의 직원 또는 템플릿에는 접근할 수 없습니다.',
  });
}

function activeDeclarationExists(): ConflictException {
  return new ConflictException({
    code: 'ACTIVE_DECLARATION_EXISTS',
    message: '제출 전인 자기선언 질문지가 이미 있습니다.',
  });
}

function alreadySubmitted(): ConflictException {
  return new ConflictException({
    code: 'ALREADY_SUBMITTED',
    message: '이미 제출이 완료된 자기선언입니다.',
  });
}

function linkExpired(): GoneException {
  return new GoneException({
    code: 'LINK_EXPIRED',
    message: '만료되었거나 유효하지 않은 링크입니다.',
  });
}
