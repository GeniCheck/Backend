import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authServiceMock: any;

  beforeEach(async () => {
    authServiceMock = {
      applicantSignup: jest.fn(),
      verifyEmail: jest.fn(),
      applicantLogin: jest.fn(),
      companySignup: jest.fn(),
      verifyCompanyBusiness: jest.fn(),
      companyLoginStep1: jest.fn(),
      companyOtpVerify: jest.fn(),
      requestCompanySignupOtp: jest.fn(),
      verifyCompanySignupOtp: jest.fn(),
      hrInvite: jest.fn(),
      hrAcceptInvite: jest.fn(),
      hrLogin: jest.fn(),
      hrOtpVerify: jest.fn(),
      resendOtp: jest.fn(),
      passwordResetRequest: jest.fn(),
      passwordResetConfirm: jest.fn(),
      refreshToken: jest.fn(),
      deleteHrManager: jest.fn(),
      getMe: jest.fn(),
      logout: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    })
      // 컨트롤러 단위 테스트라 실제 rate limit 저장소가 필요 없음 — 항상 통과시킴
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('uses email for company signup verification', async () => {
    const dto = { email: 'ceo@company.com' };
    await controller.requestCompanySignupOtp(dto);
    expect(authServiceMock.requestCompanySignupOtp).toHaveBeenCalledWith(dto);
  });

  it('uses the authenticated company for HR invite', async () => {
    const dto = { name: '홍길동', email: 'hr@company.com' };
    const req = { user: { sub: 'company-1', role: 'COMPANY' } } as any;
    await controller.hrInvite(dto, req);
    expect(authServiceMock.hrInvite).toHaveBeenCalledWith(dto, 'company-1');
  });

  it('rejects HR invite from a non-COMPANY caller', async () => {
    const dto = { name: '홍길동', email: 'hr@company.com' };
    const req = { user: { sub: 'applicant-1', role: 'APPLICANT' } } as any;
    await expect(controller.hrInvite(dto, req)).rejects.toThrow(
      '대표만 인사팀장을 초대할 수 있습니다.',
    );
    expect(authServiceMock.hrInvite).not.toHaveBeenCalled();
  });

  it('passes accept-invite payload straight through (no auth required)', async () => {
    const dto = { token: 'invite-token', password: 'Pass1!' };
    await controller.hrAcceptInvite(dto);
    expect(authServiceMock.hrAcceptInvite).toHaveBeenCalledWith(dto);
  });
});
