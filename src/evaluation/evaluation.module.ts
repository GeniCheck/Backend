import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { EvaluationSchedulerService } from './evaluation-scheduler.service';
import { AuthModule } from '../auth/auth.module';
import { LinkModule } from '../link/link.module';

@Module({
  imports: [ConfigModule, AuthModule, LinkModule, ScheduleModule.forRoot()],
  controllers: [EvaluationController],
  providers: [EvaluationService, EvaluationSchedulerService],
})
export class EvaluationModule {}
