import { GoneException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LinkRedisService } from './link-redis.service';

const LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const PREFIX = 'eval:link:';

@Injectable()
export class LinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: LinkRedisService,
  ) {}

  async generateToken(employmentId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.redis.set(`${PREFIX}${token}`, employmentId, LINK_TTL_SECONDS);
    return token;
  }

  async validate(token: string): Promise<{ employmentId: string }> {
    const employmentId = await this.redis.get(`${PREFIX}${token}`);
    if (!employmentId) {
      await this.prisma.evaluationLink.updateMany({
        where: { token, status: 'pending' },
        data: { status: 'expired' },
      });
      throw new GoneException({
        success: false,
        code: 'LINK_EXPIRED',
        message: '만료된 링크입니다.',
      });
    }
    return { employmentId };
  }

  async invalidate(token: string): Promise<void> {
    await this.redis.del(`${PREFIX}${token}`);
  }
}
