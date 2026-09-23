import { Test, TestingModule } from '@nestjs/testing';
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
      hrRegister: jest.fn(),
      hrRegisterVerify: jest.fn(),
      hrLogin: jest.fn(),
      hrOtpVerify: jest.fn(),
      resendOtp: jest.fn(),
      refreshToken: jest.fn(),
      deleteHrManager: jest.fn(),
      getMe: jest.fn(),
      logout: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authServiceMock }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('uses email for company signup verification', async () => {
    const dto = { email: 'ceo@company.com' };
    await controller.requestCompanySignupOtp(dto);
    expect(authServiceMock.requestCompanySignupOtp).toHaveBeenCalledWith(dto);
  });

  it('uses the authenticated company for HR registration', async () => {
    const dto = {
      name: '홍길동',
      email: 'hr@company.com',
      password: 'Pass1!',
    };
    const req = { user: { sub: 'company-1', role: 'COMPANY' } } as any;
    await controller.hrRegister(dto, req);
    expect(authServiceMock.hrRegister).toHaveBeenCalledWith(dto, 'company-1');
  });
});
