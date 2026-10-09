import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DisplayNameMode, Prisma, ReferralConsent, ReferralPost } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { resolveCompanyId } from '../core/utils/company-scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReferralPostDto, ListReferralPostsQueryDto, UpdateReferralPostDto } from './dto/referral-post.dto';
import {
  FORBIDDEN_RECOMMENDATION_WORDS,
  RECOMMENDATION_REASON_MAX_LENGTH,
  RESUME_DOWNLOAD_URL_TTL_SECONDS,
  addMonths,
  maskName,
} from './referral.constants';
import { ResumeService } from './resume.service';
import { StorageService } from './storage/storage.service';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

/**
 * 인재 추천 게시물.
 * 권한: 작성·수정·삭제는 작성 기업 대표만, 목록·상세는 모든 가입 기업의 대표·인사팀장.
 * 공개 조건: PUBLISHED + 게시 기간 내 + 직원 동의 AGREED (철회·만료되면 즉시 보이지 않는다).
 */
@Injectable()
export class ReferralPostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resumeService: ResumeService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /** 대표: 추천 게시물 작성 */
  async create(user: JwtPayload, dto: CreateReferralPostDto) {
    const companyId = await resolveCompanyId(user, this.prisma);

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, companyId: true },
    });
    if (!employee) {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: '직원을 찾을 수 없습니다.' });
    }
    if (employee.companyId !== companyId) {
      throw forbidden('다른 기업의 직원은 추천할 수 없습니다.');
    }

    const consent = await this.prisma.referralConsent.findFirst({
      where: { employeeId: employee.id, status: 'AGREED' },
    });
    if (!consent) {
      throw new ForbiddenException({
        code: 'CONSENT_NOT_GIVEN',
        message: '직원이 추천 게시에 동의한 경우에만 게시할 수 있습니다.',
      });
    }
    assertDisplayNameAllowed(consent, dto.displayNameMode);

    const active = await this.prisma.referralPost.findFirst({
      where: { employeeId: employee.id, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException({
        code: 'ACTIVE_POST_EXISTS',
        message: '이 직원의 공개 중인 추천 게시물이 이미 있습니다.',
        details: { postId: active.id },
      });
    }

    const recommendationReason = validateRecommendation(dto.recommendationReason);

    // 이력서는 트랜잭션 전에 실제 업로드 여부를 확인한다 (스토리지 조회는 외부 I/O)
    if (dto.resumeFileId) {
      await this.resumeService.confirmUploaded(dto.resumeFileId, companyId, employee.id);
    }

    const publishedAt = new Date();
    const expiresAt = addMonths(publishedAt, dto.publishMonths);

    const post = await this.prisma.$transaction(async (tx) => {
      const created = await tx.referralPost.create({
        data: {
          companyId,
          employeeId: employee.id,
          referralConsentId: consent.id,
          resumeFileId: dto.resumeFileId ?? null,
          title: dto.title.trim(),
          recommendationReason,
          displayNameMode: dto.displayNameMode,
          status: 'PUBLISHED',
          publishedAt,
          expiresAt,
        },
      });

      await this.auditService.log(
        {
          actorType: 'COMPANY',
          actorId: user.sub,
          action: 'REFERRAL_POST_CREATED',
          targetType: 'ReferralPost',
          targetId: created.id,
          metadata: { employeeId: employee.id, publishMonths: dto.publishMonths, hasResume: !!dto.resumeFileId },
        },
        tx,
      );

      return created;
    });

    return { postId: post.id, status: post.status, publishedAt: post.publishedAt, expiresAt: post.expiresAt };
  }

  /** 대표·인사팀장: 공개 중인 추천 게시물 목록 (모든 가입 기업). 연락처·이력서 URL은 포함하지 않는다 */
  async list(user: JwtPayload, query: ListReferralPostsQueryDto) {
    // 인사팀장 계정이 유효한지(삭제되지 않았는지)도 여기서 확인된다
    await resolveCompanyId(user, this.prisma);

    const page = query.page ?? DEFAULT_PAGE;
    const size = query.size ?? DEFAULT_SIZE;
    const keyword = query.keyword?.trim();
    const position = query.position?.trim();

    const where: Prisma.ReferralPostWhereInput = {
      ...visibleWhere(new Date()),
      ...(keyword && {
        OR: [
          { title: { contains: keyword, mode: 'insensitive' } },
          { recommendationReason: { contains: keyword, mode: 'insensitive' } },
        ],
      }),
      ...(position && { employee: { position: { contains: position, mode: 'insensitive' } } }),
    };

    const [total, posts] = await this.prisma.$transaction([
      this.prisma.referralPost.count({ where }),
      this.prisma.referralPost.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * size,
        take: size,
        include: { employee: { select: { name: true, position: true } } },
      }),
    ]);

    const companyNames = await this.companyNames(posts.map((p) => p.companyId));

    return {
      items: posts.map((post) => ({
        postId: post.id,
        title: post.title,
        displayName: displayNameOf(post.employee.name, post.displayNameMode),
        position: post.employee.position,
        companyName: companyNames.get(post.companyId) ?? null,
        publishedAt: post.publishedAt,
        expiresAt: post.expiresAt,
      })),
      page,
      size,
      total,
    };
  }

  /** 대표·인사팀장: 추천 상세. 업로드가 확인된 이력서만 5분짜리 다운로드 URL을 준다 */
  async findOne(user: JwtPayload, postId: string) {
    const viewerCompanyId = await resolveCompanyId(user, this.prisma);

    const post = await this.prisma.referralPost.findUnique({
      where: { id: postId },
      include: {
        employee: { select: { name: true, position: true } },
        referralConsent: { select: { status: true } },
        resumeFile: true,
      },
    });
    const now = new Date();
    // 비공개(HIDDEN·DELETED)이거나 동의가 유지되지 않으면 존재 자체를 드러내지 않는다
    if (!post || (post.status !== 'PUBLISHED' && post.status !== 'EXPIRED') || post.referralConsent.status !== 'AGREED') {
      throw postNotFound();
    }
    if (post.status === 'EXPIRED' || post.expiresAt <= now) {
      throw new GoneException({ code: 'REFERRAL_POST_EXPIRED', message: '게시 기간이 끝난 추천 게시물입니다.' });
    }

    let resume: { fileName: string; downloadUrl: string; expiresAt: Date } | null = null;
    if (post.resumeFile?.uploadedAt) {
      resume = {
        fileName: post.resumeFile.fileName,
        downloadUrl: await this.storage.presignGet(post.resumeFile.objectKey, RESUME_DOWNLOAD_URL_TTL_SECONDS),
        expiresAt: new Date(now.getTime() + RESUME_DOWNLOAD_URL_TTL_SECONDS * 1000),
      };
    }

    const companyNames = await this.companyNames([post.companyId]);

    await this.auditService.log({
      actorType: user.role === 'HR_MANAGER' ? 'HR_MANAGER' : 'COMPANY',
      actorId: user.sub,
      action: 'REFERRAL_POST_VIEWED',
      targetType: 'ReferralPost',
      targetId: post.id,
      metadata: { viewerCompanyId, resumeUrlIssued: !!resume },
    });

    return {
      postId: post.id,
      title: post.title,
      companyName: companyNames.get(post.companyId) ?? null,
      employee: {
        displayName: displayNameOf(post.employee.name, post.displayNameMode),
        position: post.employee.position,
      },
      recommendationReason: post.recommendationReason,
      resume,
      publishedAt: post.publishedAt,
      postExpiresAt: post.expiresAt,
    };
  }

  /** 작성 기업 대표: 제목·추천 사유·이름 표시 방식 수정, 게시 기간 3 → 6개월 연장 */
  async update(user: JwtPayload, postId: string, dto: UpdateReferralPostDto) {
    const companyId = await resolveCompanyId(user, this.prisma);
    const post = await this.findOwnedPost(postId, companyId);

    if (post.status === 'DELETED') {
      throw postNotFound();
    }
    if (post.status === 'HIDDEN' || post.referralConsent.status !== 'AGREED') {
      throw new ForbiddenException({
        code: 'CONSENT_WITHDRAWN',
        message: '직원이 추천 게시 동의를 철회해 수정할 수 없습니다.',
      });
    }
    if (post.status === 'EXPIRED' || post.expiresAt <= new Date()) {
      throw new GoneException({ code: 'REFERRAL_POST_EXPIRED', message: '게시 기간이 끝난 추천 게시물입니다.' });
    }
    if (dto.displayNameMode) {
      assertDisplayNameAllowed(post.referralConsent, dto.displayNameMode);
    }

    let expiresAt = post.expiresAt;
    if (dto.publishMonths !== undefined) {
      const extended = addMonths(post.publishedAt, dto.publishMonths);
      if (extended < post.expiresAt) {
        throw new UnprocessableEntityException({
          code: 'INVALID_PUBLISH_PERIOD',
          message: '게시 기간은 늘릴 수만 있습니다 (3개월 → 6개월).',
        });
      }
      expiresAt = extended;
    }

    const data: Prisma.ReferralPostUpdateInput = {
      ...(dto.title !== undefined && { title: dto.title.trim() }),
      ...(dto.recommendationReason !== undefined && {
        recommendationReason: validateRecommendation(dto.recommendationReason),
      }),
      ...(dto.displayNameMode !== undefined && { displayNameMode: dto.displayNameMode }),
      ...(expiresAt.getTime() !== post.expiresAt.getTime() && { expiresAt }),
    };

    const before = pickChanged(post, data);
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = Object.keys(data).length > 0 ? await tx.referralPost.update({ where: { id: post.id }, data }) : post;

      if (Object.keys(data).length > 0) {
        await this.auditService.log(
          {
            actorType: 'COMPANY',
            actorId: user.sub,
            action: 'REFERRAL_POST_UPDATED',
            targetType: 'ReferralPost',
            targetId: post.id,
            metadata: { before, after: pickChanged(saved, data) } as Prisma.InputJsonValue,
          },
          tx,
        );
      }
      return saved;
    });

    return { postId: updated.id, status: updated.status, updatedAt: updated.updatedAt, expiresAt: updated.expiresAt };
  }

  /** 작성 기업 대표: 소프트 삭제(DELETED). 물리 삭제하지 않는다 */
  async remove(user: JwtPayload, postId: string) {
    const companyId = await resolveCompanyId(user, this.prisma);
    const post = await this.findOwnedPost(postId, companyId);
    if (post.status === 'DELETED') {
      throw new ConflictException({ code: 'ALREADY_HIDDEN', message: '이미 삭제된 추천 게시물입니다.' });
    }

    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.referralPost.update({ where: { id: post.id }, data: { status: 'DELETED' } });

      await this.auditService.log(
        {
          actorType: 'COMPANY',
          actorId: user.sub,
          action: 'REFERRAL_POST_DELETED',
          targetType: 'ReferralPost',
          targetId: post.id,
          metadata: { previousStatus: post.status },
        },
        tx,
      );

      return { postId: saved.id, status: saved.status, deletedAt: saved.updatedAt };
    });
  }

  private async findOwnedPost(postId: string, companyId: string) {
    const post = await this.prisma.referralPost.findUnique({
      where: { id: postId },
      include: { referralConsent: true },
    });
    if (!post) {
      throw postNotFound();
    }
    if (post.companyId !== companyId) {
      throw forbidden('작성한 기업만 추천 게시물을 관리할 수 있습니다.');
    }
    return post;
  }

  private async companyNames(companyIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(companyIds)];
    if (unique.length === 0) return new Map();
    const companies = await this.prisma.company.findMany({
      where: { id: { in: unique } },
      select: { id: true, companyName: true },
    });
    return new Map(companies.map((c) => [c.id, c.companyName]));
  }
}

