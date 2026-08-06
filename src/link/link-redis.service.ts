import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class LinkRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinkRedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.client = new Redis(url, { maxRetriesPerRequest: 3 });
    this.client.on('connect', () => this.logger.log('LinkRedis 연결 성공'));
    this.client.on('error', (err) => this.logger.error('LinkRedis 오류', err.stack));
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch {
      this.logger.error('LinkRedis set 실패 — Redis 연결 상태를 확인하세요.');
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      this.logger.error('LinkRedis get 실패 — Redis 연결 상태를 확인하세요.');
      return null;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch {
      this.logger.error('LinkRedis del 실패 — Redis 연결 상태를 확인하세요.');
    }
  }
}
