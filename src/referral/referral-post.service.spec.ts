import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service';
import { RolesGuard } from '../core/guards/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ReferralPostController } from './referral-post.controller';
import { ReferralPostService } from './referral-post.service';
import { addMonths, maskName } from './referral.constants';
import { ResumeService } from './resume.service';
import { StorageService } from './storage/storage.service';

const CEO = { sub: 'comp-1', role: 'COMPANY' as const };
const OTHER_CEO = { sub: 'comp-2', role: 'COMPANY' as const };
const HR = { sub: 'hr-1', role: 'HR_MANAGER' as const };
const NOW = new Date('2026-05-04T01:00:00.000Z');

const DTO = {
  employeeId: 'emp-1',
  title: '함께 일하고 싶은 프론트엔드 개발자',
  recommendationReason: '협업과 일정 준수가 뛰어난 인재입니다.',
  displayNameMode: 'REAL_NAME' as const,
  publishMonths: 3 as const,
};

const agreedConsent = (over: Record<string, unknown> = {}) => ({
  id: 'consent-1', companyId: 'comp-1', employeeId: 'emp-1', status: 'AGREED', displayNameMode: 'REAL_NAME', ...over,
});

const storedPost = (over: Record<string, unknown> = {}) => ({
  id: 'post-1',
  companyId: 'comp-1',
  employeeId: 'emp-1',
  referralConsentId: 'consent-1',
  resumeFileId: null,
  title: '제목',
  recommendationReason: '추천 사유',
  displayNameMode: 'REAL_NAME',
  status: 'PUBLISHED',
  publishedAt: NOW,
  expiresAt: addMonths(NOW, 3),
  createdAt: NOW,
  updatedAt: NOW,
  employee: { name: '김민준', position: '과장' },
  referralConsent: agreedConsent(),
  resumeFile: null,
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

describe('referral.constants', () => {
  it('maskName: 첫 글자만 남긴다', () => {
    expect(maskName('김민준')).toBe('김**');
    expect(maskName('남궁민수')).toBe('남***');
    expect(maskName('이훈')).toBe('이*');
    expect(maskName('김')).toBe('*');
  });

  it('addMonths: 말일을 넘기면 그 달의 마지막 날로 맞춘다', () => {
    expect(addMonths(new Date('2026-05-04T01:00:00Z'), 3).toISOString()).toBe('2026-08-04T01:00:00.000Z');
    expect(addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(addMonths(new Date('2027-08-31T00:00:00Z'), 6).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });
});

describe('ReferralPostService', () => {
  let prismaMock: any;
  let resumeMock: { confirmUploaded: jest.Mock };
  let storageMock: { presignGet: jest.Mock };
  let auditMock: { log: jest.Mock };
  let service: ReferralPostService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    prismaMock = {
      hrManager: { findUnique: jest.fn().mockResolvedValue({ companyId: 'comp-9' }) },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', companyId: 'comp-1' }) },
      referralConsent: { findFirst: jest.fn().mockResolvedValue(agreedConsent()) },
      referralPost: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(storedPost()),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(async ({ data }: any) => ({ id: 'post-1', createdAt: NOW, updatedAt: NOW, ...data })),
        update: jest.fn(async ({ data }: any) => ({ ...storedPost(), ...data, updatedAt: new Date() })),
      },
      company: {
        findMany: jest.fn(async ({ where }: any) =>
          where.id.in.map((id: string) => ({ id, companyName: id === 'comp-1' ? '테크플러스' : '다른기업' })),
        ),
      },
      $transaction: jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(prismaMock) : Promise.all(arg))),
    };
    resumeMock = { confirmUploaded: jest.fn().mockResolvedValue({ id: 'resume-1', uploadedAt: NOW }) };
    storageMock = { presignGet: jest.fn().mockResolvedValue('https://storage.example.com/download?sig=1') };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ReferralPostService(
      prismaMock as unknown as PrismaService,
      resumeMock as unknown as ResumeService,
      storageMock as unknown as StorageService,
      auditMock as unknown as AuditService,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('작성', () => {
    it('PUBLISHED로 만들고 만료 = 게시일 + N개월, 감사 로그를 같은 트랜잭션에 남긴다', async () => {
      const result = await service.create(CEO, { ...DTO, publishMonths: 6 });

      expect(result).toEqual({ postId: 'post-1', status: 'PUBLISHED', publishedAt: NOW, expiresAt: new Date('2026-11-04T01:00:00.000Z') });
      expect(prismaMock.referralPost.create.mock.calls[0][0].data).toMatchObject({
        companyId: 'comp-1', employeeId: 'emp-1', referralConsentId: 'consent-1', resumeFileId: null, status: 'PUBLISHED',
      });
      expect(auditMock.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'REFERRAL_POST_CREATED' }), prismaMock);
      expect(resumeMock.confirmUploaded).not.toHaveBeenCalled();
    });

    it('이력서가 있으면 트랜잭션 전에 실제 업로드를 확인하고 첨부한다', async () => {
      await service.create(CEO, { ...DTO, resumeFileId: 'resume-1' });

      expect(resumeMock.confirmUploaded).toHaveBeenCalledWith('resume-1', 'comp-1', 'emp-1');
      expect(resumeMock.confirmUploaded.mock.invocationCallOrder[0]).toBeLessThan(prismaMock.$transaction.mock.invocationCallOrder[0]);
      expect(prismaMock.referralPost.create.mock.calls[0][0].data.resumeFileId).toBe('resume-1');
    });

    it('업로드되지 않은 이력서면 422 RESUME_NOT_UPLOADED이고 게시물을 만들지 않는다', async () => {
      resumeMock.confirmUploaded.mockRejectedValue(new UnprocessableEntityException({ code: 'RESUME_NOT_UPLOADED' }));
      await expectCode(service.create(CEO, { ...DTO, resumeFileId: 'resume-1' }), UnprocessableEntityException, 'RESUME_NOT_UPLOADED');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('다른 기업 직원이면 403 FORBIDDEN', async () => {
      prismaMock.employee.findUnique.mockResolvedValue({ id: 'emp-1', companyId: 'comp-other' });
      await expectCode(service.create(CEO, DTO), ForbiddenException, 'FORBIDDEN');
    });

    it('AGREED 동의가 없으면(철회·대기·만료 포함) 403 CONSENT_NOT_GIVEN', async () => {
      prismaMock.referralConsent.findFirst.mockResolvedValue(null);
      await expectCode(service.create(CEO, DTO), ForbiddenException, 'CONSENT_NOT_GIVEN');
      expect(prismaMock.referralConsent.findFirst).toHaveBeenCalledWith({ where: { employeeId: 'emp-1', status: 'AGREED' } });
    });

    it('직원이 익명 공개에 동의했는데 실명으로 게시하면 403 CONSENT_NOT_GIVEN, 익명은 허용', async () => {
      prismaMock.referralConsent.findFirst.mockResolvedValue(agreedConsent({ displayNameMode: 'ANONYMOUS' }));
      await expectCode(service.create(CEO, DTO), ForbiddenException, 'CONSENT_NOT_GIVEN');
      await expect(service.create(CEO, { ...DTO, displayNameMode: 'ANONYMOUS' })).resolves.toMatchObject({ status: 'PUBLISHED' });
    });

    it('같은 직원의 PUBLISHED 게시물이 있으면 409 ACTIVE_POST_EXISTS', async () => {
      prismaMock.referralPost.findFirst.mockResolvedValue({ id: 'post-0' });
      await expectCode(service.create(CEO, DTO), ConflictException, 'ACTIVE_POST_EXISTS');
    });

    it.each([
      ['200자 초과', '가'.repeat(201)],
      ['빈 사유', '   '],
      ['금지 표현', '성실했지만 징계 이력이 있습니다.'],
      ['민감 정보', '결혼 후에도 꾸준히 일했습니다.'],
    ])('추천 사유 %s → 422 INVALID_RECOMMENDATION_CONTENT', async (_label, reason) => {
      await expectCode(service.create(CEO, { ...DTO, recommendationReason: reason }), UnprocessableEntityException, 'INVALID_RECOMMENDATION_CONTENT');
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('추천 사유 200자(앞뒤 공백 제외)는 허용', async () => {
      await expect(service.create(CEO, { ...DTO, recommendationReason: ` ${'가'.repeat(200)} ` })).resolves.toMatchObject({ status: 'PUBLISHED' });
    });
  });

  describe('목록', () => {
    it('모든 기업의 공개 게시물만 조회한다 (PUBLISHED + 기간 내 + 동의 AGREED) — 철회된 동의는 제외', async () => {
      await service.list(CEO, { keyword: ' 개발 ', position: '과장', page: 2, size: 10 });

      const args = prismaMock.referralPost.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        status: 'PUBLISHED',
        expiresAt: { gt: NOW },
        referralConsent: { status: 'AGREED' },
        OR: [
          { title: { contains: '개발', mode: 'insensitive' } },
          { recommendationReason: { contains: '개발', mode: 'insensitive' } },
        ],
        employee: { position: { contains: '과장', mode: 'insensitive' } },
      });
      expect(args.where).not.toHaveProperty('companyId'); // 다른 기업 게시물도 보인다
      expect(args).toMatchObject({ skip: 10, take: 10 });
    });

    it('익명 게시물은 이름을 마스킹하고, 연락처·이력서 URL은 넣지 않는다', async () => {
      prismaMock.referralPost.count.mockResolvedValue(2);
      prismaMock.referralPost.findMany.mockResolvedValue([
        storedPost({ id: 'p-real' }),
        storedPost({ id: 'p-anon', companyId: 'comp-2', displayNameMode: 'ANONYMOUS' }),
      ]);

      const result = await service.list(CEO, {});

      expect(result.items.map((i) => [i.postId, i.displayName, i.companyName])).toEqual([
        ['p-real', '김민준', '테크플러스'],
        ['p-anon', '김**', '다른기업'],
      ]);
      for (const item of result.items) {
        expect(item).not.toHaveProperty('downloadUrl');
        expect(item).not.toHaveProperty('email');
        expect(item).not.toHaveProperty('phone');
      }
      expect(result).toMatchObject({ page: 1, size: 20, total: 2 });
    });

    it('인사팀장도 조회할 수 있다 (소속 기업과 무관하게 전체 공개 게시물)', async () => {
      prismaMock.referralPost.findMany.mockResolvedValue([storedPost()]);
      prismaMock.referralPost.count.mockResolvedValue(1);

      await expect(service.list(HR, {})).resolves.toMatchObject({ total: 1 });
      expect(prismaMock.hrManager.findUnique).toHaveBeenCalled();
    });

    it('삭제된 인사팀장 계정이면 403', async () => {
      prismaMock.hrManager.findUnique.mockResolvedValue(null);
      await expectCode(service.list(HR, {}), ForbiddenException, 'FORBIDDEN');
    });
  });

  describe('상세', () => {
    it('업로드가 확인된 이력서만 5분 다운로드 URL을 주고, 상세 조회 감사 로그를 남긴다', async () => {
      prismaMock.referralPost.findUnique.mockResolvedValue(storedPost({
        displayNameMode: 'ANONYMOUS',
        resumeFile: { id: 'resume-1', fileName: 'resume.pdf', objectKey: 'k', uploadedAt: NOW },
      }));

      const result = await service.findOne(HR, 'post-1');

      expect(storageMock.presignGet).toHaveBeenCalledWith('k', 300);
      expect(result).toMatchObject({
        postId: 'post-1',
        companyName: '테크플러스',
        employee: { displayName: '김**', position: '과장' },
        resume: { fileName: 'resume.pdf', downloadUrl: 'https://storage.example.com/download?sig=1', expiresAt: new Date(NOW.getTime() + 300_000) },
      });
      expect(auditMock.log).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'HR_MANAGER', action: 'REFERRAL_POST_VIEWED' }));
    });

    it('업로드 미확인 이력서는 다운로드 URL을 만들지 않는다', async () => {
      prismaMock.referralPost.findUnique.mockResolvedValue(storedPost({
        resumeFile: { id: 'resume-1', fileName: 'resume.pdf', objectKey: 'k', uploadedAt: null },
      }));
      const result = await service.findOne(CEO, 'post-1');
      expect(result.resume).toBeNull();
      expect(storageMock.presignGet).not.toHaveBeenCalled();
    });

    it.each([
      ['HIDDEN', { status: 'HIDDEN' }],
      ['DELETED', { status: 'DELETED' }],
      ['동의 철회', { referralConsent: agreedConsent({ status: 'WITHDRAWN' }) }],
    ])('%s 게시물은 404 REFERRAL_POST_NOT_FOUND', async (_label, over) => {
      prismaMock.referralPost.findUnique.mockResolvedValue(storedPost(over));
      await expectCode(service.findOne(CEO, 'post-1'), NotFoundException, 'REFERRAL_POST_NOT_FOUND');
      expect(storageMock.presignGet).not.toHaveBeenCalled();
    });

    it('게시 기간이 끝났으면(스케줄러 전이라도) 410 REFERRAL_POST_EXPIRED', async () => {
      prismaMock.referralPost.findUnique.mockResolvedValueOnce(storedPost({ status: 'EXPIRED' }));
      await expectCode(service.findOne(CEO, 'post-1'), GoneException, 'REFERRAL_POST_EXPIRED');
      prismaMock.referralPost.findUnique.mockResolvedValueOnce(storedPost({ expiresAt: new Date(NOW.getTime() - 1000) }));
      await expectCode(service.findOne(CEO, 'post-1'), GoneException, 'REFERRAL_POST_EXPIRED');
    });
  });

  describe('수정', () => {
    it('게시 기간 3 → 6개월 연장(게시일 기준)과 내용 수정, 변경 전후 감사 로그', async () => {
      const result = await service.update(CEO, 'post-1', { publishMonths: 6, recommendationReason: ' 성실한 인재 ' });

      const sixMonths = addMonths(NOW, 6);
      expect(prismaMock.referralPost.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { recommendationReason: '성실한 인재', expiresAt: sixMonths },
      });
      expect(result.expiresAt).toEqual(sixMonths);
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'REFERRAL_POST_UPDATED',
          metadata: {
            before: { recommendationReason: '추천 사유', expiresAt: addMonths(NOW, 3) },
            after: { recommendationReason: '성실한 인재', expiresAt: sixMonths },
          },
        }),
        prismaMock,
      );
    });

    it('6 → 3개월 단축은 422 INVALID_PUBLISH_PERIOD', async () => {
      prismaMock.referralPost.findUnique.mockResolvedValue(storedPost({ expiresAt: addMonths(NOW, 6) }));
      await expectCode(service.update(CEO, 'post-1', { publishMonths: 3 }), UnprocessableEntityException, 'INVALID_PUBLISH_PERIOD');
    });

    it('추천 사유 정책 위반 422, 익명 동의인데 실명 전환 403 CONSENT_NOT_GIVEN', async () => {
      await expectCode(service.update(CEO, 'post-1', { recommendationReason: '가'.repeat(201) }), UnprocessableEntityException, 'INVALID_RECOMMENDATION_CONTENT');

      prismaMock.referralPost.findUnique.mockResolvedValue(storedPost({
        displayNameMode: 'ANONYMOUS', referralConsent: agreedConsent({ displayNameMode: 'ANONYMOUS' }),
      }));
      await expectCode(service.update(CEO, 'post-1', { displayNameMode: 'REAL_NAME' }), ForbiddenException, 'CONSENT_NOT_GIVEN');
      expect(prismaMock.referralPost.update).not.toHaveBeenCalled();
    });

    it('동의 철회로 HIDDEN된 게시물은 403 CONSENT_WITHDRAWN', async () => {
      prismaMock.referralPost.findUnique.mockResolvedValue(storedPost({ status: 'HIDDEN', referralConsent: agreedConsent({ status: 'WITHDRAWN' }) }));
      await expectCode(service.update(CEO, 'post-1', { title: 'x' }), ForbiddenException, 'CONSENT_WITHDRAWN');
    });

    it('작성 기업이 아니면 403 FORBIDDEN, 없거나 삭제된 게시물은 404', async () => {
      await expectCode(service.update(OTHER_CEO, 'post-1', { title: 'x' }), ForbiddenException, 'FORBIDDEN');
      prismaMock.referralPost.findUnique.mockResolvedValueOnce(null);
      await expectCode(service.update(CEO, 'nope', { title: 'x' }), NotFoundException, 'REFERRAL_POST_NOT_FOUND');
      prismaMock.referralPost.findUnique.mockResolvedValueOnce(storedPost({ status: 'DELETED' }));
      await expectCode(service.update(CEO, 'post-1', { title: 'x' }), NotFoundException, 'REFERRAL_POST_NOT_FOUND');
    });

    it('만료된 게시물은 410 REFERRAL_POST_EXPIRED', async () => {
      prismaMock.referralPost.findUnique.mockResolvedValue(storedPost({ status: 'EXPIRED' }));
      await expectCode(service.update(CEO, 'post-1', { publishMonths: 6 }), GoneException, 'REFERRAL_POST_EXPIRED');
    });
  });

  describe('삭제', () => {
    it('DELETED로 소프트 삭제하고 감사 로그를 남긴다 (HIDDEN 게시물도 삭제 가능)', async () => {
      prismaMock.referralPost.findUnique.mockResolvedValue(storedPost({ status: 'HIDDEN' }));

      const result = await service.remove(CEO, 'post-1');

      expect(prismaMock.referralPost.update).toHaveBeenCalledWith({ where: { id: 'post-1' }, data: { status: 'DELETED' } });
      expect(result).toMatchObject({ postId: 'post-1', status: 'DELETED' });
      expect(auditMock.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'REFERRAL_POST_DELETED', metadata: { previousStatus: 'HIDDEN' } }),
        prismaMock,
      );
    });

    it('이미 삭제됐으면 409 ALREADY_HIDDEN, 작성 기업이 아니면 403', async () => {
      prismaMock.referralPost.findUnique.mockResolvedValueOnce(storedPost({ status: 'DELETED' }));
      await expectCode(service.remove(CEO, 'post-1'), ConflictException, 'ALREADY_HIDDEN');
      await expectCode(service.remove(OTHER_CEO, 'post-1'), ForbiddenException, 'FORBIDDEN');
    });
  });
});

describe('ReferralPostController 권한 (RolesGuard)', () => {
  const guard = new RolesGuard(new Reflector());
  const contextFor = (handler: keyof ReferralPostController, user: unknown) =>
    ({
      getHandler: () => ReferralPostController.prototype[handler],
      getClass: () => ReferralPostController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it.each(['create', 'update', 'remove'] as const)('인사팀장의 %s 시도는 403 FORBIDDEN (대표 전용)', (handler) => {
    expect(() => guard.canActivate(contextFor(handler, HR))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextFor(handler, CEO))).toBe(true);
  });

  it.each(['list', 'findOne'] as const)('%s는 대표·인사팀장 모두 허용', (handler) => {
    expect(guard.canActivate(contextFor(handler, CEO))).toBe(true);
    expect(guard.canActivate(contextFor(handler, HR))).toBe(true);
    expect(() => guard.canActivate(contextFor(handler, { sub: 'a', role: 'APPLICANT' }))).toThrow(ForbiddenException);
  });
});
