import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "./email/email.service";
import { RedisService } from "./redis/redis.service";

const uniqueConstraintError = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.22.0",
  });

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
      sendHrInviteEmail: jest.fn().mockResolvedValue(undefined),
      sendHrLoginEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
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

  it("4. hrInvite (대표 로그인 상태에서 HR 본인 이메일로 초대 메일 발송) 정상 작동", async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue(null);
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
      companyName: "지니체크",
    });

    const res = await service.hrInvite(
      { name: "홍길동", email: "hr@company.com" },
      "comp-1",
    );

    expect(res).toEqual({ message: "초대 메일이 발송되었습니다." });
    expect(emailMock.sendHrInviteEmail).toHaveBeenCalledWith(
      "hr@company.com",
      "mock-temp-token",
      "지니체크",
    );
  });

  it("5. hrInvite (이미 등록된 HR 이메일이면 실패)", async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue({ id: "hr-existing" });

    await expect(
      service.hrInvite(
        { name: "홍길동", email: "hr@company.com" },
        "comp-1",
      ),
    ).rejects.toThrow("이미 등록된 이메일입니다.");
    expect(emailMock.sendHrInviteEmail).not.toHaveBeenCalled();
  });

  it("6. hrAcceptInvite (초대 토큰 검증 후 HR 본인이 설정한 비밀번호로 계정 생성) 정상 작동", async () => {
    jwtMock.verify.mockReturnValue({
      sub: "comp-1",
      purpose: "hr_invite",
      hrEmail: "hr@company.com",
      hrName: "홍길동",
    });
    prismaMock.hrManager.findUnique.mockResolvedValue(null);
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
    });
    prismaMock.hrManager.create.mockResolvedValue({
      id: "hr-1",
      name: "홍길동",
      email: "hr@company.com",
      companyId: "comp-1",
    });

    const res = await service.hrAcceptInvite({
      token: "invite-token",
      password: "Pass1!",
    });

    expect(res).toEqual({
      id: "hr-1",
      name: "홍길동",
      email: "hr@company.com",
      companyId: "comp-1",
    });
    expect(prismaMock.hrManager.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "hr@company.com",
        name: "홍길동",
        companyId: "comp-1",
      }),
    });
  });

  it("6-1. hrAcceptInvite (이미 가입 완료된 이메일이면 실패)", async () => {
    jwtMock.verify.mockReturnValue({
      sub: "comp-1",
      purpose: "hr_invite",
      hrEmail: "hr@company.com",
      hrName: "홍길동",
    });
    prismaMock.hrManager.findUnique.mockResolvedValue({ id: "hr-existing" });

    await expect(
      service.hrAcceptInvite({ token: "invite-token", password: "Pass1!" }),
    ).rejects.toThrow("이미 가입이 완료된 이메일입니다.");
    expect(prismaMock.hrManager.create).not.toHaveBeenCalled();
  });

  it("hrAcceptInvite: 동시 요청 경합으로 create가 unique 위반이면 409로 처리", async () => {
    jwtMock.verify.mockReturnValue({
      sub: "comp-1",
      purpose: "hr_invite",
      hrEmail: "hr@company.com",
      hrName: "홍길동",
    });
    prismaMock.hrManager.findUnique.mockResolvedValue(null);
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
    });
    prismaMock.hrManager.create.mockRejectedValue(uniqueConstraintError());

    await expect(
      service.hrAcceptInvite({ token: "invite-token", password: "Pass1!" }),
    ).rejects.toThrow("이미 가입이 완료된 이메일입니다.");
  });

  it("7. hrLogin (회사 대표 이메일로 로그인 OTP 발송) 정상 작동", async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
    });
    prismaMock.hrManager.findUnique.mockResolvedValue({
      id: "hr-1",
      email: "hr@company.com",
      password: "hashed-password",
      companyId: "comp-1",
      company: { email: "ceo@company.com" },
    });
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: "otp-login-1" });

    jest.spyOn(require("bcrypt"), "compare").mockResolvedValue(true);
    const res = await service.hrLogin({
      email: "hr@company.com",
      password: "Pass1!",
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

  // ===========================
  // 지원자
  // ===========================
  it("applicantSignup: 가입 성공 + 이메일 소문자 정규화", async () => {
    prismaMock.applicant.findUnique.mockResolvedValue(null);
    prismaMock.applicant.create.mockResolvedValue({
      id: "app-1",
      email: "user@test.com",
      isEmailVerified: false,
    });

    const res = await service.applicantSignup({
      email: "User@Test.com",
      password: "Pass1!",
      name: "김철수",
    } as any);

    expect(res.email).toBe("user@test.com");
    expect(prismaMock.applicant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "user@test.com" }),
    });
    expect(emailMock.sendVerificationEmail).toHaveBeenCalledWith(
      "user@test.com",
      expect.any(String),
    );
  });

  it("applicantSignup: 이미 등록된 이메일이면 실패", async () => {
    prismaMock.applicant.findUnique.mockResolvedValue({ id: "app-existing" });

    await expect(
      service.applicantSignup({
        email: "user@test.com",
        password: "Pass1!",
        name: "김철수",
      } as any),
    ).rejects.toThrow("이미 등록된 이메일입니다.");
  });

  it("applicantSignup: 동시 요청 경합(findUnique는 통과했지만 create가 unique 위반)도 409로 처리", async () => {
    prismaMock.applicant.findUnique.mockResolvedValue(null);
    prismaMock.applicant.create.mockRejectedValue(uniqueConstraintError());

    await expect(
      service.applicantSignup({
        email: "user@test.com",
        password: "Pass1!",
        name: "김철수",
      } as any),
    ).rejects.toThrow("이미 등록된 이메일입니다.");
  });

  it("verifyEmail: 인증 코드 확인 성공", async () => {
    prismaMock.emailVerification.findFirst.mockResolvedValue({
      id: "ev-1",
      email: "user@test.com",
      code: "111111",
      isUsed: false,
    });
    prismaMock.applicant.update.mockResolvedValue({});

    const res = await service.verifyEmail({
      email: "user@test.com",
      code: "111111",
    } as any);

    expect(res).toEqual({ isEmailVerified: true });
  });

  it("verifyEmail: 코드 불일치/만료 시 실패", async () => {
    prismaMock.emailVerification.findFirst.mockResolvedValue(null);

    await expect(
      service.verifyEmail({ email: "user@test.com", code: "000000" } as any),
    ).rejects.toThrow("인증 코드가 올바르지 않거나 만료되었습니다.");
  });

  it("applicantLogin: 로그인 성공 (대소문자 다른 이메일도 동일 계정으로 조회)", async () => {
    prismaMock.applicant.findUnique.mockResolvedValue({
      id: "app-1",
      email: "user@test.com",
      password: "hashed",
      isEmailVerified: true,
    });
    prismaMock.applicant.update.mockResolvedValue({});
    jest.spyOn(require("bcrypt"), "compare").mockResolvedValue(true);

    const res = await service.applicantLogin({
      email: "User@Test.com",
      password: "Pass1!",
    } as any);

    expect(res.accessToken).toBe("mock-jwt-token");
    expect(prismaMock.applicant.findUnique).toHaveBeenCalledWith({
      where: { email: "user@test.com" },
    });
  });

  it("applicantLogin: 이메일 미인증 상태면 실패", async () => {
    prismaMock.applicant.findUnique.mockResolvedValue({
      id: "app-1",
      email: "user@test.com",
      password: "hashed",
      isEmailVerified: false,
    });

    await expect(
      service.applicantLogin({
        email: "user@test.com",
        password: "Pass1!",
      } as any),
    ).rejects.toThrow("가입 이메일 인증을 먼저 완료해주세요.");
  });

  // ===========================
  // 기업대표
  // ===========================
  it("verifyCompanyBusiness: 사업자 정보 인증 성공 (테스트 환경 NTS 스킵)", async () => {
    prismaMock.company.findUnique.mockResolvedValue(null);

    const res = await service.verifyCompanyBusiness({
      businessNumber: "123-45-67890",
      representativeName: "홍길동",
      startDate: "20200101",
    } as any);

    expect(res).toEqual({
      isVerified: true,
      businessVerificationToken: "mock-temp-token",
    });
  });

  it("verifyCompanyBusiness: 이미 등록된 사업자등록번호면 실패", async () => {
    prismaMock.company.findUnique.mockResolvedValue({ id: "comp-existing" });

    await expect(
      service.verifyCompanyBusiness({
        businessNumber: "123-45-67890",
        representativeName: "홍길동",
        startDate: "20200101",
      } as any),
    ).rejects.toThrow("이미 등록된 사업자등록번호입니다.");
  });

  it("companySignup: 사업자 인증 + 이메일 인증 토큰 검증 후 가입 성공 + 이메일 정규화", async () => {
    jwtMock.verify
      .mockReturnValueOnce({
        purpose: "company_business",
        businessNumber: "1234567890",
        representativeName: "홍길동",
        startDate: "20200101",
      })
      .mockReturnValueOnce({
        purpose: "company_signup",
        email: "ceo@company.com",
      });
    prismaMock.company.findUnique
      .mockResolvedValueOnce(null) // existingEmail
      .mockResolvedValueOnce(null) // existingBiz
      .mockResolvedValueOnce(null); // companyCode 중복 확인
    prismaMock.company.create.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
      companyName: "지니체크",
      companyCode: "AB12CD34",
    });

    const res = await service.companySignup({
      email: "CEO@Company.com",
      password: "Pass1!",
      companyName: "지니체크",
      businessNumber: "123-45-67890",
      representativeName: "홍길동",
      startDate: "20200101",
      emailVerificationToken: "mock-temp-token",
      businessVerificationToken: "mock-temp-token",
    } as any);

    expect(res.email).toBe("ceo@company.com");
    expect(prismaMock.company.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: "ceo@company.com" }),
    });
  });

  it("companySignup: 동시 요청 경합으로 create가 unique 위반이면 409로 처리", async () => {
    jwtMock.verify
      .mockReturnValueOnce({
        purpose: "company_business",
        businessNumber: "1234567890",
        representativeName: "홍길동",
        startDate: "20200101",
      })
      .mockReturnValueOnce({
        purpose: "company_signup",
        email: "ceo@company.com",
      });
    prismaMock.company.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prismaMock.company.create.mockRejectedValue(uniqueConstraintError());

    await expect(
      service.companySignup({
        email: "ceo@company.com",
        password: "Pass1!",
        companyName: "지니체크",
        businessNumber: "123-45-67890",
        representativeName: "홍길동",
        startDate: "20200101",
        emailVerificationToken: "mock-temp-token",
        businessVerificationToken: "mock-temp-token",
      } as any),
    ).rejects.toThrow("이미 등록된 이메일 또는 사업자등록번호입니다.");
  });

  it("companyLoginStep1: 정상 로그인 시 본인 이메일로 OTP 발송 (purpose 분리)", async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
      password: "hashed",
    });
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: "otp-x" });
    jest.spyOn(require("bcrypt"), "compare").mockResolvedValue(true);

    const res = await service.companyLoginStep1({
      email: "CEO@Company.com",
      password: "Pass1!",
    } as any);

    expect(res).toEqual({ tempToken: "mock-temp-token" });
    expect(prismaMock.otpVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "ceo@company.com",
        purpose: "ceo_login",
      }),
    });
    expect(emailMock.sendOtpEmail).toHaveBeenCalledWith(
      "ceo@company.com",
      expect.any(String),
    );
  });

  it("companyLoginStep1: 비밀번호 틀리면 실패", async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
      password: "hashed",
    });
    jest.spyOn(require("bcrypt"), "compare").mockResolvedValue(false);

    await expect(
      service.companyLoginStep1({
        email: "ceo@company.com",
        password: "wrong",
      } as any),
    ).rejects.toThrow("이메일 또는 비밀번호가 올바르지 않습니다.");
  });

  it("companyOtpVerify: 대표 로그인 OTP는 ceo_login purpose로만 조회", async () => {
    jwtMock.verify.mockReturnValue({ sub: "comp-1", purpose: "otp_verify" });
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
    });
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: "otp-1",
      code: "123456",
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});
    prismaMock.company.update.mockResolvedValue({});

    const res = await service.companyOtpVerify({
      tempToken: "mock-temp-token",
      otpCode: "123456",
    } as any);

    expect(res.accessToken).toBe("mock-jwt-token");
    expect(prismaMock.otpVerification.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        email: "ceo@company.com",
        purpose: "ceo_login",
      }),
      orderBy: { createdAt: "desc" },
    });
  });

  it("companyOtpVerify: 코드 불일치 시 실패 + 남은 시도 횟수 안내", async () => {
    jwtMock.verify.mockReturnValue({ sub: "comp-1", purpose: "otp_verify" });
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
    });
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: "otp-1",
      code: "123456",
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});

    await expect(
      service.companyOtpVerify({
        tempToken: "mock-temp-token",
        otpCode: "000000",
      } as any),
    ).rejects.toThrow(/남은 시도 횟수: 4회/);
  });

  // ===========================
  // 인사팀장 로그인 Step2
  // ===========================
  it("hrOtpVerify: 대표(회사) 이메일 기준 hr_login purpose로 조회 후 토큰 발급", async () => {
    jwtMock.verify.mockReturnValue({ sub: "hr-1", purpose: "hr_otp_verify" });
    prismaMock.hrManager.findUnique.mockResolvedValue({
      id: "hr-1",
      company: { email: "ceo@company.com" },
    });
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: "otp-2",
      code: "654321",
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});
    prismaMock.hrManager.update.mockResolvedValue({});

    const res = await service.hrOtpVerify({
      tempToken: "mock-temp-token",
      otpCode: "654321",
    } as any);

    expect(res.accessToken).toBe("mock-jwt-token");
    expect(prismaMock.otpVerification.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        email: "ceo@company.com",
        purpose: "hr_login",
      }),
      orderBy: { createdAt: "desc" },
    });
  });

  // ===========================
  // 토큰 갱신
  // ===========================
  it("refreshToken: 유효한 refresh token으로 재발급(rotation)", async () => {
    jwtMock.verify.mockReturnValue({ sub: "comp-1", role: "COMPANY" });
    prismaMock.company.findUnique.mockResolvedValue({ refreshToken: "stored-hash" });
    prismaMock.company.update.mockResolvedValue({});
    jest.spyOn(require("bcrypt"), "compare").mockResolvedValue(true);

    const res = await service.refreshToken({
      refreshToken: "old-refresh-token",
    } as any);

    expect(res.accessToken).toBe("mock-jwt-token");
    expect(prismaMock.company.update).toHaveBeenCalled();
  });

  it("refreshToken: 저장된 토큰과 불일치하면 실패", async () => {
    jwtMock.verify.mockReturnValue({ sub: "comp-1", role: "COMPANY" });
    prismaMock.company.findUnique.mockResolvedValue({ refreshToken: "stored-hash" });
    jest.spyOn(require("bcrypt"), "compare").mockResolvedValue(false);

    await expect(
      service.refreshToken({ refreshToken: "bad-token" } as any),
    ).rejects.toThrow("유효하지 않은 Refresh Token입니다.");
  });

  // ===========================
  // 비밀번호 재설정
  // ===========================
  it("passwordResetRequest: 존재하는 대표 계정이면 본인 이메일로 코드 발송", async () => {
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
    });
    prismaMock.otpVerification.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.otpVerification.create.mockResolvedValue({ id: "otp-pr-1" });

    const res = await service.passwordResetRequest({
      email: "CEO@Company.com",
      role: "COMPANY",
    } as any);

    expect(res).toEqual({
      message: "등록된 이메일이면 비밀번호 재설정 코드가 발송되었습니다.",
    });
    expect(emailMock.sendPasswordResetEmail).toHaveBeenCalledWith(
      "ceo@company.com",
      expect.any(String),
    );
    expect(prismaMock.otpVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: "ceo@company.com",
        purpose: "password_reset_company",
      }),
    });
  });

  it("passwordResetRequest: 존재하지 않는 계정이면 메일 발송 없이 동일 응답 (계정 열거 방지)", async () => {
    prismaMock.company.findUnique.mockResolvedValue(null);

    const res = await service.passwordResetRequest({
      email: "nobody@company.com",
      role: "COMPANY",
    } as any);

    expect(res).toEqual({
      message: "등록된 이메일이면 비밀번호 재설정 코드가 발송되었습니다.",
    });
    expect(emailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(prismaMock.otpVerification.create).not.toHaveBeenCalled();
  });

  it("passwordResetConfirm: 대표 비밀번호 재설정 성공 + 기존 세션 로그아웃(refreshToken 초기화)", async () => {
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: "otp-1",
      code: "222222",
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});
    prismaMock.company.findUnique.mockResolvedValue({
      id: "comp-1",
      email: "ceo@company.com",
    });
    prismaMock.company.update.mockResolvedValue({});

    const res = await service.passwordResetConfirm({
      email: "ceo@company.com",
      role: "COMPANY",
      code: "222222",
      newPassword: "NewPass1!",
    } as any);

    expect(res).toEqual({
      message: "비밀번호가 재설정되었습니다. 다시 로그인해주세요.",
    });
    expect(prismaMock.company.update).toHaveBeenCalledWith({
      where: { email: "ceo@company.com" },
      data: expect.objectContaining({ refreshToken: null }),
    });
  });

  it("passwordResetConfirm: 코드 불일치 시 실패", async () => {
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: "otp-1",
      code: "222222",
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});

    await expect(
      service.passwordResetConfirm({
        email: "ceo@company.com",
        role: "COMPANY",
        code: "000000",
        newPassword: "NewPass1!",
      } as any),
    ).rejects.toThrow(/재설정 코드가 올바르지 않습니다/);
  });

  it("passwordResetConfirm: HR 계정은 password_reset_hr purpose로 조회 후 재설정", async () => {
    prismaMock.otpVerification.findFirst.mockResolvedValue({
      id: "otp-2",
      code: "333333",
      failCount: 0,
      isUsed: false,
    });
    prismaMock.otpVerification.update.mockResolvedValue({});
    prismaMock.hrManager.findUnique.mockResolvedValue({
      id: "hr-1",
      email: "hr@company.com",
    });
    prismaMock.hrManager.update.mockResolvedValue({});

    const res = await service.passwordResetConfirm({
      email: "hr@company.com",
      role: "HR_MANAGER",
      code: "333333",
      newPassword: "NewPass1!",
    } as any);

    expect(res).toEqual({
      message: "비밀번호가 재설정되었습니다. 다시 로그인해주세요.",
    });
    expect(prismaMock.otpVerification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ purpose: "password_reset_hr" }),
      }),
    );
  });
});
