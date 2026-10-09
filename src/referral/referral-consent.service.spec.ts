import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notification/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgreeReferralConsentDto } from './dto/referral-consent-decision.dto';
import { ReferralConsentService } from './referral-consent.service';
import { CONSENT_REQUEST_LIMIT, DAY_MS, WITHDRAWAL_LINK_VALID_DAYS } from './referral.constants';

// ---------------------------------------------------------------------------
// 테스트용 인메모리 DB (이 서비스가 쓰는 Prisma 호출 형태만)
// ---------------------------------------------------------------------------
type Row = Record<string, any>;

function matchValue(actual: any, expected: any): boolean {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if ('in' in expected) return expected.in.includes(actual);
    if ('gte' in expected) return actual >= expected.gte;
    if ('lt' in expected) return actual < expected.lt;
    if ('not' in expected) return actual !== expected.not;
  }
  return actual === expected;
}
const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => matchValue(row[k], v));
const pick = (row: Row | undefined, select?: Row) =>
  !row ? null : select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : { ...row };

function createFakeDb() {
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const db = {
    companies: [] as Row[],
    employees: [] as Row[],
    consents: [] as Row[],
    posts: [] as Row[],
    links: [] as Row[],
    audits: [] as Row[],
  };
  const updateMany = (rows: Row[]) => async ({ where, data }: any) => {
    const targets = rows.filter((r) => matches(r, where));
    targets.forEach((r) => Object.assign(r, data));
    return { count: targets.length };
  };
  const client: any = {
    hrManager: { findUnique: async () => null },
    company: { findUnique: async ({ where, select }: any) => pick(db.companies.find((c) => c.id === where.id), select) },
    employee: { findUnique: async ({ where, select }: any) => pick(db.employees.find((e) => e.id === where.id), select) },
    referralConsent: {
      findFirst: async ({ where, select }: any) => pick(db.consents.find((c) => matches(c, where)), select),
      findUnique: async ({ where }: any) => pick(db.consents.find((c) => c.id === where.id)),
      count: async ({ where }: any) => db.consents.filter((c) => matches(c, where)).length,
      create: async ({ data }: any) => {
        const row = { id: id('consent'), agreedAt: null, withdrawnAt: null, agreedIp: null, agreedUserAgent: null, ...data };
        db.consents.push(row);
        return { ...row };
      },
      updateMany: updateMany(db.consents),
    },
    referralPost: { updateMany: updateMany(db.posts) },
    accessLink: {
      create: async ({ data }: any) => {
        const row = { id: id('link'), usedAt: null, revokedAt: null, createdAt: new Date(), ...data };
        db.links.push(row);
        return { ...row };
      },
      findUnique: async ({ where }: any) => pick(db.links.find((l) => l.tokenHash === where.tokenHash)),
      updateMany: updateMany(db.links),
    },
    auditLog: { create: async ({ data }: any) => (db.audits.push(data), data) },
  };
  client.$transaction = async (fn: any) => fn(client);
  return { db, client };
}

// ---------------------------------------------------------------------------

const CEO = { sub: 'comp-1', role: 'COMPANY' as const };
const META = { ip: '203.0.113.7', userAgent: 'jest-browser' };
const NOW = new Date('2026-05-03T01:00:00.000Z');
const AGREE: AgreeReferralConsentDto = { recommendationAgreed: true, resumeDisclosureAgreed: true, finalConfirmation: true };

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
  return error as HttpException;
}

