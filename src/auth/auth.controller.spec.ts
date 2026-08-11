import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController (전하은 담당 API 매핑 검증)', () => {
  let controller: AuthController;
  let authServiceMock: any;

  beforeEach(async () => {
    authServiceMock = {
      applicantSignup: jest.fn(),
      verifyEmail: jest.fn(),
      applicantLogin: jest.fn(),
      companySignup: jest.fn(),
      companyLoginStep1: jest.fn(),
      companyOtpVerify: jest.fn(),
      requestCompanySignupOtp: jest.fn().mockResolvedValue({ message: 'OTP가 발송되었습니다.' }),
      verifyCompanySignupOtp: jest.fn().mockResolvedValue({
        isVerified: true,
        phoneVerificationToken: 'mock-phone-verification-token',
      }),
      hrRegister: jest.fn(),
      hrRegisterVerify: jest.fn(),
      hrLogin: jest.fn(),
      hrOtpVerify: jest.fn(),
      resendOtp: jest.fn().mockResolvedValue({ message: 'OTP가 재발송되었습니다.' }),
      refreshToken: jest.fn(),
      deleteHrManager: jest.fn().mockResolvedValue({ message: '인사팀장 계정이 삭제되었습니다.' }),
      getMe: jest.fn().mockResolvedValue({ id: 'user-1', role: 'COMPANY' }),
      logout: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('POST /auth/company/signup/otp/request 호출', async () => {
    const dto = { phone: '010-1234-5678', representativeName: '홍길동', businessNumber: '123-45-67890' };
    const res = await controller.requestCompanySignupOtp(dto);
    expect(res).toEqual({ message: 'OTP가 발송되었습니다.' });
    expect(authServiceMock.requestCompanySignupOtp).toHaveBeenCalledWith(dto);
  });

  it('POST /auth/company/signup/otp/verify 호출', async () => {
    const dto = { phone: '010-1234-5678', otpCode: '123456' };
    const res = await controller.verifyCompanySignupOtp(dto);
    expect(res).toEqual({
      isVerified: true,
      phoneVerificationToken: 'mock-phone-verification-token',
    });
    expect(authServiceMock.verifyCompanySignupOtp).toHaveBeenCalledWith(dto);
  });

  it('POST /auth/otp/resend 호출', async () => {
    const dto = { tempToken: 'mock-temp-token' };
    const res = await controller.resendOtp(dto);
    expect(res).toEqual({ message: 'OTP가 재발송되었습니다.' });
    expect(authServiceMock.resendOtp).toHaveBeenCalledWith(dto);
  });

  it('DELETE /auth/hr/:hrUserId 호출', async () => {
    const req = { user: { sub: 'comp-1', role: 'COMPANY' } } as any;
    const res = await controller.deleteHrManager('hr-123', req);
    expect(res).toEqual({ message: '인사팀장 계정이 삭제되었습니다.' });
    expect(authServiceMock.deleteHrManager).toHaveBeenCalledWith('hr-123', 'comp-1');
  });

  it('GET /auth/me 호출', async () => {
    const req = { user: { sub: 'user-1', role: 'COMPANY' } } as any;
    const res = await controller.getMe(req);
    expect(res).toEqual({ id: 'user-1', role: 'COMPANY' });
    expect(authServiceMock.getMe).toHaveBeenCalledWith(req.user);
  });

  it('DELETE/POST /auth/logout 호출', async () => {
    const req = {
      user: { sub: 'user-1', role: 'COMPANY' },
      headers: { authorization: 'Bearer test-token' },
    } as any;
    await controller.logout(req);
    expect(authServiceMock.logout).toHaveBeenCalledWith(req.user, 'test-token');
  });
});
