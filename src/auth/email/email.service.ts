import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { Transporter } from "nodemailer";

@Injectable()
export class EmailService {
  private readonly transporter: Transporter;
  private readonly logger = new Logger(EmailService.name);
  private readonly fromAddress: string;

  constructor(private readonly configService: ConfigService) {
    this.fromAddress =
      this.configService.get<string>("SMTP_FROM") ?? "noreply@genicheck.com";

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>("SMTP_HOST"),
      port: this.configService.get<number>("SMTP_PORT") ?? 587,
      secure: this.configService.get<string>("SMTP_SECURE") === "true",
      auth: {
        user: this.configService.get<string>("SMTP_USER"),
        pass: this.configService.get<string>("SMTP_PASS"),
      },
    });
  }

  async sendVerificationEmail(to: string, code: string): Promise<void> {
    const subject = "[GeniCheck] 이메일 인증 코드";
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

  async sendHrInviteEmail(to: string, token: string, companyName: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3001";
    const inviteUrl = `${frontendUrl}/hr/accept-invite?token=${token}`;
    const subject = `[GeniCheck] ${companyName}에서 인사팀장으로 초대했습니다`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #333;">인사팀장 계정 초대</h2>
        <p><strong>${companyName}</strong>의 대표가 회원님을 인사팀장으로 등록했습니다. 아래 버튼을 눌러 본인 비밀번호를 설정하고 가입을 완료해주세요.</p>
        <div style="margin: 24px 0;">
          <a href="${inviteUrl}" style="
            display: inline-block;
            background: #4F46E5;
            color: #fff;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: bold;
          ">가입 완료하기</a>
        </div>
        <p style="color: #888; font-size: 13px;">
          이 초대는 <strong>3일</strong> 동안 유효합니다.<br/>
          본인이 요청하지 않았거나 잘못 받은 메일이라면 무시해주세요.
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
      this.logger.log(`HR 초대 이메일 발송 완료: ${to}`);
    } catch (error) {
      this.logger.error(`HR 초대 이메일 발송 실패: ${to}`, error);
      throw error;
    }
  }

  async sendPasswordResetEmail(to: string, code: string): Promise<void> {
    const subject = "[GeniCheck] 비밀번호 재설정 코드";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #333;">비밀번호 재설정</h2>
        <p>아래 코드를 입력해 새 비밀번호를 설정해주세요.</p>
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
          본인이 요청하지 않았다면 이 이메일을 무시하고, 비밀번호를 아무도 모르는 상태로 유지해주세요.
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
      this.logger.log(`비밀번호 재설정 이메일 발송 완료: ${to}`);
    } catch (error) {
      this.logger.error(`비밀번호 재설정 이메일 발송 실패: ${to}`, error);
      throw error;
    }
  }

  async sendHrLoginEmail(to: string, code: string): Promise<void> {
    const subject = "[GeniCheck] 인사팀장 로그인 인증번호";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #333;">인사팀장 로그인 인증번호</h2>
        <p>로그인을 계속하려면 아래 인증번호를 입력해주세요.</p>
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
          인증번호는 <strong>3분</strong> 후 만료됩니다.<br/>
          본인이 요청하지 않았다면 이 메일을 무시해주세요.
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
      this.logger.log(`HR 로그인 인증 이메일 발송 완료: ${to}`);
    } catch (error) {
      this.logger.error(`HR 로그인 인증 이메일 발송 실패: ${to}`, error);
      throw error;
    }
  }

  /** CEO 2단계 로그인 이메일 인증 코드 발송 */
  async sendOtpEmail(to: string, code: string): Promise<void> {
    const subject = "[GeniCheck] OTP 인증 코드";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #333;">CEO 로그인 OTP 인증</h2>
        <p>아래 OTP 코드를 입력해 로그인을 완료해주세요.</p>
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
          이 코드는 <strong>3분</strong> 동안 유효합니다.<br/>
          본인이 요청하지 않은 경우 즉시 비밀번호를 변경해주세요.
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
      this.logger.log(`OTP 이메일 발송 완료: ${to}`);
    } catch (error) {
      this.logger.error(`OTP 이메일 발송 실패: ${to}`, error);
      throw error;
    }
  }

  async sendEvaluationLinkEmail(to: string, token: string): Promise<void> {
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3001";
    const evaluationUrl = `${frontendUrl}/evaluate/${token}`;
    const subject = "[GeniCheck] 평가 링크가 도착했습니다";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #333;">퇴직 후 평가 링크 안내</h2>
        <p>안녕하세요. 아래 링크를 통해 평가를 진행해주세요.</p>
        <div style="margin: 24px 0;">
          <a href="${evaluationUrl}" style="
            display: inline-block;
            background: #4F46E5;
            color: #fff;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: bold;
          ">평가 시작하기</a>
        </div>
        <p style="color: #888; font-size: 13px;">
          링크는 <strong>7일</strong> 동안 유효합니다.<br/>
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
      this.logger.log(`평가 링크 이메일 발송 완료: ${to}`);
    } catch (error) {
      this.logger.error(`평가 링크 이메일 발송 실패: ${to}`, error);
      throw error;
    }
  }
}
