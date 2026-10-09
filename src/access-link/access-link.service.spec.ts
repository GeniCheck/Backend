import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
} from '@nestjs/common';
import { AccessLinkService, hashToken } from './access-link.service';
import { PrismaService } from '../prisma/prisma.service';

// accessLink 테이블을 메모리로 흉내 내는 가짜 클라이언트 (prisma·tx 공용)
function createFakeDb() {
  const links: any[] = [];
  const matches = (link: any, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) =>
      value && typeof value === 'object' && 'lt' in value
        ? link[key] < (value as { lt: Date }).lt
        : link[key] === value,
    );

  const accessLink = {
    create: jest.fn(async ({ data }: any) => {
      const link = {
        id: `link-${links.length + 1}`,
        usedAt: null,
        revokedAt: null,
        createdAt: new Date(),
        ...data,
      };
      links.push(link);
      return link;
    }),
    findUnique: jest.fn(
      async ({ where }: any) => links.find((l) => l.tokenHash === where.tokenHash) ?? null,
    ),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const targets = links.filter((l) => matches(l, where));
      targets.forEach((l) => Object.assign(l, data));
      return { count: targets.length };
    }),
  };

  return { links, client: { accessLink } };
}

async function expectError(
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

describe('AccessLinkService', () => {
  const future = () => new Date(Date.now() + 60 * 60 * 1000);
  let db: ReturnType<typeof createFakeDb>;
  let tx: any;
  let service: AccessLinkService;

  beforeEach(() => {
    db = createFakeDb();
    tx = db.client;
    service = new AccessLinkService(db.client as unknown as PrismaService);
  });

  it('발급 시 원문 토큰을 반환하고 DB에는 sha256 해시만 저장한다', async () => {
    const token = await service.issue('DECLARATION', 'decl-1', future(), tx);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.links).toHaveLength(1);
    expect(db.links[0].tokenHash).toBe(hashToken(token));
    expect(db.links[0].tokenHash).not.toBe(token);
    expect(JSON.stringify(db.links[0])).not.toContain(token);
  });

  it('발급 → 검증 → 소비 후 같은 링크를 다시 검증하면 409 ALREADY_SUBMITTED', async () => {
    const token = await service.issue('SELF_EVALUATION', 'eval-1', future(), tx);

    const link = await service.verify(token, 'SELF_EVALUATION');
    expect(link).toMatchObject({ purpose: 'SELF_EVALUATION', targetId: 'eval-1' });

    await service.consume(link.id, tx);
    expect(db.links[0].usedAt).toBeInstanceOf(Date);

    await expectError(
      service.verify(token, 'SELF_EVALUATION'),
      ConflictException,
      'ALREADY_SUBMITTED',
    );
  });

  it('존재하지 않는 토큰은 410 LINK_EXPIRED', async () => {
    await expectError(service.verify('not-exist', 'DECLARATION'), GoneException, 'LINK_EXPIRED');
    await expectError(service.verify('', 'DECLARATION'), GoneException, 'LINK_EXPIRED');
  });

  it('만료된 링크는 410 LINK_EXPIRED', async () => {
    const token = await service.issue('DECLARATION', 'decl-1', new Date(Date.now() - 1000), tx);

    await expectError(service.verify(token, 'DECLARATION'), GoneException, 'LINK_EXPIRED');
  });

  it('폐기된 링크는 410 LINK_EXPIRED', async () => {
    const token = await service.issue('DECLARATION', 'decl-1', future(), tx);
    db.links[0].revokedAt = new Date();

    await expectError(service.verify(token, 'DECLARATION'), GoneException, 'LINK_EXPIRED');
  });

  it('발급 목적과 다른 용도로 쓰면 403 INVALID_LINK_PURPOSE', async () => {
    const token = await service.issue('DECLARATION', 'decl-1', future(), tx);

    await expectError(
      service.verify(token, 'EVALUATION_RESULT'),
      ForbiddenException,
      'INVALID_LINK_PURPOSE',
    );
  });

  it('이미 소비된 링크를 다시 소비하면 409 ALREADY_SUBMITTED (동시 제출 방지)', async () => {
    const token = await service.issue('DECLARATION', 'decl-1', future(), tx);
    const link = await service.verify(token, 'DECLARATION');

    await service.consume(link.id, tx);
    await expectError(service.consume(link.id, tx), ConflictException, 'ALREADY_SUBMITTED');
  });

  it('revokeActive는 같은 목적·대상의 미사용 링크만 폐기한다', async () => {
    const oldToken1 = await service.issue('REFERRAL_CONSENT', 'emp-1', future(), tx);
    const oldToken2 = await service.issue('REFERRAL_CONSENT', 'emp-1', future(), tx);
    const otherPurpose = await service.issue('DECLARATION', 'emp-1', future(), tx);
    const otherTarget = await service.issue('REFERRAL_CONSENT', 'emp-2', future(), tx);
    const usedToken = await service.issue('REFERRAL_CONSENT', 'emp-1', future(), tx);
    await service.consume((await service.verify(usedToken, 'REFERRAL_CONSENT')).id, tx);

    const revoked = await service.revokeActive('REFERRAL_CONSENT', 'emp-1', tx);

    expect(revoked).toBe(2);
    await expectError(service.verify(oldToken1, 'REFERRAL_CONSENT'), GoneException, 'LINK_EXPIRED');
    await expectError(service.verify(oldToken2, 'REFERRAL_CONSENT'), GoneException, 'LINK_EXPIRED');
    await expect(service.verify(otherPurpose, 'DECLARATION')).resolves.toBeDefined();
    await expect(service.verify(otherTarget, 'REFERRAL_CONSENT')).resolves.toBeDefined();
    // 이미 사용된 링크는 폐기 대상이 아니고 계속 409로 안내된다
    await expectError(
      service.verify(usedToken, 'REFERRAL_CONSENT'),
      ConflictException,
      'ALREADY_SUBMITTED',
    );
  });

  it('verify에 tx를 넘기면 tx로 조회한다', async () => {
    const token = await service.issue('DECLARATION', 'decl-1', future(), tx);
    const otherTx = { accessLink: { findUnique: jest.fn().mockResolvedValue(db.links[0]) } };

    await service.verify(token, 'DECLARATION', otherTx as any);

    expect(otherTx.accessLink.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(token) },
    });
    expect(db.client.accessLink.findUnique).not.toHaveBeenCalled();
  });

  it('extend는 미사용·미폐기 링크의 만료만 늦추고, 앞당기지는 않는다', async () => {
    const base = future();
    const later = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    const earlier = new Date(base.getTime() - 60 * 1000);
    await service.issue('REFERRAL_CONSENT', 'c-1', base, tx);
    await service.issue('REFERRAL_CONSENT', 'c-2', base, tx);
    await service.issue('REFERRAL_CONSENT', 'c-3', base, tx);
    db.links[1].usedAt = new Date();
    db.links[2].revokedAt = new Date();

    await service.extend('link-1', later, tx);
    await service.extend('link-2', later, tx);
    await service.extend('link-3', later, tx);
    expect(db.links.map((l) => l.expiresAt)).toEqual([later, base, base]);

    await service.extend('link-1', earlier, tx);
    expect(db.links[0].expiresAt).toEqual(later);
  });
});
