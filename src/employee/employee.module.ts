import { Module } from '@nestjs/common';
import { AccessLinkModule } from '../access-link/access-link.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { EmployeeResignController } from './employee-resign.controller';
import { EmployeeResignService } from './employee-resign.service';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';

@Module({
  // JwtAuthGuard가 AuthModule의 RedisService(토큰 블랙리스트)를 사용
  imports: [AuthModule, AuditModule, AccessLinkModule, NotificationModule],
  controllers: [EmployeeController, EmployeeResignController],
  providers: [EmployeeService, EmployeeResignService],
})
export class EmployeeModule {}
