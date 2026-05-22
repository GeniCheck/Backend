import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly redisService: RedisService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. 기존 JWT 서명/만료 검증 (passport-jwt)
    const isValid = await (super.canActivate(context) as Promise<boolean>);
    if (!isValid) return false;

    // 2. Redis 블랙리스트 확인
    const request = context.switchToHttp().getRequest<Request & { headers: Record<string, string> }>();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('인증 토큰이 없습니다.');
    }

    const token = authHeader.slice(7); // 'Bearer ' 제거
    const blacklisted = await this.redisService.isBlacklisted(token);
    if (blacklisted) {
      throw new UnauthorizedException('로그아웃된 토큰입니다. 다시 로그인해주세요.');
    }

    return true;
  }
}
