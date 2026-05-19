import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import CoolSMS from 'coolsms-node-sdk';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendOtp(to: string, code: string): Promise<void> {
    const apiKey = this.configService.get<string>('COOLSMS_API_KEY') ?? '';
    const apiSecret = this.configService.get<string>('COOLSMS_API_SECRET') ?? '';
    const from = this.configService.get<string>('COOLSMS_FROM') ?? '';

    // 하이픈 제거 정규화: 010-1234-5678 → 01012345678
    const normalizedTo = to.replace(/-/g, '');

    const messageService = new CoolSMS(apiKey, apiSecret);

    try {
      await messageService.sendOne({
        to: normalizedTo,
        from,
        text: `[GeniCheck] OTP 인증 코드: ${code} (3분 이내 입력)`,
        type: 'SMS',
        autoTypeDetect: false,
      });
      this.logger.log(`OTP SMS 발송 성공 → ${normalizedTo}`);
    } catch (error) {
      const stack = error instanceof Error ? error.stack : String(error);
      this.logger.error(`OTP SMS 발송 실패 → ${normalizedTo}`, stack);
      throw error;
    }
  }
}
