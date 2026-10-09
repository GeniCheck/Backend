import { SetMetadata } from '@nestjs/common';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';

export const ROLES_KEY = 'roles';

export type AppRole = JwtPayload['role'];

/**
 * 핸들러(또는 컨트롤러)에 접근 가능한 역할을 지정한다. RolesGuard와 함께 사용한다.
 *
 * @example
 * @UseGuards(JwtAuthGuard, RolesGuard)
 * @Roles('COMPANY')
 */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
