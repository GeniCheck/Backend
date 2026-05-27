import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LinkController } from './link.controller';
import { LinkService } from './link.service';
import { LinkRedisService } from './link-redis.service';

@Module({
  imports: [ConfigModule],
  controllers: [LinkController],
  providers: [LinkService, LinkRedisService],
  exports: [LinkService],
})
export class LinkModule {}
