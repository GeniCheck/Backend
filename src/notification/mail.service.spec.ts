import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

function configOf(values: Record<string, string | undefined>): ConfigService {
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

describe('MailService', () => {
  const sendMail = jest.fn();
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('SMTP 미설정 (SMTP_USER 비어 있음)', () => {
    it('실제 발송 없이 링크를 로그로 출력하고 true를 반환한다', async () => {
      const service = new MailService(configOf({ SMTP_USER: '', FRONTEND_URL: '' }));

      await expect(
        service.sendDeclarationLink({ to: 'emp@test.com', token: 'tok123' }),
      ).resolves.toBe(true);

      expect(nodemailer.createTransport).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:5180/verification/self-declare/tok123'),
      );
    });

    it('4종 메일 모두 예외 없이 동작한다', async () => {
      const service = new MailService(configOf({}));
      const params = { to: 'emp@test.com', token: 'tok' };

      await expect(service.sendDeclarationLink(params)).resolves.toBe(true);
      await expect(service.sendSelfEvaluationLink(params)).resolves.toBe(true);
      await expect(service.sendEvaluationResult(params)).resolves.toBe(true);
      await expect(service.sendReferralConsentLink(params)).resolves.toBe(true);
    });
  });

  describe('SMTP 설정됨', () => {
    const smtpConfig = {
      SMTP_USER: 'mailer@test.com',
      SMTP_PASS: 'pw',
      SMTP_HOST: 'smtp.test.com',
      SMTP_PORT: '587',
      FRONTEND_URL: 'https://genicheck.vercel.app/',
    };

    it.each([
      ['sendDeclarationLink', '/verification/self-declare/tok'],
      ['sendSelfEvaluationLink', '/evaluation/self/tok'],
      ['sendEvaluationResult', '/evaluation/result/tok'],
      ['sendReferralConsentLink', '/referral/consent/tok'],
    ] as const)('%s는 %s 링크로 발송하고 true를 반환한다', async (method, path) => {
      sendMail.mockResolvedValue({});
      const service = new MailService(configOf(smtpConfig));

      await expect(service[method]({ to: 'emp@test.com', token: 'tok' })).resolves.toBe(true);

      expect(sendMail).toHaveBeenCalledTimes(1);
      const mail = sendMail.mock.calls[0][0];
      expect(mail.to).toBe('emp@test.com');
      // FRONTEND_URL 끝의 슬래시는 제거된다
      expect(mail.html).toContain(`https://genicheck.vercel.app${path}`);
    });

    it('발송 실패 시 예외를 던지지 않고 false를 반환한다', async () => {
      sendMail.mockRejectedValue(new Error('SMTP down'));
      const service = new MailService(configOf(smtpConfig));

      await expect(
        service.sendSelfEvaluationLink({ to: 'emp@test.com', token: 'tok' }),
      ).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('직원·기업 이름은 HTML 이스케이프해서 넣는다', async () => {
      sendMail.mockResolvedValue({});
      const service = new MailService(configOf(smtpConfig));

      await service.sendDeclarationLink({
        to: 'emp@test.com',
        token: 'tok',
        employeeName: '<script>alert(1)</script>',
        companyName: 'A&B',
      });

      const html: string = sendMail.mock.calls[0][0].html;
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('A&amp;B');
    });
  });
});
