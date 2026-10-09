import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConsentModule } from './consent/consent.module';
import { LinkModule } from './link/link.module';
import { EmploymentModule } from './employment/employment.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { AccessLinkModule } from './access-link/access-link.module';
import { NotificationModule } from './notification/notification.module';
import { AuditModule } from './audit/audit.module';
import { QuestionTemplateModule } from './question-template/question-template.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    ConsentModule,
    LinkModule,
    EmploymentModule,
    EvaluationModule,
    AccessLinkModule,
    NotificationModule,
    AuditModule,
    QuestionTemplateModule,
  ],
})
export class AppModule {}
