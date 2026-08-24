import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email/email.service';
import { SmsService } from './sms/sms.service';
import { RedisService } from './redis/redis.service';

describe('AuthService (전하은 담당 14개 API 검증)', () => {
  let service: AuthService;
  let prismaMock: any;
  let jwtMock: any;
  let smsMock: any;
  let redisMock: any;

  beforeEach(async () => {
    prismaMock = {
      applicant: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      company: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      hrManager: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
      otpVerification: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
      },
      emailVerification: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation((promises) => Promise.all(promises)),
    };

    jwtMock = {
      sign: jest.fn().mockReturnValue('mock-temp-token'),
      signAsync: jest.fn().mockResolvedValue('mock-jwt-token'),
      verify: jest.fn(),
    };

    smsMock = {
      sendOtp: jest.fn().mockResolvedValue(true),
    };

    redisMock = {
      addToBlacklist: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_ACCESS_SECRET') return 'secret';
              if (key === 'JWT_REFRESH_SECRET') return 'refresh_secret';
              if (key === 'JWT_ACCESS_EXPIRES_IN') return '1h';
              if (key === 'JWT_REFRESH_EXPIRES_IN') return '7d';
              return 'test';
            }),
          },
        },
        { provide: EmailService, useValue: { sendVerificationEmail: jest.fn() } },
        { provide: SmsService, useValue: smsMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('1. requestCompanySignupOtp (회원가입 대표 OTP 요청·재요청) 정상 작동', async () => {
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: 'otp-1' });

    const res = await service.requestCompanySignupOtp({
      phone: '010-1234-5678',
      representativeName: '홍길동',
      businessNumber: '123-45-67890',
    });

    expect(res).toEqual({ message: 'OTP가 발송되었습니다.' });
    expect(prismaMock.otpVerification.create).toHaveBeenCalled();
  });

  it('2. verifyCompanySignupOtp (회원가입 대표 OTP 인증) 성공', async () => {
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: 'otp-1',
      code: '123456',
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});

    const res = await service.verifyCompanySignupOtp({
      phone: '010-1234-5678',
      otpCode: '123456',
    });

    expect(res).toEqual({
      isVerified: true,
      phoneVerificationToken: 'mock-temp-token',
    });
  });

  it('3. resendOtp (로그인 OTP 재발송) 정상 작동', async () => {
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: 'otp-2' });

    jwtMock.verify.mockReturnValue({ sub: 'comp-1', purpose: 'otp_verify' });
    prismaMock.company.findUnique.mockResolvedValue({ phone: '010-1234-5678' });

    const res = await service.resendOtp({
      tempToken: 'mock-temp-token',
    });

    expect(res).toEqual({ message: 'OTP가 재발송되었습니다.' });
  });

  it('4. deleteHrManager (인사팀장 계정 삭제) 성공', async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue({
      id: 'hr-1',
      companyId: 'comp-1',
    });
    prismaMock.hrManager.delete.mockResolvedValue({});

    const res = await service.deleteHrManager('hr-1', 'comp-1');

    expect(res).toEqual({ message: '인사팀장 계정이 삭제되었습니다.' });
    expect(prismaMock.hrManager.delete).toHaveBeenCalledWith({ where: { id: 'hr-1' } });
  });

  it('5. deleteHrManager 타사 HR 삭제 시 UnauthorizedException 예외 발생', async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue({
      id: 'hr-1',
      companyId: 'comp-other',
    });

    await expect(service.deleteHrManager('hr-1', 'comp-1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('6. getMe (현재 로그인 사용자 조회) COMPANY 성공', async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: 'comp-1',
      email: 'company@test.com',
      companyName: '제니체크',
      businessNumber: '1234567890',
      representativeName: '홍길동',
      phone: '01012345678',
      companyCode: 'AB12CD34',
      isVerified: true,
      isPaid: true,
    });

    const res = await service.getMe({ sub: 'comp-1', role: 'COMPANY' });

    expect((res as any).companyName).toBe('제니체크');
    expect(res.role).toBe('COMPANY');
  });

  it('7. logout (로그아웃 - Access Token 블랙리스트 추가) 성공', async () => {
    prismaMock.company.update.mockResolvedValue({});

    await service.logout(
      { sub: 'comp-1', role: 'COMPANY' },
      'sample-access-token',
    );

    expect(redisMock.addToBlacklist).toHaveBeenCalledWith('sample-access-token', 3600);
  });
});
