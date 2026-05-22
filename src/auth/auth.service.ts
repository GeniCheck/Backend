import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApplicantSignupDto,
  ApplicantLoginDto,
  CompanySignupDto,
  CompanyLoginDto,
  CompanyOtpVerifyDto,
  HrLoginDto,
  HrRegisterDto,
  HrOtpVerifyDto,
  RefreshTokenDto,
  VerifyEmailDto,
} from './dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { EmailService } from './email/email.service';
import { SmsService } from './sms/sms.service';
import { RedisService } from './redis/redis.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly redisService: RedisService,
  ) {}

  // ===========================
  // 지원자 회원가입
  // ===========================
  async applicantSignup(dto: ApplicantSignupDto) {
    const existing = await this.prisma.applicant.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('이미 등록된 이메일입니다.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const applicant = await this.prisma.applicant.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
      },
    });

    // 이메일 인증 코드 생성 및 저장
    const code = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10분

    await this.prisma.emailVerification.create({
      data: { email: dto.email, code, expiresAt },
    });

    // 인증 이메일 발송 (실패해도 회원가입은 완료)
    try {
      await this.emailService.sendVerificationEmail(dto.email, code);
    } catch {
      // 이메일 발송 실패 시 로그는 EmailService 내부에서 처리
    }

    const tokens = await this.generateTokens({
      sub: applicant.id,
      role: 'APPLICANT',
    });

    await this.updateRefreshToken('APPLICANT', applicant.id, tokens.refreshToken);

    return tokens;
  }

  // ===========================
  // 이메일 인증 코드 확인
  // ===========================
  async verifyEmail(dto: VerifyEmailDto) {
    const record = await this.prisma.emailVerification.findFirst({
      where: {
        email: dto.email,
        code: dto.code,
        isUsed: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException('인증 코드가 올바르지 않습니다.');
    }

    if (record.expiresAt < new Date()) {
      throw new BadRequestException('인증 코드가 만료되었습니다. 다시 요청해주세요.');
    }

    // 코드 사용 처리 + 지원자 인증 완료 처리 (트랜잭션)
    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { isUsed: true },
      }),
      this.prisma.applicant.update({
        where: { email: dto.email },
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
      where: { email: dto.email },
    });
    if (!applicant) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, applicant.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const tokens = await this.generateTokens({
      sub: applicant.id,
      role: 'APPLICANT',
    });

    await this.updateRefreshToken('APPLICANT', applicant.id, tokens.refreshToken);

    return tokens;
  }

  // ===========================
  // 기업 회원가입
  // ===========================
  async companySignup(dto: CompanySignupDto) {
    const existingEmail = await this.prisma.company.findUnique({
      where: { email: dto.email },
    });
    if (existingEmail) {
      throw new ConflictException('이미 등록된 이메일입니다.');
    }

    const normalizedBizNumber = dto.businessNumber.replace(/-/g, '');
    const existingBiz = await this.prisma.company.findUnique({
      where: { businessNumber: normalizedBizNumber },
    });
    if (existingBiz) {
      throw new ConflictException('이미 등록된 사업자등록번호입니다.');
    }

    // NTS 사업자등록 진위확인 API 호출
    const serviceKey = this.configService.get<string>('NTS_API_KEY') ?? '';
    try {
      const ntsRes = await fetch(
        `https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=${encodeURIComponent(serviceKey)}&returnType=JSON`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businesses: [
              {
                b_no: normalizedBizNumber,
                p_nm: dto.representativeName,
                start_dt: dto.startDate,
              },
            ],
          }),
        },
      );

      if (!ntsRes.ok) {
        throw new BadRequestException('사업자 정보 확인 중 오류가 발생했습니다.');
      }

      const ntsData = (await ntsRes.json()) as {
        data: Array<{ valid: string; valid_msg: string }>;
      };

      const result = ntsData?.data?.[0];
      if (!result || result.valid !== '01') {
        throw new BadRequestException('사업자 정보가 일치하지 않습니다.');
      }
    } catch (err) {
      // BadRequestException은 그대로 re-throw, 나머지 네트워크 오류 처리
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('사업자 정보 확인 중 오류가 발생했습니다.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // 충돌 없는 고유 companyCode 생성
    let companyCode: string;
    do {
      companyCode = this.generateCompanyCode();
    } while (await this.prisma.company.findUnique({ where: { companyCode } }));

    const company = await this.prisma.company.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        companyName: dto.companyName,
        businessNumber: normalizedBizNumber,
<<<<<<< Updated upstream
=======
        representativeName: dto.representativeName,
        startDate: dto.startDate,
        phone: dto.phone,
        companyCode,
>>>>>>> Stashed changes
      },
    });

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
      where: { email: dto.email },
    });
    if (!company) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, company.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    // 기존 미사용 OTP 무효화 (같은 phone 으로 발급된 것)
    await this.prisma.otpVerification.updateMany({
      where: { phone: company.phone, isUsed: false },
      data: { isUsed: true },
    });

    // 새 OTP 생성 (3분 유효)
    const otpCode = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    await this.prisma.otpVerification.create({
      data: { phone: company.phone, code: otpCode, expiresAt },
    });

    // OTP SMS 발송 (실패해도 로그인 흐름은 계속 진행 — OTP는 이미 DB에 저장됨)
    try {
      await this.smsService.sendOtp(company.phone, otpCode);
    } catch {
      // 발송 실패 시 로그는 SmsService 내부에서 처리
    }

    // 임시 토큰 발급 (5분 유효 — OTP 유효시간 3분보다 여유 있게)
    const tempToken = this.jwtService.sign(
      { sub: company.id, purpose: 'otp_verify' },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '5m',
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
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('임시 토큰이 만료되었거나 유효하지 않습니다.');
    }

    if (payload.purpose !== 'otp_verify') {
      throw new BadRequestException('유효하지 않은 토큰입니다.');
    }

    // 2. companyId → phone 조회
    const company = await this.prisma.company.findUnique({
      where: { id: payload.sub },
      select: { id: true, phone: true },
    });
    if (!company) {
      throw new UnauthorizedException('기업 정보를 찾을 수 없습니다.');
    }

    // 3. 유효한 OTP 레코드 조회 (미사용 + 만료 전)
    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: {
        phone: company.phone,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('OTP 코드가 만료되었습니다. 다시 로그인해주세요.');
    }

    // 4. 5회 실패 잠금 확인
    if (otpRecord.failCount >= 5) {
      throw new UnauthorizedException('OTP 인증 5회 실패. 30분 후 다시 시도해주세요.');
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
        throw new UnauthorizedException('OTP 인증 5회 실패. 30분 후 다시 시도해주세요.');
      }
      throw new UnauthorizedException(`OTP 코드가 올바르지 않습니다. 남은 시도 횟수: ${remaining}회`);
    }

    // 6. 인증 성공 — OTP 사용 처리
    await this.prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    // 7. 토큰 발급
    const tokens = await this.generateTokens({
      sub: company.id,
      role: 'COMPANY',
    });

    await this.updateRefreshToken('COMPANY', company.id, tokens.refreshToken);

    return tokens;
  }

  // ===========================
  // HR 매니저 등록 Step1 (CEO 인증 → OTP 발송)
  // ===========================
  async hrRegister(dto: HrRegisterDto, companyId: string) {
    // 1. 전화번호 중복 확인
    const existingHr = await this.prisma.hrManager.findUnique({
      where: { phone: dto.phone },
    });
    if (existingHr) {
      throw new ConflictException('이미 등록된 전화번호입니다.');
    }

    // 2. 기업 조회 (CEO 전화번호 확보)
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      throw new UnauthorizedException('기업 정보를 찾을 수 없습니다.');
    }

    // 3. 기존 미사용 OTP 무효화 (CEO 전화번호 기준)
    await this.prisma.otpVerification.updateMany({
      where: { phone: company.phone, isUsed: false },
      data: { isUsed: true },
    });

    // 4. 새 OTP 생성 (3분 유효)
    const otpCode = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    await this.prisma.otpVerification.create({
      data: { phone: company.phone, code: otpCode, expiresAt },
    });

    // 5. CEO 전화번호로 OTP 발송
    try {
      await this.smsService.sendOtp(company.phone, otpCode);
    } catch {
      // 발송 실패 시 로그는 SmsService 내부에서 처리
    }

    // 6. 임시 토큰 발급 (5분, HR 정보 포함)
    const tempToken = this.jwtService.sign(
      {
        sub: companyId,
        purpose: 'hr_register',
        hrPhone: dto.phone,
        hrName: dto.name,
      },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '5m',
      },
    );

    return { tempToken };
  }

  // ===========================
  // HR 매니저 등록 Step2 (OTP 검증 → HR 생성)
  // ===========================
  async hrRegisterVerify(dto: HrOtpVerifyDto) {
    // 1. tempToken 검증
    let payload: { sub: string; purpose: string; hrPhone: string; hrName: string };
    try {
      payload = this.jwtService.verify(dto.tempToken, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('임시 토큰이 만료되었거나 유효하지 않습니다.');
    }

    if (payload.purpose !== 'hr_register') {
      throw new BadRequestException('유효하지 않은 토큰입니다.');
    }

    const { sub: companyId, hrPhone, hrName } = payload;

    // 2. 기업 조회 (CEO 전화번호 확보)
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      throw new UnauthorizedException('기업 정보를 찾을 수 없습니다.');
    }

    // 3. 유효한 OTP 레코드 조회
    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: {
        phone: company.phone,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('OTP가 만료되었습니다.');
    }

    // 4. 5회 실패 잠금 확인
    if (otpRecord.failCount >= 5) {
      throw new UnauthorizedException('OTP 5회 실패. 30분 후 다시 시도해주세요.');
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
        throw new UnauthorizedException('OTP 5회 실패. 30분 후 다시 시도해주세요.');
      }
      throw new UnauthorizedException(`OTP 코드가 올바르지 않습니다. 남은 시도 횟수: ${remaining}회`);
    }

    // 6. OTP 사용 처리 + HR 매니저 생성 (트랜잭션)
    const [, hrManager] = await this.prisma.$transaction([
      this.prisma.otpVerification.update({
        where: { id: otpRecord.id },
        data: { isUsed: true },
      }),
      this.prisma.hrManager.create({
        data: { phone: hrPhone, name: hrName, companyId },
      }),
    ]);

    return {
      id: hrManager.id,
      name: hrManager.name,
      phone: hrManager.phone,
      companyId: hrManager.companyId,
    };
  }

  // ===========================
  // HR 매니저 로그인 Step1 (전화번호/기업코드 → OTP 발송)
  // ===========================
  async hrLogin(dto: HrLoginDto) {
    // 1. 기업 코드로 기업 조회
    const company = await this.prisma.company.findUnique({
      where: { companyCode: dto.companyCode },
    });
    if (!company) {
      throw new UnauthorizedException('기업 코드가 올바르지 않습니다.');
    }

    // 2. 전화번호로 HR 매니저 조회 + 소속 기업 확인
    const hrManager = await this.prisma.hrManager.findUnique({
      where: { phone: dto.phone },
    });
    if (!hrManager || hrManager.companyId !== company.id) {
      throw new UnauthorizedException('전화번호 또는 기업 코드가 올바르지 않습니다.');
    }

    // 3. 기존 미사용 OTP 무효화 (HR 전화번호 기준)
    await this.prisma.otpVerification.updateMany({
      where: { phone: hrManager.phone, isUsed: false },
      data: { isUsed: true },
    });

    // 4. 새 OTP 생성 (3분 유효)
    const otpCode = this.generateSixDigitCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

    await this.prisma.otpVerification.create({
      data: { phone: hrManager.phone, code: otpCode, expiresAt },
    });

    // 5. HR 매니저 본인 전화번호로 OTP 발송
    try {
      await this.smsService.sendOtp(hrManager.phone, otpCode);
    } catch {
      // 발송 실패 시 로그는 SmsService 내부에서 처리
    }

    // 6. 임시 토큰 발급 (5분)
    const tempToken = this.jwtService.sign(
      { sub: hrManager.id, purpose: 'hr_otp_verify' },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '5m',
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
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('임시 토큰이 만료되었거나 유효하지 않습니다.');
    }

    if (payload.purpose !== 'hr_otp_verify') {
      throw new BadRequestException('유효하지 않은 토큰입니다.');
    }

    // 2. HR 매니저 조회 (전화번호 확보)
    const hrManager = await this.prisma.hrManager.findUnique({
      where: { id: payload.sub },
    });
    if (!hrManager) {
      throw new UnauthorizedException('HR 매니저 정보를 찾을 수 없습니다.');
    }

    // 3. 유효한 OTP 레코드 조회
    const otpRecord = await this.prisma.otpVerification.findFirst({
      where: {
        phone: hrManager.phone,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      throw new UnauthorizedException('OTP 코드가 만료되었습니다. 다시 로그인해주세요.');
    }

    // 4. 5회 실패 잠금 확인
    if (otpRecord.failCount >= 5) {
      throw new UnauthorizedException('OTP 인증 5회 실패. 30분 후 다시 시도해주세요.');
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
        throw new UnauthorizedException('OTP 인증 5회 실패. 30분 후 다시 시도해주세요.');
      }
      throw new UnauthorizedException(`OTP 코드가 올바르지 않습니다. 남은 시도 횟수: ${remaining}회`);
    }

    // 6. OTP 사용 처리
    await this.prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { isUsed: true },
    });

    // 7. 토큰 발급
    const tokens = await this.generateTokens({
      sub: hrManager.id,
      role: 'HR_MANAGER',
    });

    await this.updateRefreshToken('HR_MANAGER', hrManager.id, tokens.refreshToken);

    return tokens;
  }

  // ===========================
  // 토큰 갱신 (Refresh Token Rotation)
  // ===========================
  async refreshToken(dto: RefreshTokenDto) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(dto.refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh Token이 만료되었거나 유효하지 않습니다.');
    }

    // DB에 저장된 refreshToken과 비교
    const storedToken = await this.getStoredRefreshToken(payload.role, payload.sub);
    if (!storedToken) {
      throw new UnauthorizedException('유효하지 않은 Refresh Token입니다.');
    }

    const isTokenValid = await bcrypt.compare(this.preHashToken(dto.refreshToken), storedToken);
    if (!isTokenValid) {
      throw new UnauthorizedException('유효하지 않은 Refresh Token입니다.');
    }

    // Access Token + Refresh Token 모두 새로 발급 (Rotation)
    const tokens = await this.generateTokens({
      sub: payload.sub,
      role: payload.role,
    });

    // 새 Refresh Token으로 DB 교체
    await this.updateRefreshToken(payload.role, payload.sub, tokens.refreshToken);

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
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '1h',
    );
    await this.redisService.addToBlacklist(accessToken, ttl);
  }

  // "1h" / "7d" / "30m" 형식을 초 단위로 변환
  private parseTtlToSeconds(ttl: string): number {
    const unit = ttl.slice(-1);
    const value = parseInt(ttl.slice(0, -1), 10);
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 60 * 60 * 24;
      default:  return 3600; // fallback: 1h
    }
  }

  // ===========================
  // Private Helpers
  // ===========================

  private async generateTokens(payload: { sub: string; role: string }) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '1h',
      }),
      // jti(JWT ID)를 추가해 같은 초에 발급해도 항상 다른 토큰이 생성되도록 보장
      // 이 없으면 iat가 초 단위라 동일 payload+secret+expiresIn → 동일 토큰 → Rotation 무력화
      this.jwtService.signAsync(
        { ...payload, jti: randomUUID() },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
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
      case 'APPLICANT':
        await this.prisma.applicant.update({
          where: { id: userId },
          data: { refreshToken: hashedToken },
        });
        break;
      case 'COMPANY':
        await this.prisma.company.update({
          where: { id: userId },
          data: { refreshToken: hashedToken },
        });
        break;
      case 'HR_MANAGER':
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
      case 'APPLICANT': {
        const user = await this.prisma.applicant.findUnique({
          where: { id: userId },
          select: { refreshToken: true },
        });
        return user?.refreshToken ?? null;
      }
      case 'COMPANY': {
        const company = await this.prisma.company.findUnique({
          where: { id: userId },
          select: { refreshToken: true },
        });
        return company?.refreshToken ?? null;
      }
      case 'HR_MANAGER': {
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
      case 'APPLICANT':
        await this.prisma.applicant.update({
          where: { id: userId },
          data: { refreshToken: null },
        });
        break;
      case 'COMPANY':
        await this.prisma.company.update({
          where: { id: userId },
          data: { refreshToken: null },
        });
        break;
      case 'HR_MANAGER':
        await this.prisma.hrManager.update({
          where: { id: userId },
          data: { refreshToken: null },
        });
        break;
    }
  }
<<<<<<< Updated upstream
=======

  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 8자리 영문 대문자 + 숫자 조합 기업 코드 생성 (예: AB12CD34)
  // 기존에 companyCode가 null인 기업은 Prisma Studio에서 직접 수동 업데이트 필요:
  // prisma studio → companies 테이블 → companyCode가 null인 행 선택 → 값 입력 후 저장
  private generateCompanyCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 8 }, () =>
      chars[Math.floor(Math.random() * chars.length)],
    ).join('');
  }

  // bcrypt 72바이트 한계 우회를 위한 사전 해싱
  private preHashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
>>>>>>> Stashed changes
}
