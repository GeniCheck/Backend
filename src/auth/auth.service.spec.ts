import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "./email/email.service";
import { RedisService } from "./redis/redis.service";

describe("AuthService (전하은 담당 14개 API 검증)", () => {
  let service: AuthService;
  let prismaMock: any;
  let jwtMock: any;
  let emailMock: any;
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
      $transaction: jest
        .fn()
        .mockImplementation((promises) => Promise.all(promises)),
    };

    jwtMock = {
      sign: jest.fn().mockReturnValue("mock-temp-token"),
      signAsync: jest.fn().mockResolvedValue("mock-jwt-token"),
      verify: jest.fn(),
    };

    emailMock = {
      sendVerificationEmail: jest.fn(),
      sendOtpEmail: jest.fn().mockResolvedValue(undefined),
      sendHrRegistrationEmail: jest.fn().mockResolvedValue(undefined),
      sendHrLoginEmail: jest.fn().mockResolvedValue(undefined),
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
              if (key === "JWT_ACCESS_SECRET") return "secret";
              if (key === "JWT_REFRESH_SECRET") return "refresh_secret";
              if (key === "JWT_ACCESS_EXPIRES_IN") return "1h";
              if (key === "JWT_REFRESH_EXPIRES_IN") return "7d";
              return "test";
            }),
          },
        },
        { provide: EmailService, useValue: emailMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it("1. requestCompanySignupOtp (회원가입 대표 OTP 요청·재요청) 정상 작동", async () => {
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: "otp-1" });

    const res = await service.requestCompanySignupOtp({
      email: "ceo@company.com",
      representativeName: "홍길동",
      businessNumber: "123-45-67890",
    });

    expect(res).toEqual({ message: "OTP가 발송되었습니다." });
    expect(prismaMock.otpVerification.create).toHaveBeenCalled();
  });

  it("2. verifyCompanySignupOtp (회원가입 대표 OTP 인증) 성공", async () => {
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: "otp-1",
      code: "123456",
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});

    const res = await service.verifyCompanySignupOtp({
      email: "ceo@company.com",
      otpCode: "123456",
    });

    expect(res).toEqual({
      isVerified: true,
      emailVerificationToken: "mock-temp-token",
    });
  });

  it("3. resendOtp (로그인 OTP 재발송) 정상 작동", async () => {
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: "otp-2" });

    jwtMock.verify.mockReturnValue({ sub: "comp-1", purpose: "otp_verify" });
    prismaMock.company.findUnique.mockResolvedValue({ email: "ceo@company.com" });

    const res = await service.resendOtp({
      tempToken: "mock-temp-token",
    });

    expect(res).toEqual({ message: "OTP가 재발송되었습니다." });
  });

  it("4. hrRegister (회사 대표 이메일로 HR 가입 OTP 발송) 정상 작동", async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
      phone: "010-1234-5678",
    });
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: "otp-hr-1" });

    const res = await service.hrRegister(
      { name: "홍길동", phone: "010-9999-8888" },
      "comp-1",
    );

    expect(res).toEqual({ tempToken: "mock-temp-token" });
    expect(prismaMock.otpVerification.updateMany).toHaveBeenCalledWith({
      where: { email: "ceo@company.com", isUsed: false },
      data: { isUsed: true },
    });
    expect(prismaMock.otpVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "ceo@company.com",
        code: expect.any(String),
      }),
    });
    expect(emailMock.sendHrRegistrationEmail).toHaveBeenCalledWith(
      "ceo@company.com",
      expect.any(String),
    );
  });

  it("5. hrRegister (회사 대표 이메일이 없으면 실패)", async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "",
      phone: "010-1234-5678",
    });

    await expect(
      service.hrRegister({ name: "홍길동", phone: "010-9999-8888" }, "comp-1"),
    ).rejects.toThrow("회사 대표 이메일이 등록되어 있지 않습니다.");
    expect(emailMock.sendHrRegistrationEmail).not.toHaveBeenCalled();
  });

  it("6. hrRegisterVerify (대표 이메일 OTP 검증 후 HR 생성) 정상 작동", async () => {
    jwtMock.verify.mockReturnValue({
      sub: "comp-1",
      purpose: "hr_register",
      hrPhone: "010-9999-8888",
      hrName: "홍길동",
    });
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
      phone: "010-1234-5678",
    });
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: "otp-hr-1",
      code: "123456",
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});
    prismaMock.hrManager.create.mockResolvedValue({
      id: "hr-1",
      name: "홍길동",
      phone: "010-9999-8888",
      companyId: "comp-1",
    });

    const res = await service.hrRegisterVerify({
      tempToken: "mock-temp-token",
      otpCode: "123456",
    });

    expect(res).toEqual({
      id: "hr-1",
      name: "홍길동",
      phone: "010-9999-8888",
      companyId: "comp-1",
    });
    expect(prismaMock.otpVerification.findFirst).toHaveBeenCalledWith({
      where: {
        email: "ceo@company.com",
        isUsed: false,
        expiresAt: { gt: expect.any(Date) },
      },
      orderBy: { createdAt: "desc" },
    });
    expect(prismaMock.otpVerification.update).toHaveBeenCalledWith({
      where: { id: "otp-hr-1" },
      data: { isUsed: true },
    });
  });

  it("7. hrLogin (회사 대표 이메일로 로그인 OTP 발송) 정상 작동", async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
    });
    prismaMock.hrManager.findUnique.mockResolvedValue({
      id: "hr-1",
      companyId: "comp-1",
    });
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: "otp-login-1" });

    const res = await service.hrLogin({
      phone: "010-9999-8888",
      companyCode: "COMP1234",
    });

    expect(res).toEqual({ tempToken: "mock-temp-token" });
    expect(emailMock.sendHrLoginEmail).toHaveBeenCalledWith(
      "ceo@company.com",
      expect.any(String),
    );
    expect(prismaMock.otpVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "ceo@company.com",
        code: expect.any(String),
      }),
    });
  });

  it("8. deleteHrManager (인사팀장 계정 삭제) 성공", async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue({
      id: "hr-1",
      companyId: "comp-1",
    });
    prismaMock.hrManager.delete.mockResolvedValue({});

    const res = await service.deleteHrManager("hr-1", "comp-1");

    expect(res).toEqual({ message: "인사팀장 계정이 삭제되었습니다." });
    expect(prismaMock.hrManager.delete).toHaveBeenCalledWith({
      where: { id: "hr-1" },
    });
  });

  it("9. deleteHrManager 타사 HR 삭제 시 UnauthorizedException 예외 발생", async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue({
      id: "hr-1",
      companyId: "comp-other",
    });

    await expect(service.deleteHrManager("hr-1", "comp-1")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("6. getMe (현재 로그인 사용자 조회) COMPANY 성공", async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "company@test.com",
      companyName: "제니체크",
      businessNumber: "1234567890",
      representativeName: "홍길동",
      phone: "01012345678",
      companyCode: "AB12CD34",
      isVerified: true,
      isPaid: true,
    });

    const res = await service.getMe({ sub: "comp-1", role: "COMPANY" });

    expect((res as any).companyName).toBe("제니체크");
    expect(res.role).toBe("COMPANY");
  });

  it("7. logout (로그아웃 - Access Token 블랙리스트 추가) 성공", async () => {
    prismaMock.company.update.mockResolvedValue({});

    await service.logout(
      { sub: "comp-1", role: "COMPANY" },
      "sample-access-token",
    );

    expect(redisMock.addToBlacklist).toHaveBeenCalledWith(
      "sample-access-token",
      3600,
    );
  });
});
