import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transporter: Transporter;
  private readonly logger = new Logger(EmailService.name);
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress = this.configService.get<string>('SMTP_FROM') ?? 'noreply@genicheck.com';

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT') ?? 587,
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    const subject = '[GeniCheck] 이메일 인증 코드';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #333;">이메일 인증</h2>
        <p>아래 인증 코드를 입력해 이메일 인증을 완료해주세요.</p>
        <div style="
          background: #f4f4f4;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          font-size: 32px;
          font-weight: bold;
          letter-spacing: 8px;
          color: #222;
          margin: 24px 0;
        ">
          ${code}
        </div>
        <p style="color: #888; font-size: 13px;">
          이 코드는 <strong>10분</strong> 동안 유효합니다.<br/>
          본인이 요청하지 않은 경우 이 이메일을 무시하세요.
        </p>
      </div>
    `;

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to,
        subject,
        html,
      });
      this.logger.log(`인증 이메일 발송 완료: ${to}`);
    } catch (error) {
      this.logger.error(`인증 이메일 발송 실패: ${to}`, error);
      // 이메일 발송 실패는 서버 에러로 전파하지 않고 로그만 남김
      // 실제 운영에서는 재시도 큐 등을 사용할 것
      throw error;
    }
  }
}
