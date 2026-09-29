import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  role: 'APPLICANT' | 'COMPANY' | 'HR_MANAGER';
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // secretOrKeyProvider 를 사용해 ConfigService 가 완전히 초기화된 후 secret 을 읽음
      secretOrKeyProvider: (
        _request: unknown,
        _rawJwtToken: unknown,
        done: (err: Error | null, secret?: string) => void,
      ) => {
        const secret = configService.get<string>('JWT_ACCESS_SECRET');
        if (!secret) {
          done(new Error('JWT_ACCESS_SECRET is not configured'));
        } else {
          done(null, secret);
        }
      },
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    // 토큰 서명이 유효해도 계정이 삭제됐으면 즉시 거부 — 그렇지 않으면 삭제된
    // 계정의 액세스 토큰이 만료 시간(기본 1h)까지 계속 유효하게 남아있게 됨
    // (예: 대표가 인사팀장을 삭제해도, 그 인사팀장의 기존 세션이 바로 끊기지 않는 문제)
    const exists = await this.entityExists(payload.role, payload.sub);
    if (!exists) {
      throw new UnauthorizedException('계정을 찾을 수 없습니다. 다시 로그인해주세요.');
    }

    return { sub: payload.sub, role: payload.role };
  }

  private async entityExists(
    role: JwtPayload['role'],
    id: string,
  ): Promise<boolean> {
    switch (role) {
      case 'APPLICANT':
        return !!(await this.prisma.applicant.findUnique({
          where: { id },
          select: { id: true },
        }));
      case 'COMPANY':
        return !!(await this.prisma.company.findUnique({
          where: { id },
          select: { id: true },
        }));
      case 'HR_MANAGER':
        return !!(await this.prisma.hrManager.findUnique({
          where: { id },
          select: { id: true },
        }));
      default:
        return false;
    }
  }
}
