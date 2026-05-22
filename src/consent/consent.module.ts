import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule, // JwtAuthGuard, JwtModule 사용을 위해 import
  ],
  controllers: [ConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
