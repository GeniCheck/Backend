import { Module } from '@nestjs/common';
import { AccessLinkModule } from '../access-link/access-link.module';
import { AuditModule } from '../audit/audit.module';
import { EvaluationExpiryScheduler } from './evaluation-expiry.scheduler';
import { SelfEvaluationController } from './self-evaluation.controller';
import { SelfEvaluationService } from './self-evaluation.service';

/** 신규 흐름 평가 모듈 (src/evaluations, 복수). 레거시 src/evaluation(단수)과 별개 */
@Module({
  imports: [AccessLinkModule, AuditModule],
  controllers: [SelfEvaluationController],
  providers: [SelfEvaluationService, EvaluationExpiryScheduler],
})
export class EvaluationsModule {}