/** 공개 조건: PUBLISHED + 게시 기간 내 + 동의 유지 */
function visibleWhere(now: Date): Prisma.ReferralPostWhereInput {
  return {
    status: 'PUBLISHED',
    expiresAt: { gt: now },
    referralConsent: { status: 'AGREED' },
  };
}

function displayNameOf(name: string, mode: DisplayNameMode): string {
  return mode === 'ANONYMOUS' ? maskName(name) : name;
}

/** 직원이 익명 공개에만 동의했다면 실명으로 게시할 수 없다 */
function assertDisplayNameAllowed(consent: Pick<ReferralConsent, 'displayNameMode'>, mode: DisplayNameMode): void {
  if (consent.displayNameMode === 'ANONYMOUS' && mode !== 'ANONYMOUS') {
    throw new ForbiddenException({
      code: 'CONSENT_NOT_GIVEN',
      message: '직원이 익명 공개에만 동의했습니다. 이름을 실명으로 표시할 수 없습니다.',
    });
  }
}

/** 추천 사유: 앞뒤 공백 제거 후 1~200자, 금지 표현 없음 */
function validateRecommendation(reason: string): string {
  const trimmed = reason.trim();
  const found = FORBIDDEN_RECOMMENDATION_WORDS.filter((word) => trimmed.includes(word));

  if (!trimmed || trimmed.length > RECOMMENDATION_REASON_MAX_LENGTH || found.length > 0) {
    throw new UnprocessableEntityException({
      code: 'INVALID_RECOMMENDATION_CONTENT',
      message:
        found.length > 0
          ? '추천 사유에 사용할 수 없는 표현이 있습니다.'
          : `추천 사유는 1~${RECOMMENDATION_REASON_MAX_LENGTH}자로 입력해 주세요.`,
      details: { length: trimmed.length, maxLength: RECOMMENDATION_REASON_MAX_LENGTH, forbiddenWords: found },
    });
  }
  return trimmed;
}

function pickChanged(post: ReferralPost, data: Prisma.ReferralPostUpdateInput): Record<string, unknown> {
  return Object.fromEntries(Object.keys(data).map((key) => [key, post[key as keyof ReferralPost]]));
}

function postNotFound(): NotFoundException {
  return new NotFoundException({ code: 'REFERRAL_POST_NOT_FOUND', message: '추천 게시물을 찾을 수 없습니다.' });
}

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: 'FORBIDDEN', message });
}
