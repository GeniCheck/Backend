import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
} from '@nestjs/common';
import { AccessLink, LinkPurpose, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** 링크 토큰 원문은 저장하지 않고 sha256 해시로만 저장·조회한다 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 직원용 1회성 링크(자기선언·자기평가·평가결과·추천동의) 발급·검증·소비·폐기
 * - 직원은 계정이 없으므로 이 링크 토큰이 유일한 인증 수단이다.
 * - 레거시 src/link(LinkService, Redis 기반)와는 별개다.
 */
@Injectable()
export class AccessLinkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 링크를 발급하고 원문 토큰을 반환한다. 원문은 메일 링크에만 쓰고 DB에는 해시만 남는다.
   * 대상 데이터와 함께 커밋되도록 트랜잭션(tx) 안에서만 발급한다.
   */
  async issue(
    purpose: LinkPurpose,
    targetId: string,
    expiresAt: Date,
    tx: Tx,
  ): Promise<string> {
    const token = randomBytes(32).toString('hex');

    await tx.accessLink.create({
      data: {
        purpose,
        targetId,
        expiresAt,
        tokenHash: hashToken(token),
      },
    });

    return token;
  }

  /**
   * 토큰을 검증하고 AccessLink를 반환한다.
   * 판정 순서: 없음(410) → 목적 불일치(403) → 이미 사용(409) → 폐기·만료(410)
   * 제출을 마친 직원이 나중에 링크를 다시 열면 만료보다 "이미 제출"로 안내하기 위해 사용 여부를 먼저 본다.
   */
  async verify(token: string, purpose: LinkPurpose, tx?: Tx): Promise<AccessLink> {
    const client = tx ?? this.prisma;

    const link = token
      ? await client.accessLink.findUnique({
          where: { tokenHash: hashToken(token) },
        })
      : null;

    if (!link) {
      throw linkExpired();
    }
    if (link.purpose !== purpose) {
      throw new ForbiddenException({
        code: 'INVALID_LINK_PURPOSE',
        message: '이 링크로는 요청할 수 없습니다.',
      });
    }
    if (link.usedAt) {
      throw alreadySubmitted();
    }
    if (link.revokedAt || link.expiresAt.getTime() <= Date.now()) {
      throw linkExpired();
    }

    return link;
  }

  /**
   * 링크를 사용 완료 처리한다. 아직 사용되지 않은 링크만 갱신하므로
   * 동시에 두 번 제출돼도 한 번만 성공하고 나머지는 409가 된다.
   */
  async consume(linkId: string, tx: Tx): Promise<void> {
    const { count } = await tx.accessLink.updateMany({
      where: { id: linkId, usedAt: null },
      data: { usedAt: new Date() },
    });

    if (count === 0) {
      throw alreadySubmitted();
    }
  }

  /**
   * 같은 목적·대상의 미사용 링크를 모두 폐기한다(재발송 전 이전 링크 무효화).
   * 폐기한 링크 수를 반환한다.
   */
  async revokeActive(purpose: LinkPurpose, targetId: string, tx: Tx): Promise<number> {
    const { count } = await tx.accessLink.updateMany({
      where: { purpose, targetId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return count;
  }

  /**
   * 사용·폐기되지 않은 링크의 만료 시각을 늦춘다(앞당기지는 않는다).
   * 예: 추천 동의 후 같은 링크로 나중에 철회할 수 있도록 유효 기간 연장.
   */
  async extend(linkId: string, expiresAt: Date, tx: Tx): Promise<void> {
    await tx.accessLink.updateMany({
      where: { id: linkId, usedAt: null, revokedAt: null, expiresAt: { lt: expiresAt } },
      data: { expiresAt },
    });
  }
}

function linkExpired(): GoneException {
  return new GoneException({
    code: 'LINK_EXPIRED',
    message: '만료되었거나 유효하지 않은 링크입니다.',
  });
}

function alreadySubmitted(): ConflictException {
  return new ConflictException({
    code: 'ALREADY_SUBMITTED',
    message: '이미 제출이 완료된 링크입니다.',
  });
}
