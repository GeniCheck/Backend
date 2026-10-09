import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';

/**
 * JwtAuthGuard가 검증한 로그인 사용자(req.user)를 주입한다.
 * sub는 역할마다 의미가 다르므로 기업 범위는 resolveCompanyId(user, prisma)로 구한다.
 *
 * @example
 * async list(@CurrentUser() user: JwtPayload) {}
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
    return request.user;
  },
);
