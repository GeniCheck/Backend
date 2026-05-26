import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmploymentController } from './employment.controller';
import { EmploymentService } from './employment.service';
import { AuthModule } from '../auth/auth.module';
import { LinkModule } from '../link/link.module';

@Module({
  imports: [ConfigModule, AuthModule, LinkModule],
  controllers: [EmploymentController],
  providers: [EmploymentService],
})
export class EmploymentModule {}
