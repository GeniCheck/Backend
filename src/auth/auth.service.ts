import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes, randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  ApplicantSignupDto,
  ApplicantLoginDto,
  CompanySignupDto,
  CompanyLoginDto,
  CompanyOtpVerifyDto,
  CompanySignupOtpRequestDto,
  CompanySignupOtpVerifyDto,
  CompanyBusinessVerifyDto,
  HrLoginDto,
  HrInviteDto,
  HrAcceptInviteDto,
  HrOtpVerifyDto,
  RefreshTokenDto,
  VerifyEmailDto,
  ResendOtpDto,
  PasswordResetRequestDto,
  PasswordResetConfirmDto,
  PasswordResetRole,
} from "./dto";
import { JwtPayload } from "./strategies/jwt.strategy";
import { EmailService } from "./email/email.service";
import { RedisService } from "./redis/redis.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly redisService: RedisService,
  ) {}

  // ===========================
  // 지원자 회원가입
  // ===========================
  async applicantSignup(dto: ApplicantSignupDto) {
    const email = this.normalizeEmail(dto.email);

    const existing = await this.prisma.applicant.findUnique({
      where: { email },
    });
    if (existing) {
      throw new ConflictException("이미 등록된 이메일입니다.");
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    let applicant;
    try {
      applicant = await this.prisma.applicant.create({
        data: {
          email,
          password: hashedPassword,
          name: dto.name,
        },
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictException("이미 등록된 이메일입니다.");
      }
      throw err;
    }

    // 이메일 인증 코드 생성 및 저장
    const code = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10분

    await this.prisma.emailVerification.create({
      data: { email, code, expiresAt },
    });

    // 인증 이메일 발송 (실패해도 회원가입은 완료)
    try {
      await this.emailService.sendVerificationEmail(email, code);
    } catch {
      // 이메일 발송 실패 시 로그는 EmailService 내부에서 처리
    }

    return {
      id: applicant.id,
      email: applicant.email,
      isEmailVerified: applicant.isEmailVerified,
    };
  }

  // ===========================
  // 이메일 인증 코드 확인
  // ===========================
  async verifyEmail(dto: VerifyEmailDto) {
    const email = this.normalizeEmail(dto.email);

    const record = await this.prisma.emailVerification.findFirst({
      where: {
        email,
        code: dto.code,
        isUsed: false,
        expiresAt: { gt: new Date() }, // 만료된 코드 DB 레벨에서 제외
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      throw new BadRequestException(
        "인증 코드가 올바르지 않거나 만료되었습니다.",
      );
    }

    // 코드 사용 처리 + 지원자 인증 완료 처리 (트랜잭션)
    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { isUsed: true },
      }),
      this.prisma.applicant.update({
        where: { email },
        data: { isEmailVerified: true },
      }),
    ]);

    return { isEmailVerified: true };
  }

  // ===========================
  // 지원자 로그인
  // ===========================
  async applicantLogin(dto: ApplicantLoginDto) {
    const applicant = await this.prisma.applicant.findUnique({
      where: { email: this.normalizeEmail(dto.email) },
    });
    if (!applicant) {
      throw new UnauthorizedException(
        "이메일 또는 비밀번호가 올바르지 않습니다.",
      );
    }

    if (!applicant.isEmailVerified) {
      throw new UnauthorizedException("가입 이메일 인증을 먼저 완료해주세요.");
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      applicant.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException(
        "이메일 또는 비밀번호가 올바르지 않습니다.",
      );
    }

    const tokens = await this.generateTokens({
      sub: applicant.id,
      role: "APPLICANT",
    });

    await this.updateRefreshToken(
      "APPLICANT",
      applicant.id,
      tokens.refreshToken,
    );

    return tokens;
  }

  // ===========================
  // 기업 회원가입
  // ===========================
  async verifyCompanyBusiness(dto: CompanyBusinessVerifyDto) {
    const normalizedBizNumber = dto.businessNumber.replace(/-/g, "");
    const existingBiz = await this.prisma.company.findUnique({
      where: { businessNumber: normalizedBizNumber },
    });
    if (existingBiz) {
      throw new ConflictException("이미 등록된 사업자등록번호입니다.");
    }

    await this.validateBusinessRegistration(
      normalizedBizNumber,
      dto.representativeName,
      dto.startDate,
    );

    const businessVerificationToken = this.jwtService.sign(
      {
        purpose: "company_business",
        businessNumber: normalizedBizNumber,
        representativeName: dto.representativeName,
        startDate: dto.startDate,
      },
      {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
        expiresIn: "10m",
      },
    );

    return { isVerified: true, businessVerificationToken };
  }

  async companySignup(dto: CompanySignupDto) {
    const email = this.normalizeEmail(dto.email);

    let businessPayload: {
      purpose: string;
      businessNumber: string;
      representativeName: string;
      startDate: string;
    };
    try {
      businessPayload = this.jwtService.verify(dto.businessVerificationToken, {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
      });
    } catch {
      throw new UnauthorizedException("사업자 정보 인증 토큰이 유효하지 않습니다.");
    }

    const normalizedBizNumber = dto.businessNumber.replace(/-/g, "");
    if (
      businessPayload.purpose !== "company_business" ||
      businessPayload.businessNumber !== normalizedBizNumber ||
      businessPayload.representativeName !== dto.representativeName ||
      businessPayload.startDate !== dto.startDate
    ) {
      throw new BadRequestException("사업자 인증 정보가 가입 정보와 일치하지 않습니다.");
    }

    let signupOtpPayload: { purpose: string; email: string };
    try {
      signupOtpPayload = this.jwtService.verify(dto.emailVerificationToken, {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
      });
    } catch {
      throw new UnauthorizedException(
        "대표 이메일 인증 토큰이 만료되었거나 유효하지 않습니다.",
      );
    }

    if (
      signupOtpPayload.purpose !== "company_signup" ||
      signupOtpPayload.email !== email
    ) {
      throw new BadRequestException(
        "대표 이메일 인증 정보가 회원가입 정보와 일치하지 않습니다.",
      );
    }

    const existingEmail = await this.prisma.company.findUnique({
      where: { email },
    });
    if (existingEmail) {
      throw new ConflictException("이미 등록된 이메일입니다.");
    }

    const existingBiz = await this.prisma.company.findUnique({
      where: { businessNumber: normalizedBizNumber },
    });
    if (existingBiz) {
      throw new ConflictException("이미 등록된 사업자등록번호입니다.");
    }

    // 국세청 진위확인은 1단계(verifyCompanyBusiness -> validateBusinessRegistration)에서
    // 이미 실시간으로 수행됨. businessVerificationToken이 "그 검증이 정확히 이 사업자
    // 정보로 통과했다"는 서버 서명 증거라, 여기서 같은 API를 다시 호출할 필요가 없음
    // (10분 TTL 내 재확인이라 실질적 이득도 없고, 중복 호출/중복 유지보수 부담만 생김)
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // 충돌 없는 고유 companyCode 생성
    let companyCode: string;
    do {
      companyCode = this.generateCompanyCode();
    } while (await this.prisma.company.findUnique({ where: { companyCode } }));

    let company;
    try {
      company = await this.prisma.company.create({
        data: {
          email,
          password: hashedPassword,
          companyName: dto.companyName,
          businessNumber: normalizedBizNumber,
          representativeName: dto.representativeName,
          startDate: dto.startDate,
          companyCode,
        },
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictException(
          "이미 등록된 이메일 또는 사업자등록번호입니다.",
        );
      }
      throw err;
    }

    return {
      id: company.id,
      email: company.email,
      companyName: company.companyName,
      companyCode: company.companyCode,
    };
  }

  // ===========================
  // CEO 로그인 Step1 (이메일/비밀번호 → tempToken + OTP 발송)
  // ===========================
  async companyLoginStep1(dto: CompanyLoginDto) {
    const company = await this.prisma.company.findUnique({
      where: { email: this.normalizeEmail(dto.email) },
    });
    if (!company) {
      throw new UnauthorizedException(
        "이메일 또는 비밀번호가 올바르지 않습니다.",
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      company.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException(
        "이메일 또는 비밀번호가 올바르지 않습니다.",
      );
    }

    // 기존 미사용 OTP 무효화 (같은 이메일 + 같은 용도로 발급된 것만)
    await this.prisma.otpVerification.updateMany({
      where: { email: company.email, purpose: "ceo_login", isUsed: false },
      data: { isUsed: true },
    });

    // 새 OTP 생성 (3분 유효)
    const otpCode = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    await this.prisma.otpVerification.create({
      data: { email: company.email, purpose: "ceo_login", code: otpCode, expiresAt },
    });

    // 이메일 OTP 발송 (실패해도 로그인 흐름은 계속 진행 — OTP는 이미 DB에 저장됨)
    try {
      await this.emailService.sendOtpEmail(company.email, otpCode);
    } catch {
      // 발송 실패 시 로그는 EmailService 내부에서 처리
    }

    // 임시 토큰 발급 (5분 유효 — OTP 유효시간 3분보다 여유 있게)
    const tempToken = this.jwtService.sign(
      { sub: company.id, purpose: "otp_verify" },
      {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
        expiresIn: "5m",
      },
    );

    return { tempToken };
  }

  // ===========================
  // CEO OTP 검증 → 토큰 발급
  // ===========================
  async companyOtpVerify(dto: CompanyOtpVerifyDto) {
    // 1. tempToken 검증
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwtService.verify(dto.tempToken, {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
      });
    } catch {
      throw new UnauthorizedException(
        "임시 토큰이 만료되었거나 유효하지 않습니다.",
      );
    }

    if (payload.purpose !== "otp_verify") {
      throw new BadRequestException("유효하지 않은 토큰입니다.");
    }

    // 2. companyId → phone 조회
    const company = await this.prisma.company.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true },
    });
    if (!company) {
      throw new UnauthorizedException("기업 정보를 찾을 수 없습니다.");
    }

    // 3. 유효한 OTP 레코드 조회 (미사용 + 만료 전 + 같은 용도)
    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: {
        email: company.email,
        purpose: "ceo_login",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      throw new UnauthorizedException(
        "OTP 코드가 만료되었습니다. 다시 로그인해주세요.",
      );
    }

    // 4. 5회 실패 잠금 확인
    if (otpRecord.failCount >= 5) {
      throw new UnauthorizedException(
        "OTP 인증 5회 실패. OTP를 재발송 요청해주세요.",
      );
    }

    // 5. 코드 일치 확인
    if (otpRecord.code !== dto.otpCode) {
      await this.prisma.otpVerification.update({
        where: { id: otpRecord.id },
        data: { failCount: { increment: 1 } },
      });

      const newFailCount = otpRecord.failCount + 1; // increment 반영
      const remaining = 5 - newFailCount;
      if (remaining <= 0) {
        throw new UnauthorizedException(
          "OTP 인증 5회 실패. OTP를 재발송 요청해주세요.",
        );
      }
      throw new UnauthorizedException(
        `OTP 코드가 올바르지 않습니다. 남은 시도 횟수: ${remaining}회`,
      );
    }

    // 6. 인증 성공 — OTP 사용 처리
    await this.prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    // 7. 토큰 발급
    const tokens = await this.generateTokens({
      sub: company.id,
      role: "COMPANY",
    });

    await this.updateRefreshToken("COMPANY", company.id, tokens.refreshToken);

    return tokens;
  }

  // ===========================
  // HR 매니저 초대 (대표 로그인 필수 — HR 본인 이메일로 초대 링크 발송)
  // ===========================
  async hrInvite(dto: HrInviteDto, companyId: string) {
    const email = this.normalizeEmail(dto.email);

    // 1. 이메일 중복 확인
    const existingHr = await this.prisma.hrManager.findUnique({
      where: { email },
    });
    if (existingHr) {
      throw new ConflictException("이미 등록된 이메일입니다.");
    }

    // 2. 기업 조회 — JWT로 인증된 대표 본인
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      throw new UnauthorizedException("기업 정보를 찾을 수 없습니다.");
    }

    // 3. 같은 이메일로 보낸 이전 대기중 초대는 무효화 (목록에 중복 안 남게)
    await this.prisma.hrInvite.updateMany({
      where: { companyId, email, status: "pending" },
      data: { status: "revoked" },
    });

    // 4. DB에 초대 기록 생성 (3일 유효) — 목록 조회/취소를 위해 상태를 추적
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    await this.prisma.hrInvite.create({
      data: { companyId, email, name: dto.name, token, expiresAt },
    });

    // 5. HR 본인 이메일로 초대 메일 발송 — 이메일이 틀렸다면 여기서 걸러짐(수신 불가)
    try {
      await this.emailService.sendHrInviteEmail(
        email,
        token,
        company.companyName,
      );
    } catch {
      // 발송 실패 시 로그는 EmailService 내부에서 처리
    }

    return { message: "초대 메일이 발송되었습니다." };
  }

  // ===========================
  // HR 매니저 초대 수락 (HR 본인이 비밀번호 설정 → 계정 생성)
  // ===========================
  async hrAcceptInvite(dto: HrAcceptInviteDto) {
    const invite = await this.prisma.hrInvite.findUnique({
      where: { token: dto.token },
    });
    if (!invite) {
      throw new UnauthorizedException("초대 링크가 유효하지 않습니다.");
    }

    if (invite.status !== "pending") {
      throw new UnauthorizedException(
        "이미 처리되었거나 취소된 초대입니다. 대표에게 재초대를 요청해주세요.",
      );
    }

    if (invite.expiresAt < new Date()) {
      await this.prisma.hrInvite.update({
        where: { id: invite.id },
        data: { status: "revoked" },
      });
      throw new UnauthorizedException(
        "초대 링크가 만료되었습니다. 대표에게 재초대를 요청해주세요.",
      );
    }

    const existingHr = await this.prisma.hrManager.findUnique({
      where: { email: invite.email },
    });
    if (existingHr) {
      throw new ConflictException("이미 가입이 완료된 이메일입니다.");
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    let hrManager;
    try {
      const [, createdHr] = await this.prisma.$transaction([
        this.prisma.hrInvite.update({
          where: { id: invite.id },
          data: { status: "accepted" },
        }),
        this.prisma.hrManager.create({
          data: {
            email: invite.email,
            password: hashedPassword,
            name: invite.name,
            companyId: invite.companyId,
          },
        }),
      ]);
      hrManager = createdHr;
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictException("이미 가입이 완료된 이메일입니다.");
      }
      throw err;
    }

    return {
      id: hrManager.id,
      name: hrManager.name,
      email: hrManager.email,
      companyId: hrManager.companyId,
    };
  }

  // ===========================
  // 인사팀장 목록 조회 (활성 계정 + 대기중/만료된 초대 함께)
  // ===========================
  async listHrManagers(companyId: string) {
    const [hrManagers, invites] = await Promise.all([
      this.prisma.hrManager.findMany({
        where: { companyId },
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.hrInvite.findMany({
        where: { companyId, status: "pending" },
        select: {
          id: true,
          name: true,
          email: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const now = new Date();

    const activeList = hrManagers.map((hr) => ({
      id: hr.id,
      name: hr.name,
      email: hr.email,
      status: "active" as const,
      createdAt: hr.createdAt,
    }));

    const inviteList = invites.map((invite) => ({
      id: invite.id,
      name: invite.name,
      email: invite.email,
      status: (invite.expiresAt < now ? "expired" : "pending") as
        | "expired"
        | "pending",
      createdAt: invite.createdAt,
    }));

    return [...activeList, ...inviteList];
  }

  // ===========================
  // HR 매니저 로그인 Step1 (본인 email/password → 본인 이메일로 OTP 발송)
  // ===========================
  async hrLogin(dto: HrLoginDto) {
    const hrManager = await this.prisma.hrManager.findUnique({
      where: { email: this.normalizeEmail(dto.email) },
    });
    if (!hrManager || !hrManager.email) {
      throw new UnauthorizedException("등록된 인사팀장 계정을 찾을 수 없습니다.");
    }

    if (!hrManager.password || !(await bcrypt.compare(dto.password, hrManager.password))) {
      throw new UnauthorizedException("이메일 또는 비밀번호가 올바르지 않습니다.");
    }

    // HR/대표 권한이 분리돼 있어 대표 승인을 거칠 필요가 없다는 판단에 따라,
    // 로그인 2차 인증도 본인 이메일로 받도록 변경 (대표 이메일 경유 X)
    await this.prisma.otpVerification.updateMany({
      where: { email: hrManager.email, purpose: "hr_login", isUsed: false },
      data: { isUsed: true },
    });

    const otpCode = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
    await this.prisma.otpVerification.create({
      data: { email: hrManager.email, purpose: "hr_login", code: otpCode, expiresAt },
    });

    try {
      await this.emailService.sendHrLoginEmail(hrManager.email, otpCode);
    } catch {
      // EmailService에서 발송 오류를 기록합니다.
    }

    const tempToken = this.jwtService.sign(
      { sub: hrManager.id, purpose: "hr_otp_verify" },
      {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
        expiresIn: "5m",
      },
    );

    return { tempToken };
  }

  // ===========================
  // HR 매니저 로그인 Step2 (OTP 검증 → 토큰 발급)
  // ===========================
  async hrOtpVerify(dto: HrOtpVerifyDto) {
    // 1. tempToken 검증
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwtService.verify(dto.tempToken, {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
      });
    } catch {
      throw new UnauthorizedException(
        "임시 토큰이 만료되었거나 유효하지 않습니다.",
      );
    }

    if (payload.purpose !== "hr_otp_verify") {
      throw new BadRequestException("유효하지 않은 토큰입니다.");
    }

    // 2. HR 매니저 조회 (본인 이메일 확보)
    const hrManager = await this.prisma.hrManager.findUnique({
      where: { id: payload.sub },
    });
    if (!hrManager || !hrManager.email) {
      throw new UnauthorizedException("HR 매니저 정보를 찾을 수 없습니다.");
    }

    // 3. 유효한 OTP 레코드 조회
    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: {
        email: hrManager.email,
        purpose: "hr_login",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      throw new UnauthorizedException(
        "OTP 코드가 만료되었습니다. 다시 로그인해주세요.",
      );
    }

    // 4. 5회 실패 잠금 확인
    if (otpRecord.failCount >= 5) {
      throw new UnauthorizedException(
        "OTP 인증 5회 실패. OTP를 재발송 요청해주세요.",
      );
    }

    // 5. 코드 일치 확인
    if (otpRecord.code !== dto.otpCode) {
      await this.prisma.otpVerification.update({
        where: { id: otpRecord.id },
        data: { failCount: { increment: 1 } },
      });

      const newFailCount = otpRecord.failCount + 1;
      const remaining = 5 - newFailCount;
      if (remaining <= 0) {
        throw new UnauthorizedException(
          "OTP 인증 5회 실패. OTP를 재발송 요청해주세요.",
        );
      }
      throw new UnauthorizedException(
        `OTP 코드가 올바르지 않습니다. 남은 시도 횟수: ${remaining}회`,
      );
    }

    // 6. OTP 사용 처리
    await this.prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    // 7. 토큰 발급
    const tokens = await this.generateTokens({
      sub: hrManager.id,
      role: "HR_MANAGER",
    });

    await this.updateRefreshToken(
      "HR_MANAGER",
      hrManager.id,
      tokens.refreshToken,
    );

    return tokens;
  }

  // ===========================
  // 토큰 갱신 (Refresh Token Rotation)
  // ===========================
  async refreshToken(dto: RefreshTokenDto) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(dto.refreshToken, {
        secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
      });
    } catch {
      throw new UnauthorizedException(
        "Refresh Token이 만료되었거나 유효하지 않습니다.",
      );
    }

    // DB에 저장된 refreshToken과 비교
    const storedToken = await this.getStoredRefreshToken(
      payload.role,
      payload.sub,
    );
    if (!storedToken) {
      throw new UnauthorizedException("유효하지 않은 Refresh Token입니다.");
    }

    const isTokenValid = await bcrypt.compare(
      this.preHashToken(dto.refreshToken),
      storedToken,
    );
    if (!isTokenValid) {
      throw new UnauthorizedException("유효하지 않은 Refresh Token입니다.");
    }

    // Access Token + Refresh Token 모두 새로 발급 (Rotation)
    const tokens = await this.generateTokens({
      sub: payload.sub,
      role: payload.role,
    });

    // 새 Refresh Token으로 DB 교체
    await this.updateRefreshToken(
      payload.role,
      payload.sub,
      tokens.refreshToken,
    );

    return tokens;
  }

  // ===========================
  // 로그아웃
  // ===========================
  async logout(user: JwtPayload, accessToken: string) {
    // 1. DB에서 refreshToken 삭제 (기존 로직 유지)
    await this.clearRefreshToken(user.role, user.sub);

    // 2. Access Token을 Redis 블랙리스트에 추가
    //    TTL = JWT_ACCESS_EXPIRES_IN(1h) = 3600초
    //    만료된 토큰은 어차피 검증 실패하므로 TTL이 지나면 자동 삭제됨
    const ttl = this.parseTtlToSeconds(
      this.configService.get<string>("JWT_ACCESS_EXPIRES_IN") ?? "1h",
    );
    await this.redisService.addToBlacklist(accessToken, ttl);

    return { message: "로그아웃되었습니다." };
  }

  // ===========================
  // 회원가입 대표 OTP 요청·재요청
  // ===========================
  async requestCompanySignupOtp(
    dto: CompanySignupOtpRequestDto & Record<string, unknown>,
  ) {
    const email = this.normalizeEmail(dto.email as string);

    await this.prisma.otpVerification.updateMany({
      where: { email, purpose: "company_signup", isUsed: false },
      data: { isUsed: true },
    });

    const otpCode = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    await this.prisma.otpVerification.create({
      data: { email, purpose: "company_signup", code: otpCode, expiresAt },
    });

    try {
      await this.emailService.sendOtpEmail(email, otpCode);
    } catch {
      // 발송 실패 시 로그는 EmailService 내부에서 처리
    }

    return { message: "OTP가 발송되었습니다." };
  }

  // ===========================
  // 회원가입 대표 OTP 인증
  // ===========================
  async verifyCompanySignupOtp(dto: CompanySignupOtpVerifyDto) {
    const email = this.normalizeEmail(dto.email);

    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: {
        email,
        purpose: "company_signup",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      throw new UnauthorizedException(
        "OTP 코드가 만료되었거나 유효하지 않습니다.",
      );
    }

    if (otpRecord.failCount >= 5) {
      throw new UnauthorizedException(
        "OTP 인증 5회 실패. OTP를 재발송 요청해주세요.",
      );
    }

    if (otpRecord.code !== dto.otpCode) {
      await this.prisma.otpVerification.update({
        where: { id: otpRecord.id },
        data: { failCount: { increment: 1 } },
      });

      const newFailCount = otpRecord.failCount + 1;
      const remaining = 5 - newFailCount;
      if (remaining <= 0) {
        throw new UnauthorizedException(
          "OTP 인증 5회 실패. OTP를 재발송 요청해주세요.",
        );
      }
      throw new UnauthorizedException(
        `OTP 코드가 올바르지 않습니다. 남은 시도 횟수: ${remaining}회`,
      );
    }

    await this.prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    const emailVerificationToken = this.jwtService.sign(
      { purpose: "company_signup", email },
      {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
        expiresIn: "10m",
      },
    );

    return { isVerified: true, emailVerificationToken };
  }

  // ===========================
  // 로그인 OTP 재발송
  // ===========================
  async resendOtp(dto: ResendOtpDto) {
    const target = await this.resolveOtpResendTarget(dto.tempToken);

    await this.prisma.otpVerification.updateMany({
      where: { email: target.value, purpose: target.purpose, isUsed: false },
      data: { isUsed: true },
    });

    const otpCode = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    try {
      await this.prisma.otpVerification.create({
        data: { email: target.value, purpose: target.purpose, code: otpCode, expiresAt },
      });
      if (target.purpose === "ceo_login") {
        await this.emailService.sendOtpEmail(target.value, otpCode);
      } else if (target.purpose === "hr_login") {
        await this.emailService.sendHrLoginEmail(target.value, otpCode);
      } else {
        await this.emailService.sendOtpEmail(target.value, otpCode);
      }
    } catch {
      // 발송 실패 시 각 서비스 내부에서 로그 처리
    }

    return { message: "OTP가 재발송되었습니다." };
  }

  // ===========================
  // 비밀번호 재설정 요청 (대표/HR 본인 이메일로 코드 발송)
  // ===========================
  async passwordResetRequest(dto: PasswordResetRequestDto) {
    const email = this.normalizeEmail(dto.email);
    const purpose = this.passwordResetPurpose(dto.role);

    // 계정 존재 여부와 무관하게 항상 같은 응답 — 이메일 존재 여부 추측(계정 열거) 방지
    const account =
      dto.role === "COMPANY"
        ? await this.prisma.company.findUnique({ where: { email } })
        : await this.prisma.hrManager.findUnique({ where: { email } });

    if (account) {
      await this.prisma.otpVerification.updateMany({
        where: { email, purpose, isUsed: false },
        data: { isUsed: true },
      });

      const code = this.generateSixDigitCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10분

      await this.prisma.otpVerification.create({
        data: { email, purpose, code, expiresAt },
      });

      try {
        await this.emailService.sendPasswordResetEmail(email, code);
      } catch {
        // 발송 실패 시 로그는 EmailService 내부에서 처리
      }
    }

    return {
      message: "등록된 이메일이면 비밀번호 재설정 코드가 발송되었습니다.",
    };
  }

  // ===========================
  // 비밀번호 재설정 확인 (코드 검증 → 새 비밀번호 반영)
  // ===========================
  async passwordResetConfirm(dto: PasswordResetConfirmDto) {
    const email = this.normalizeEmail(dto.email);
    const purpose = this.passwordResetPurpose(dto.role);

    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: {
        email,
        purpose,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord) {
      throw new UnauthorizedException(
        "재설정 코드가 만료되었거나 유효하지 않습니다.",
      );
    }

    if (otpRecord.failCount >= 5) {
      throw new UnauthorizedException(
        "재설정 코드 인증 5회 실패. 재설정을 다시 요청해주세요.",
      );
    }

    if (otpRecord.code !== dto.code) {
      await this.prisma.otpVerification.update({
        where: { id: otpRecord.id },
        data: { failCount: { increment: 1 } },
      });

      const remaining = 5 - (otpRecord.failCount + 1);
      if (remaining <= 0) {
        throw new UnauthorizedException(
          "재설정 코드 인증 5회 실패. 재설정을 다시 요청해주세요.",
        );
      }
      throw new UnauthorizedException(
        `재설정 코드가 올바르지 않습니다. 남은 시도 횟수: ${remaining}회`,
      );
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    if (dto.role === "COMPANY") {
      const company = await this.prisma.company.findUnique({ where: { email } });
      if (!company) {
        throw new UnauthorizedException("계정을 찾을 수 없습니다.");
      }
      await this.prisma.$transaction([
        this.prisma.otpVerification.update({
          where: { id: otpRecord.id },
          data: { isUsed: true },
        }),
        this.prisma.company.update({
          where: { email },
          data: { password: hashedPassword, refreshToken: null },
        }),
      ]);
    } else {
      const hrManager = await this.prisma.hrManager.findUnique({ where: { email } });
      if (!hrManager) {
        throw new UnauthorizedException("계정을 찾을 수 없습니다.");
      }
      await this.prisma.$transaction([
        this.prisma.otpVerification.update({
          where: { id: otpRecord.id },
          data: { isUsed: true },
        }),
        this.prisma.hrManager.update({
          where: { email },
          data: { password: hashedPassword, refreshToken: null },
        }),
      ]);
    }

    return { message: "비밀번호가 재설정되었습니다. 다시 로그인해주세요." };
  }

  private passwordResetPurpose(role: PasswordResetRole): string {
    return role === "COMPANY" ? "password_reset_company" : "password_reset_hr";
  }

  // ===========================
  // 인사팀장 계정 삭제 (활성 계정) / 초대 취소 (대기중 초대) — 같은 id 공간을 공유
  // ===========================
  async deleteHrManager(hrUserId: string, companyId: string) {
    const hrManager = await this.prisma.hrManager.findUnique({
      where: { id: hrUserId },
    });

    if (hrManager) {
      if (hrManager.companyId !== companyId) {
        throw new UnauthorizedException("해당 계정을 삭제할 권한이 없습니다.");
      }

      await this.prisma.hrManager.delete({
        where: { id: hrUserId },
      });

      // JwtStrategy가 매 요청마다 계정 존재 여부를 확인하므로, 삭제된 이 계정의
      // 기존 액세스 토큰은 이 시점 이후 첫 요청부터 바로 거부됨 (만료 전이라도)
      return { message: "인사팀장 계정이 삭제되었습니다." };
    }

    const invite = await this.prisma.hrInvite.findUnique({
      where: { id: hrUserId },
    });

    if (invite) {
      if (invite.companyId !== companyId) {
        throw new UnauthorizedException("해당 초대를 취소할 권한이 없습니다.");
      }

      await this.prisma.hrInvite.update({
        where: { id: hrUserId },
        data: { status: "revoked" },
      });

      return { message: "초대가 취소되었습니다." };
    }

    throw new BadRequestException("존재하지 않는 인사팀장 계정 또는 초대입니다.");
  }

  // ===========================
  // 현재 로그인 사용자 조회
  // ===========================
  async getMe(user: JwtPayload) {
    if (user.role === "APPLICANT") {
      const applicant = await this.prisma.applicant.findUnique({
        where: { id: user.sub },
        select: {
          id: true,
          email: true,
          name: true,
          isEmailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!applicant)
        throw new UnauthorizedException("사용자를 찾을 수 없습니다.");
      return { ...applicant, role: "APPLICANT" };
    }

    if (user.role === "COMPANY") {
      const company = await this.prisma.company.findUnique({
        where: { id: user.sub },
        select: {
          id: true,
          email: true,
          companyName: true,
          businessNumber: true,
          representativeName: true,
          companyCode: true,
          isVerified: true,
          isPaid: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!company)
        throw new UnauthorizedException("기업 정보를 찾을 수 없습니다.");
      return { ...company, role: "COMPANY" };
    }

    if (user.role === "HR_MANAGER") {
      const hr = await this.prisma.hrManager.findUnique({
        where: { id: user.sub },
        select: {
          id: true,
          name: true,
          companyId: true,
          company: {
            select: {
              companyName: true,
              companyCode: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!hr)
        throw new UnauthorizedException("인사팀장 정보를 찾을 수 없습니다.");
      return { ...hr, role: "HR_MANAGER" };
    }

    throw new BadRequestException("유효하지 않은 역할입니다.");
  }

  private async resolveOtpResendTarget(tempToken: string): Promise<{
    value: string;
    purpose: "ceo_login" | "hr_login";
  }> {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwtService.verify(tempToken, {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
      });
    } catch {
      throw new UnauthorizedException(
        "임시 토큰이 만료되었거나 유효하지 않습니다.",
      );
    }

    if (payload.purpose === "otp_verify") {
      const company = await this.prisma.company.findUnique({
        where: { id: payload.sub },
        select: { email: true },
      });
      if (!company)
        throw new UnauthorizedException("기업 정보를 찾을 수 없습니다.");
      return { value: company.email, purpose: "ceo_login" };
    }

    if (payload.purpose === "hr_otp_verify") {
      const hrManager = await this.prisma.hrManager.findUnique({
        where: { id: payload.sub },
        select: { email: true },
      });
      if (!hrManager?.email) {
        throw new UnauthorizedException("HR 매니저 정보를 찾을 수 없습니다.");
      }
      return {
        value: hrManager.email,
        purpose: "hr_login",
      };
    }

    throw new BadRequestException(
      "OTP 재발송에 사용할 수 없는 임시 토큰입니다.",
    );
  }

  private async validateBusinessRegistration(
    businessNumber: string,
    representativeName: string,
    startDate: string,
  ) {
    const serviceKey = this.configService.get<string>("NTS_API_KEY") ?? "";

    // NODE_ENV(운영/개발 여부)와 별개로, 실제 국세청 검증 여부만 따로 켜고 끄는 스위치.
    // 개발이 끝나 팀 전체가 실제 사업자번호로만 테스트할 준비가 되면 true로 바꾼다.
    if (this.configService.get<string>("NTS_VALIDATION_ENABLED") !== "true") {
      return;
    }

    try {
      const ntsRes = await fetch(
        `https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=${encodeURIComponent(serviceKey)}&returnType=JSON`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businesses: [
              {
                b_no: businessNumber,
                p_nm: representativeName,
                start_dt: startDate,
              },
            ],
          }),
        },
      );

      if (!ntsRes.ok) {
        throw new BadRequestException("사업자 정보 확인 중 오류가 발생했습니다.");
      }

      const ntsData = (await ntsRes.json()) as {
        data: Array<{ valid: string }>;
      };
      if (ntsData?.data?.[0]?.valid !== "01") {
        throw new BadRequestException("사업자 정보가 일치하지 않습니다.");
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("사업자 정보 확인 중 오류가 발생했습니다.");
    }
  }

  private parseTtlToSeconds(ttl: string): number {
    const unit = ttl.slice(-1);
    const value = parseInt(ttl.slice(0, -1), 10);
    switch (unit) {
      case "s":
        return value;
      case "m":
        return value * 60;
      case "h":
        return value * 60 * 60;
      case "d":
        return value * 60 * 60 * 24;
      default:
        return 3600; // fallback: 1h
    }
  }

  // ===========================
  // Private Helpers
  // ===========================

  private async generateTokens(payload: { sub: string; role: string }) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>("JWT_ACCESS_SECRET"),
        expiresIn:
          this.configService.get<string>("JWT_ACCESS_EXPIRES_IN") ?? "1h",
      }),
      // jti(JWT ID)를 추가해 같은 초에 발급해도 항상 다른 토큰이 생성되도록 보장
      // 이 없으면 iat가 초 단위라 동일 payload+secret+expiresIn → 동일 토큰 → Rotation 무력화
      this.jwtService.signAsync(
        { ...payload, jti: randomUUID() },
        {
          secret: this.configService.get<string>("JWT_REFRESH_SECRET"),
          expiresIn:
            this.configService.get<string>("JWT_REFRESH_EXPIRES_IN") ?? "7d",
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(
    role: string,
    userId: string,
    refreshToken: string,
  ) {
    // bcrypt는 입력의 처음 72바이트만 사용하므로, JWT처럼 긴 토큰은 그대로 넣으면
    // 토큰이 달라도 앞부분이 같으면 같은 해시로 인식되어 Rotation이 무력화됨.
    // SHA-256 으로 먼저 해싱해 고정 길이(64자 hex)로 줄인 뒤 bcrypt 적용.
    const hashedToken = await bcrypt.hash(this.preHashToken(refreshToken), 10);

    switch (role) {
      case "APPLICANT":
        await this.prisma.applicant.update({
          where: { id: userId },
          data: { refreshToken: hashedToken },
        });
        break;
      case "COMPANY":
        await this.prisma.company.update({
          where: { id: userId },
          data: { refreshToken: hashedToken },
        });
        break;
      case "HR_MANAGER":
        await this.prisma.hrManager.update({
          where: { id: userId },
          data: { refreshToken: hashedToken },
        });
        break;
    }
  }

  private async getStoredRefreshToken(
    role: string,
    userId: string,
  ): Promise<string | null> {
    switch (role) {
      case "APPLICANT": {
        const user = await this.prisma.applicant.findUnique({
          where: { id: userId },
          select: { refreshToken: true },
        });
        return user?.refreshToken ?? null;
      }
      case "COMPANY": {
        const company = await this.prisma.company.findUnique({
          where: { id: userId },
          select: { refreshToken: true },
        });
        return company?.refreshToken ?? null;
      }
      case "HR_MANAGER": {
        const hr = await this.prisma.hrManager.findUnique({
          where: { id: userId },
          select: { refreshToken: true },
        });
        return hr?.refreshToken ?? null;
      }
      default:
        return null;
    }
  }

  private async clearRefreshToken(role: string, userId: string) {
    switch (role) {
      case "APPLICANT":
        await this.prisma.applicant.update({
          where: { id: userId },
          data: { refreshToken: null },
        });
        break;
      case "COMPANY":
        await this.prisma.company.update({
          where: { id: userId },
          data: { refreshToken: null },
        });
        break;
      case "HR_MANAGER":
        await this.prisma.hrManager.update({
          where: { id: userId },
          data: { refreshToken: null },
        });
        break;
    }
  }
  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 이메일 대소문자·앞뒤 공백 차이로 중복가입/로그인 실패가 생기지 않도록 정규화
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  // 동시에 같은 이메일로 두 요청이 들어오면 findUnique 중복 체크를 둘 다 통과할 수 있음
  // (TOCTOU) — 그 경우 DB unique 제약 위반(P2002)이 나는데, 이걸 날것 500 대신
  // 원래 의도했던 409 Conflict로 바꿔주기 위한 헬퍼
  private isUniqueConstraintError(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
    );
  }

  // 8자리 영문 대문자 + 숫자 조합 기업 코드 생성 (예: AB12CD34)
  // 기존에 companyCode가 null인 기업은 Prisma Studio에서 직접 수동 업데이트 필요:
  // prisma studio → companies 테이블 → companyCode가 null인 행 선택 → 값 입력 후 저장
  private generateCompanyCode(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    return Array.from(
      { length: 8 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  }

  // bcrypt 72바이트 한계 우회를 위한 사전 해싱
  private preHashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
