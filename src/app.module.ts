import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConsentModule } from './consent/consent.module';
import { LinkModule } from './link/link.module';
import { EmploymentModule } from './employment/employment.module';
import { EvaluationModule } from './evaluation/evaluation.module';

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
  ],
})
export class AppModule {}
