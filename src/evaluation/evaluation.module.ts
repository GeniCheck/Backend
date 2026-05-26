import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { AuthModule } from '../auth/auth.module';
import { LinkModule } from '../link/link.module';

@Module({
  imports: [ConfigModule, AuthModule, LinkModule],
  controllers: [EvaluationController],
  providers: [EvaluationService],
})
export class EvaluationModule {}
