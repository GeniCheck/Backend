import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';
import { AppRole, ROLES_KEY } from '../decorators/roles.decorator';

/**
 * @Roles()로 지정한 역할만 통과시킨다.
 * JwtAuthGuard 뒤에 둬야 req.user가 채워진 상태로 검사한다.
 *
 * @example
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles('COMPANY', 'HR_MANAGER')
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<AppRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // @Roles가 없는 핸들러는 역할 제한 없음
    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '요청 권한이 없습니다.',
      });
    }

    return true;
  }
}
