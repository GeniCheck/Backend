import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { EmployeeController } from './employee.controller';
import { EmployeeService } from './employee.service';

@Module({
  // JwtAuthGuard가 AuthModule의 RedisService(토큰 블랙리스트)를 사용
  imports: [AuthModule, AuditModule],
  controllers: [EmployeeController],
  providers: [EmployeeService],
})
export class EmployeeModule {}
