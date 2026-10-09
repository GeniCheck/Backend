import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { DEFAULT_FRONTEND_URL, MAIL_LINK_PATHS } from './mail-paths';

export interface LinkMailParams {
  to: string;
  token: string;
  employeeName?: string;
  companyName?: string;
  expiresAt?: Date;
}

interface MailContent {
  subject: string;
  title: string;
  description: string;
  buttonLabel: string;
}

/**
 * 신규 흐름(직원용 1회성 링크) 메일 발송 서비스
 * - auth의 EmailService와 별개이며, SMTP 환경변수만 같은 값을 사용한다.
 * - 예외를 던지지 않고 발송 성공 여부(boolean)를 반환한다. 호출 측은 linkSent 같은 응답 필드로 결과를 알린다.
 * - 반드시 prisma.$transaction 커밋 후에 호출한다. 트랜잭션 안에서 호출하면
 *   메일은 나갔는데 데이터는 롤백되는 불일치가 생기고, 메일 지연이 트랜잭션을 붙잡는다.
 * - SMTP_USER가 비어 있으면(로컬 개발) 실제 발송 대신 링크를 로그로 출력하고 true를 반환한다.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly fromAddress: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    const smtpUser = this.configService.get<string>('SMTP_USER')?.trim();

    this.fromAddress =
      this.configService.get<string>('SMTP_FROM') ?? 'noreply@genicheck.com';

    // FRONTEND_URL이 빈 문자열이어도 기본값을 쓰도록 trim 후 판단 (auth EmailService와 같은 처리)
    const configuredUrl = this.configService.get<string>('FRONTEND_URL')?.trim();
    this.frontendUrl = (configuredUrl || DEFAULT_FRONTEND_URL).replace(/\/+$/, '');

    this.transporter = smtpUser
      ? nodemailer.createTransport({
          host: this.configService.get<string>('SMTP_HOST'),
          port: Number(this.configService.get<string>('SMTP_PORT')) || 587,
          secure: this.configService.get<string>('SMTP_SECURE') === 'true',
          auth: {
            user: smtpUser,
            pass: this.configService.get<string>('SMTP_PASS'),
          },
        })
      : null;
  }

  /** 입사 자기선언 질문지 링크 */
  sendDeclarationLink(params: LinkMailParams): Promise<boolean> {
    return this.sendLinkMail(params, MAIL_LINK_PATHS.DECLARATION, {
      subject: '[GeniCheck] 입사 자기선언 작성 요청',
      title: '입사 자기선언 작성 안내',
      description: '아래 버튼을 눌러 입사 자기선언 질문지를 작성해주세요.',
      buttonLabel: '자기선언 작성하기',
    });
  }

  /** 퇴사 자기평가 링크 */
  sendSelfEvaluationLink(params: LinkMailParams): Promise<boolean> {
    return this.sendLinkMail(params, MAIL_LINK_PATHS.SELF_EVALUATION, {
      subject: '[GeniCheck] 퇴사 자기평가 작성 요청',
      title: '퇴사 자기평가 안내',
      description: '입사 시 작성한 자기선언을 바탕으로 자기평가를 진행해주세요.',
      buttonLabel: '자기평가 시작하기',
    });
  }

  /** 대표 검증 완료 후 평가 결과 확인 링크 */
  sendEvaluationResult(params: LinkMailParams): Promise<boolean> {
    return this.sendLinkMail(params, MAIL_LINK_PATHS.EVALUATION_RESULT, {
      subject: '[GeniCheck] 평가 결과 안내',
      title: '평가 결과 안내',
      description: '평가 결과가 확정되었습니다. 결과를 확인하고 의견을 남길 수 있습니다.',
      buttonLabel: '평가 결과 확인하기',
    });
  }

  /** 인재 추천 게시 동의 요청 링크 */
  sendReferralConsentLink(params: LinkMailParams): Promise<boolean> {
    return this.sendLinkMail(params, MAIL_LINK_PATHS.REFERRAL_CONSENT, {
      subject: '[GeniCheck] 인재 추천 게시 동의 요청',
      title: '인재 추천 게시 동의 요청',
      description: '인재 추천 게시와 이력서 공개에 대한 동의 여부를 선택해주세요.',
      buttonLabel: '동의 내용 확인하기',
    });
  }

  private async sendLinkMail(
    params: LinkMailParams,
    path: string,
    content: MailContent,
  ): Promise<boolean> {
    const url = `${this.frontendUrl}${path}/${encodeURIComponent(params.token)}`;

    if (!this.transporter) {
      this.logger.log(`[SMTP 미설정] ${content.subject} → ${params.to}: ${url}`);
      return true;
    }

    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: params.to,
        subject: content.subject,
        html: this.buildHtml(params, content, url),
      });
      this.logger.log(`메일 발송 완료: ${content.subject} → ${params.to}`);
      return true;
    } catch (error) {
      // 메일 실패가 요청 실패나 데이터 롤백으로 이어지지 않도록 예외를 삼키고 false를 반환
      this.logger.error(`메일 발송 실패: ${content.subject} → ${params.to}`, error);
      return false;
    }
  }

  private buildHtml(params: LinkMailParams, content: MailContent, url: string): string {
    const greeting = params.employeeName
      ? `<p>${escapeHtml(params.employeeName)}님, 안녕하세요.</p>`
      : '<p>안녕하세요.</p>';
    const company = params.companyName
      ? `<p><strong>${escapeHtml(params.companyName)}</strong>에서 보낸 요청입니다.</p>`
      : '';
    const expiry = params.expiresAt
      ? `링크는 <strong>${formatKst(params.expiresAt)}</strong>까지 유효합니다.<br/>`
      : '';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #333;">${content.title}</h2>
        ${greeting}
        ${company}
        <p>${content.description}</p>
        <div style="margin: 24px 0;">
          <a href="${url}" style="
            display: inline-block;
            background: #4F46E5;
            color: #fff;
            padding: 12px 24px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: bold;
          ">${content.buttonLabel}</a>
        </div>
        <p style="color: #888; font-size: 13px;">
          ${expiry}
          이 링크는 1회만 사용할 수 있습니다. 본인이 요청받지 않은 메일이라면 무시해주세요.
        </p>
      </div>
    `;
  }
}

/** 메일 본문에 들어가는 사용자 입력(이름 등)의 HTML 삽입 방지 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatKst(date: Date): string {
  return date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}
