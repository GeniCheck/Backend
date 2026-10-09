import { Module } from '@nestjs/common';
import { AccessLinkModule } from '../access-link/access-link.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { DeclarationFormController } from './declaration-form.controller';
import { DeclarationController } from './declaration.controller';
import { DeclarationService } from './declaration.service';

@Module({
  // JwtAuthGuard가 AuthModule의 RedisService(토큰 블랙리스트)를 사용
  imports: [AuthModule, AccessLinkModule, NotificationModule, AuditModule],
  // 직원용 라우트(declarations/forms/:token)를 대표용(declarations/:employeeId)보다 먼저 등록
  controllers: [DeclarationFormController, DeclarationController],
  providers: [DeclarationService],
})
export class DeclarationModule {}