describe('ReferralConsentService', () => {
  let fake: ReturnType<typeof createFakeDb>;
  let mailMock: { sendReferralConsentLink: jest.Mock };
  let accessLink: AccessLinkService;
  let service: ReferralConsentService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    fake = createFakeDb();
    fake.db.companies.push({ id: 'comp-1', companyName: '테크플러스' }, { id: 'comp-2', companyName: '다른기업' });
    fake.db.employees.push(
      { id: 'emp-1', companyId: 'comp-1', name: '김민준', email: 'minjun@example.com', position: '과장', employmentStatus: 'RESIGNED' },
      { id: 'emp-working', companyId: 'comp-1', name: '재직자', email: 'w@example.com', position: null, employmentStatus: 'EMPLOYED' },
      { id: 'emp-other', companyId: 'comp-2', name: '타사', email: 'o@example.com', position: null, employmentStatus: 'RESIGNED' },
    );
    const prisma = fake.client as unknown as PrismaService;
    accessLink = new AccessLinkService(prisma);
    mailMock = { sendReferralConsentLink: jest.fn().mockResolvedValue(true) };
    service = new ReferralConsentService(prisma, accessLink, mailMock as unknown as MailService, new AuditService(prisma));
  });

  afterEach(() => jest.useRealTimers());

  const request = (over: Record<string, unknown> = {}) =>
    service.request(CEO, { employeeId: 'emp-1', channels: ['EMAIL'], displayNameMode: 'ANONYMOUS', ...over } as any);
  const lastToken = (): string => mailMock.sendReferralConsentLink.mock.calls.at(-1)[0].token;

  describe('요청', () => {
    it('PENDING 동의를 만들고 링크 발급 + 커밋 후 메일 발송 (기본 7일)', async () => {
      mailMock.sendReferralConsentLink.mockImplementation(async () => {
        expect(fake.db.consents).toHaveLength(1); // 메일은 커밋 후
        return true;
      });

      const result = await request();

      const expiresAt = new Date(NOW.getTime() + 7 * DAY_MS);
      expect(result).toEqual({ consentId: 'consent-1', status: 'PENDING', sentAt: NOW, expiresAt, linkSent: true });
      expect(fake.db.links[0]).toMatchObject({ purpose: 'REFERRAL_CONSENT', targetId: 'consent-1', expiresAt });
      expect(fake.db.audits.map((a) => a.action)).toEqual(['REFERRAL_CONSENT_REQUESTED']);
      expect(mailMock.sendReferralConsentLink).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'minjun@example.com', employeeName: '김민준', companyName: '테크플러스', expiresAt }),
      );
    });

    it('expiresInDays를 지정하면 그 기간으로 만료', async () => {
      const result = await request({ expiresInDays: 30 });
      expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY_MS));
    });

    it('메일이 실패해도 동의 요청은 남고 linkSent=false', async () => {
      mailMock.sendReferralConsentLink.mockResolvedValue(false);
      const result = await request();
      expect(result.linkSent).toBe(false);
      expect(fake.db.consents).toHaveLength(1);
    });

    it('퇴사하지 않은 직원이면 422 EMPLOYEE_NOT_RESIGNED', async () => {
      await expectCode(request({ employeeId: 'emp-working' }), UnprocessableEntityException, 'EMPLOYEE_NOT_RESIGNED');
    });

    it('다른 기업 직원 403 FORBIDDEN, 없는 직원 404', async () => {
      await expectCode(request({ employeeId: 'emp-other' }), ForbiddenException, 'FORBIDDEN');
      await expectCode(request({ employeeId: 'nope' }), NotFoundException, 'EMPLOYEE_NOT_FOUND');
    });

    it.each(['PENDING', 'AGREED'])('%s 동의가 있으면 409 ACTIVE_CONSENT_EXISTS', async (status) => {
      await request();
      fake.db.consents[0].status = status;
      await expectCode(request(), ConflictException, 'ACTIVE_CONSENT_EXISTS');
    });

    it('같은 직원 24시간 안에 3회까지 허용하고 4번째는 429 LINK_RATE_LIMITED', async () => {
      for (let i = 0; i < CONSENT_REQUEST_LIMIT.count; i++) {
        await request();
        fake.db.consents.at(-1)!.status = 'WITHDRAWN'; // 진행 중 요청이 없도록 정리
      }
      const error = await expectCode(request(), HttpException, 'LINK_RATE_LIMITED');
      expect(error.getStatus()).toBe(429);
    });

    it('24시간이 지난 요청은 횟수에서 빠진다', async () => {
      for (let i = 0; i < CONSENT_REQUEST_LIMIT.count; i++) {
        await request();
        fake.db.consents.at(-1)!.status = 'WITHDRAWN';
      }
      jest.setSystemTime(new Date(NOW.getTime() + CONSENT_REQUEST_LIMIT.windowMs + 1000));
      await expect(request()).resolves.toMatchObject({ status: 'PENDING' });
    });
  });

  describe('조회 → 동의 → 철회 (상태 전환)', () => {
    it('PENDING 조회 → AGREED(동의 시각·IP·UA, 링크 유지·연장) → AGREED 조회 → WITHDRAWN', async () => {
      await request();
      const token = lastToken();

      // 조회
      const view = await service.getByToken(token);
      expect(view).toMatchObject({
        consentId: 'consent-1',
        status: 'PENDING',
        employee: { name: '김민준', position: '과장', companyName: '테크플러스' },
        disclosure: { recommendation: true, resume: true, position: true, displayNameMode: 'ANONYMOUS', publishMonths: 6, publishMonthsOptions: [3, 6] },
      });
      expect(view.purpose).toEqual(expect.any(String));

      // 동의
      const agreed = await service.agree(token, AGREE, META);
      expect(agreed).toEqual({ consentId: 'consent-1', status: 'AGREED', agreedAt: NOW });
      expect(fake.db.consents[0]).toMatchObject({ status: 'AGREED', agreedAt: NOW, agreedIp: META.ip, agreedUserAgent: META.userAgent });
      // 철회에도 쓰므로 소비하지 않고, 유효 기간을 철회 가능 기간으로 연장
      expect(fake.db.links[0].usedAt).toBeNull();
      expect(fake.db.links[0].expiresAt).toEqual(new Date(NOW.getTime() + WITHDRAWAL_LINK_VALID_DAYS * DAY_MS));

      // 동의 요청 기한(7일)이 한참 지나도 동의 후에는 조회·철회 가능
      jest.setSystemTime(new Date(NOW.getTime() + 60 * DAY_MS));
      await expect(service.getByToken(token)).resolves.toMatchObject({ status: 'AGREED', agreedAt: NOW });

      // 철회
      const withdrawn = await service.withdraw(token, { finalConfirmation: true }, META);
      expect(withdrawn).toMatchObject({ consentId: 'consent-1', status: 'WITHDRAWN', postVisibility: 'HIDDEN' });
      expect(fake.db.consents[0].status).toBe('WITHDRAWN');
      expect(fake.db.audits.map((a) => a.action)).toEqual([
        'REFERRAL_CONSENT_REQUESTED',
        'REFERRAL_CONSENT_AGREED',
        'REFERRAL_CONSENT_WITHDRAWN',
      ]);
    });

    it('PENDING 상태에서도 바로 철회할 수 있다', async () => {
      await request();
      await expect(service.withdraw(lastToken(), { finalConfirmation: true }, META)).resolves.toMatchObject({ status: 'WITHDRAWN' });
    });

    it('철회하면 같은 동의로 공개 중인 게시물만 모두 HIDDEN이 된다', async () => {
      await request();
      const token = lastToken();
      await service.agree(token, AGREE, META);
      fake.db.posts.push(
        { id: 'post-1', referralConsentId: 'consent-1', status: 'PUBLISHED' },
        { id: 'post-2', referralConsentId: 'consent-1', status: 'PUBLISHED' },
        { id: 'post-expired', referralConsentId: 'consent-1', status: 'EXPIRED' },
        { id: 'post-deleted', referralConsentId: 'consent-1', status: 'DELETED' },
        { id: 'post-other', referralConsentId: 'consent-other', status: 'PUBLISHED' },
      );

      await service.withdraw(token, { finalConfirmation: true }, META);

      expect(Object.fromEntries(fake.db.posts.map((p) => [p.id, p.status]))).toEqual({
        'post-1': 'HIDDEN',
        'post-2': 'HIDDEN',
        'post-expired': 'EXPIRED',
        'post-deleted': 'DELETED',
        'post-other': 'PUBLISHED',
      });
      expect(fake.db.audits.at(-1)!.metadata).toMatchObject({ previousStatus: 'AGREED', hiddenPostCount: 2 });
    });
  });

  describe('동의·철회 오류', () => {
    beforeEach(async () => {
      await request();
    });

    it.each([
      ['recommendationAgreed', { ...AGREE, recommendationAgreed: false }],
      ['resumeDisclosureAgreed', { ...AGREE, resumeDisclosureAgreed: false }],
    ])('%s=false면 403 CONSENT_NOT_GIVEN이고 상태는 그대로', async (_label, dto) => {
      await expectCode(service.agree(lastToken(), dto, META), ForbiddenException, 'CONSENT_NOT_GIVEN');
      expect(fake.db.consents[0].status).toBe('PENDING');
    });

    it('finalConfirmation=false면 동의·철회 모두 422 INVALID_CONSENT', async () => {
      await expectCode(service.agree(lastToken(), { ...AGREE, finalConfirmation: false }, META), UnprocessableEntityException, 'INVALID_CONSENT');
      await expectCode(service.withdraw(lastToken(), { finalConfirmation: false }, META), UnprocessableEntityException, 'INVALID_CONSENT');
    });

    it('이미 동의했으면 다시 동의 시 409 ALREADY_PROCESSED', async () => {
      await service.agree(lastToken(), AGREE, META);
      await expectCode(service.agree(lastToken(), AGREE, META), ConflictException, 'ALREADY_PROCESSED');
    });

    it('이미 철회했으면 철회 409 ALREADY_WITHDRAWN, 동의·조회 409 ALREADY_PROCESSED', async () => {
      await service.withdraw(lastToken(), { finalConfirmation: true }, META);
      await expectCode(service.withdraw(lastToken(), { finalConfirmation: true }, META), ConflictException, 'ALREADY_WITHDRAWN');
      await expectCode(service.agree(lastToken(), AGREE, META), ConflictException, 'ALREADY_PROCESSED');
      await expectCode(service.getByToken(lastToken()), ConflictException, 'ALREADY_PROCESSED');
    });

    it('동의 요청 기한이 지나면(스케줄러 전이라도) 조회·동의 410 LINK_EXPIRED', async () => {
      const token = lastToken();
      // 링크 자체도 요청 기한에 만료되므로 링크 검증 단계에서 410
      jest.setSystemTime(new Date(NOW.getTime() + 7 * DAY_MS + 1000));
      await expectCode(service.getByToken(token), GoneException, 'LINK_EXPIRED');
      await expectCode(service.agree(token, AGREE, META), GoneException, 'LINK_EXPIRED');
      expect(fake.db.consents[0].status).toBe('PENDING');
    });

    it('스케줄러가 EXPIRED로 바꾼 요청은 조회 410, 철회 409 ALREADY_PROCESSED', async () => {
      fake.db.consents[0].status = 'EXPIRED';
      await expectCode(service.getByToken(lastToken()), GoneException, 'LINK_EXPIRED');
      await expectCode(service.withdraw(lastToken(), { finalConfirmation: true }, META), ConflictException, 'ALREADY_PROCESSED');
    });

    it('다른 목적 링크면 403 INVALID_LINK_PURPOSE, 동의 기록이 없으면 404 CONSENT_NOT_FOUND', async () => {
      const otherToken = await accessLink.issue('DECLARATION', 'consent-1', new Date(NOW.getTime() + DAY_MS), fake.client);
      await expectCode(service.getByToken(otherToken), ForbiddenException, 'INVALID_LINK_PURPOSE');

      const orphan = await accessLink.issue('REFERRAL_CONSENT', 'consent-missing', new Date(NOW.getTime() + DAY_MS), fake.client);
      await expectCode(service.withdraw(orphan, { finalConfirmation: true }, META), NotFoundException, 'CONSENT_NOT_FOUND');
    });
  });

  describe('DTO (전역 ValidationPipe와 같은 설정)', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });

    it.each(['true', 'false', 1, 'YES'])('동의 값 %p는 400 (진짜 boolean만)', async (value) => {
      await expect(
        pipe.transform({ ...AGREE, recommendationAgreed: value }, { type: 'body', metatype: AgreeReferralConsentDto }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
