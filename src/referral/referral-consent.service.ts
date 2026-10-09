import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ReferralConsent } from '@prisma/client';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { resolveCompanyId } from '../core/utils/company-scope';
import { MailService } from '../notification/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReferralConsentDto } from './dto/create-referral-consent.dto';
import { AgreeReferralConsentDto, WithdrawReferralConsentDto } from './dto/referral-consent-decision.dto';
import {
  CONSENT_EXPIRES_IN_DAYS,
  CONSENT_REQUEST_LIMIT,
  DAY_MS,
  PUBLISH_MONTHS_OPTIONS,
  REFERRAL_PURPOSE,
  WITHDRAWAL_LINK_VALID_DAYS,
} from './referral.constants';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * 인재 추천 게시 동의 (신규 흐름). 레거시 src/consent와 무관하다.
 * 동의 링크 하나로 조회·동의·철회를 모두 처리하므로 링크를 소비하지 않는다.
 */
@Injectable()
export class ReferralConsentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessLinkService: AccessLinkService,
    private readonly mailService: MailService,
    private readonly auditService: AuditService,
  ) {}

  /** 대표: 퇴사 직원에게 추천 게시 동의 요청 링크 발송 */
  async request(user: JwtPayload, dto: CreateReferralConsentDto) {
    const companyId = await resolveCompanyId(user, this.prisma);

    const employee = await this.prisma.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: '직원을 찾을 수 없습니다.' });
    }
    if (employee.companyId !== companyId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: '다른 기업의 직원에게는 요청할 수 없습니다.' });
    }
    if (employee.employmentStatus !== 'RESIGNED') {
      throw new UnprocessableEntityException({
        code: 'EMPLOYEE_NOT_RESIGNED',
        message: '퇴사한 직원에게만 추천 게시 동의를 요청할 수 있습니다.',
      });
    }

    const now = new Date();
    const active = await this.prisma.referralConsent.findFirst({
      where: { employeeId: employee.id, status: { in: ['PENDING', 'AGREED'] } },
      select: { id: true, status: true },
    });
    if (active) {
      throw new ConflictException({
        code: 'ACTIVE_CONSENT_EXISTS',
        message: '진행 중이거나 동의된 추천 게시 동의가 이미 있습니다.',
        details: { consentId: active.id, status: active.status },
      });
    }

    const recentCount = await this.prisma.referralConsent.count({
      where: { employeeId: employee.id, sentAt: { gte: new Date(now.getTime() - CONSENT_REQUEST_LIMIT.windowMs) } },
    });
    if (recentCount >= CONSENT_REQUEST_LIMIT.count) {
      throw new HttpException(
        {
          code: 'LINK_RATE_LIMITED',
          message: `같은 직원에게는 24시간 동안 ${CONSENT_REQUEST_LIMIT.count}회까지만 요청할 수 있습니다.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const expiresInDays = dto.expiresInDays ?? CONSENT_EXPIRES_IN_DAYS.default;
    const expiresAt = new Date(now.getTime() + expiresInDays * DAY_MS);

    // 트랜잭션 안에서는 데이터와 링크 저장만 한다. 메일은 커밋 후.
    const { consent, token } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.referralConsent.create({
        data: {
          companyId,
          employeeId: employee.id,
          status: 'PENDING',
          displayNameMode: dto.displayNameMode,
          sentAt: now,
          expiresAt,
        },
      });

      const issuedToken = await this.accessLinkService.issue('REFERRAL_CONSENT', created.id, expiresAt, tx);

      await this.auditService.log(
        {
          actorType: 'COMPANY',
          actorId: user.sub,
          action: 'REFERRAL_CONSENT_REQUESTED',
          targetType: 'ReferralConsent',
          targetId: created.id,
          metadata: {
            employeeId: employee.id,
            channels: dto.channels,
            displayNameMode: dto.displayNameMode,
            expiresInDays,
          },
        },
        tx,
      );

      return { consent: created, token: issuedToken };
    });

    // 커밋 후 발송. 실패해도 동의 요청은 유지되고 linkSent=false로 알린다.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { companyName: true },
    });
    const linkSent = await this.mailService.sendReferralConsentLink({
      to: employee.email,
      token,
      employeeName: employee.name,
      companyName: company?.companyName,
      expiresAt,
    });

    return {
      consentId: consent.id,
      status: consent.status,
      sentAt: consent.sentAt,
      expiresAt: consent.expiresAt,
      linkSent,
    };
  }

  /** 직원: 동의 내용 조회 (동의 전 확인, 동의 후 철회 화면 모두 사용) */
  async getByToken(token: string) {
    const consent = await this.findByToken(token);

    if (consent.status === 'WITHDRAWN') {
      throw alreadyProcessed(consent.status);
    }
    if (isRequestExpired(consent, new Date())) {
      throw linkExpired();
    }

    const [employee, company] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: consent.employeeId }, select: { name: true, position: true } }),
      this.prisma.company.findUnique({ where: { id: consent.companyId }, select: { companyName: true } }),
    ]);

    return {
      consentId: consent.id,
      status: consent.status,
      purpose: REFERRAL_PURPOSE,
      employee: {
        name: employee?.name ?? null,
        position: employee?.position ?? null,
        companyName: company?.companyName ?? null,
      },
      disclosure: {
        recommendation: true,
        resume: true,
        position: true,
        displayNameMode: consent.displayNameMode,
        // 게시 기간은 대표가 게시물 작성 시 선택 (최대 6개월)
        publishMonths: Math.max(...PUBLISH_MONTHS_OPTIONS),
        publishMonthsOptions: [...PUBLISH_MONTHS_OPTIONS],
      },
      expiresAt: consent.expiresAt,
      agreedAt: consent.agreedAt,
    };
  }

  /** 직원: 추천 게시·이력서 공개 동의. 링크는 이후 철회에도 쓰므로 소비하지 않고 유효 기간을 늘린다. */
  async agree(token: string, dto: AgreeReferralConsentDto, meta: RequestMeta) {
    if (!dto.recommendationAgreed || !dto.resumeDisclosureAgreed) {
      throw new ForbiddenException({
        code: 'CONSENT_NOT_GIVEN',
        message: '추천 게시와 이력서 공개에 모두 동의해야 합니다.',
      });
    }
    if (!dto.finalConfirmation) {
      throw invalidConsent();
    }

    return this.prisma.$transaction(async (tx) => {
      const link = await this.accessLinkService.verify(token, 'REFERRAL_CONSENT', tx);
      const consent = await tx.referralConsent.findUnique({ where: { id: link.targetId } });
      if (!consent) {
        throw consentNotFound();
      }
      const now = new Date();
      if (consent.status !== 'PENDING') {
        throw alreadyProcessed(consent.status);
      }
      if (isRequestExpired(consent, now)) {
        throw linkExpired();
      }

      // 동시에 두 번 눌러도 한 번만 AGREED로 전환
      const { count } = await tx.referralConsent.updateMany({
        where: { id: consent.id, status: 'PENDING' },
        data: {
          status: 'AGREED',
          agreedAt: now,
          agreedIp: meta.ip ?? null,
          agreedUserAgent: meta.userAgent ?? null,
        },
      });
      if (count === 0) {
        throw alreadyProcessed('AGREED');
      }

      await this.accessLinkService.extend(
        link.id,
        new Date(now.getTime() + WITHDRAWAL_LINK_VALID_DAYS * DAY_MS),
        tx,
      );

      await this.auditService.log(
        {
          actorType: 'EMPLOYEE',
          actorId: consent.employeeId,
          action: 'REFERRAL_CONSENT_AGREED',
          targetType: 'ReferralConsent',
          targetId: consent.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          metadata: { recommendationAgreed: true, resumeDisclosureAgreed: true },
        },
        tx,
      );

      return { consentId: consent.id, status: 'AGREED' as const, agreedAt: now };
    });
  }

  /** 직원: 동의 철회. 같은 트랜잭션에서 연결된 공개 게시물을 모두 비공개(HIDDEN) 처리한다. */
  async withdraw(token: string, dto: WithdrawReferralConsentDto, meta: RequestMeta) {
    if (!dto.finalConfirmation) {
      throw invalidConsent();
    }

    return this.prisma.$transaction(async (tx) => {
      const link = await this.accessLinkService.verify(token, 'REFERRAL_CONSENT', tx);
      const consent = await tx.referralConsent.findUnique({ where: { id: link.targetId } });
      if (!consent) {
        throw consentNotFound();
      }
      if (consent.status === 'WITHDRAWN') {
        throw new ConflictException({ code: 'ALREADY_WITHDRAWN', message: '이미 철회된 동의입니다.' });
      }
      if (consent.status === 'EXPIRED') {
        throw alreadyProcessed(consent.status);
      }

      const now = new Date();
      const { count } = await tx.referralConsent.updateMany({
        where: { id: consent.id, status: { in: ['PENDING', 'AGREED'] } },
        data: { status: 'WITHDRAWN', withdrawnAt: now },
      });
      if (count === 0) {
        throw new ConflictException({ code: 'ALREADY_WITHDRAWN', message: '이미 철회된 동의입니다.' });
      }

      // 공개 중인 추천 게시물은 즉시 비공개 (이력서는 공개 게시물에서만 내려받을 수 있으므로 함께 차단됨)
      const hidden = await tx.referralPost.updateMany({
        where: { referralConsentId: consent.id, status: 'PUBLISHED' },
        data: { status: 'HIDDEN' },
      });

      await this.auditService.log(
        {
          actorType: 'EMPLOYEE',
          actorId: consent.employeeId,
          action: 'REFERRAL_CONSENT_WITHDRAWN',
          targetType: 'ReferralConsent',
          targetId: consent.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
          metadata: { previousStatus: consent.status, hiddenPostCount: hidden.count },
        },
        tx,
      );

      return {
        consentId: consent.id,
        status: 'WITHDRAWN' as const,
        postVisibility: 'HIDDEN' as const,
        withdrawnAt: now,
      };
    });
  }

  private async findByToken(token: string): Promise<ReferralConsent> {
    const link = await this.accessLinkService.verify(token, 'REFERRAL_CONSENT');
    const consent = await this.prisma.referralConsent.findUnique({ where: { id: link.targetId } });
    if (!consent) {
      throw consentNotFound();
    }
    return consent;
  }
}

/** 동의 전(PENDING) 요청이 만료됐는지. 동의 후(AGREED)에는 요청 만료와 무관하게 철회할 수 있다 */
function isRequestExpired(consent: ReferralConsent, now: Date): boolean {
  return consent.status === 'EXPIRED' || (consent.status === 'PENDING' && now > consent.expiresAt);
}

function alreadyProcessed(status: string): ConflictException {
  return new ConflictException({
    code: 'ALREADY_PROCESSED',
    message: '이미 처리된 동의입니다.',
    details: { status },
  });
}

function invalidConsent(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INVALID_CONSENT',
    message: '최종 확인에 체크해야 합니다.',
  });
}

function consentNotFound(): NotFoundException {
  return new NotFoundException({ code: 'CONSENT_NOT_FOUND', message: '동의 기록을 찾을 수 없습니다.' });
}

function linkExpired(): GoneException {
  return new GoneException({ code: 'LINK_EXPIRED', message: '동의 링크가 만료되었습니다.' });
}
