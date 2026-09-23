import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { EmailService } from './email/email.service';
import { RedisService } from './redis/redis.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '1h',
        },
      }),
    }),
    // auth 모듈 전용 rate limit — 다른 모듈에는 영향 없음 (전역 APP_GUARD 아님)
    // 기본: IP당 분당 20회. 로그인/OTP/비밀번호류는 컨트롤러에서 @Throttle로 더 좁게 재정의
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 20 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, EmailService, RedisService, JwtAuthGuard],
  exports: [AuthService, JwtModule, RedisService, JwtAuthGuard, EmailService],
})
export class AuthModule {}
