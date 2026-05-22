import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      // 연결 실패 시 무한 재시도 방지
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    this.client.on('connect', () => this.logger.log('Redis 연결 성공'));
    this.client.on('error', (err) => this.logger.error('Redis 연결 오류', err.stack));
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  // Access Token을 블랙리스트에 추가 (TTL 초 단위)
  async addToBlacklist(token: string, ttlSeconds: number): Promise<void> {
    // 키 충돌 방지를 위해 네임스페이스 prefix 사용
    await this.client.set(`bl:${token}`, '1', 'EX', ttlSeconds);
  }

  // 블랙리스트 여부 확인
  async isBlacklisted(token: string): Promise<boolean> {
    const result = await this.client.get(`bl:${token}`);
    return result !== null;
  }
}
