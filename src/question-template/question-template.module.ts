import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionTemplateController } from './question-template.controller';
import { QuestionTemplateService } from './question-template.service';

@Module({
  // JwtAuthGuard가 AuthModule의 RedisService(토큰 블랙리스트)를 사용
  imports: [AuthModule],
  controllers: [QuestionTemplateController],
  providers: [QuestionTemplateService],
})
export class QuestionTemplateModule {}
