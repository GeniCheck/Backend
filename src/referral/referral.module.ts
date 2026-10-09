import { Module } from '@nestjs/common';
import { AccessLinkModule } from '../access-link/access-link.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { ReferralConsentController } from './referral-consent.controller';
import { ReferralConsentService } from './referral-consent.service';
import { ReferralExpiryScheduler } from './referral-expiry.scheduler';

/** 인재 추천 (신규 흐름). 레거시 src/consent와 무관 */
@Module({
  // AuthModule: 대표 API의 JwtAuthGuard가 RedisService(토큰 블랙리스트)를 사용
  imports: [AuthModule, AccessLinkModule, NotificationModule, AuditModule],
  controllers: [ReferralConsentController],
  providers: [ReferralConsentService, ReferralExpiryScheduler],
})
export class ReferralModule {}
