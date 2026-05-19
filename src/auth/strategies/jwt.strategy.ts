import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtPayload {
  sub: string;
  role: 'APPLICANT' | 'COMPANY' | 'HR_MANAGER';
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly configService: ConfigService) {
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

  validate(payload: JwtPayload): JwtPayload {
    if (!payload.sub || !payload.role) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }
    return { sub: payload.sub, role: payload.role };
  }
}
