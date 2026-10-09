import { Module } from '@nestjs/common';
import { AccessLinkModule } from '../access-link/access-link.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { CeoEvaluationController } from './ceo-evaluation.controller';
import { CeoEvaluationService } from './ceo-evaluation.service';
import { EvaluationExpiryScheduler } from './evaluation-expiry.scheduler';
import { EvaluationResultController } from './evaluation-result.controller';
import { EvaluationResultService } from './evaluation-result.service';
import { ResultLinkController } from './result-link.controller';
import { SelfEvaluationController } from './self-evaluation.controller';
import { SelfEvaluationService } from './self-evaluation.service';

/** 신규 흐름 평가 모듈 (src/evaluations, 복수). 레거시 src/evaluation(단수)과 별개 */
@Module({
  // AuthModule: 대표 API의 JwtAuthGuard가 RedisService(토큰 블랙리스트)를 사용
  imports: [AuthModule, AccessLinkModule, NotificationModule, AuditModule],
  // 직원용 토큰 라우트(evaluations/self/:token, evaluations/result/:token)를
  // 대표용 라우트(evaluations/:evaluationId/ceo, evaluations/:evaluationId/result)보다 먼저 등록
  controllers: [
    SelfEvaluationController,
    ResultLinkController,
    CeoEvaluationController,
    EvaluationResultController,
  ],
  providers: [SelfEvaluationService, CeoEvaluationService, EvaluationResultService, EvaluationExpiryScheduler],
})
export class EvaluationsModule {}
