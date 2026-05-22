import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
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
} from './dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
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

    const tokens = await this.generateTokens({
      sub: applicant.id,
      role: 'APPLICANT',
    });

    await this.updateRefreshToken('APPLICANT', applicant.id, tokens.refreshToken);

    return tokens;
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
  // CEO 로그인 Step1 (이메일/비밀번호 → tempToken)
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

    // 임시 토큰 발급 (5분 유효)
    const tempToken = this.jwtService.sign(
      { sub: company.id, purpose: 'otp_verify' },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: '5m',
      },
    );

    // TODO: 실제 OTP 발송 로직 (이메일/SMS)

    return { tempToken };
  }

  // ===========================
  // CEO OTP 검증 → 토큰 발급
  // ===========================
  async companyOtpVerify(dto: CompanyOtpVerifyDto) {
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

    // TODO: 실제 OTP 코드 검증 로직
    // 현재는 개발 편의를 위해 '000000' 을 통과시킴
    if (dto.otpCode !== '000000') {
      throw new UnauthorizedException('OTP 코드가 올바르지 않습니다.');
    }

    const tokens = await this.generateTokens({
      sub: payload.sub,
      role: 'COMPANY',
    });

    await this.updateRefreshToken('COMPANY', payload.sub, tokens.refreshToken);

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
  // 토큰 갱신
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

    const isTokenValid = await bcrypt.compare(dto.refreshToken, storedToken);
    if (!isTokenValid) {
      throw new UnauthorizedException('유효하지 않은 Refresh Token입니다.');
    }

    // 새 Access Token 발급
    const accessToken = this.jwtService.sign(
      { sub: payload.sub, role: payload.role },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '1h',
      },
    );

    return { accessToken };
  }

  // ===========================
  // 로그아웃
  // ===========================
  async logout(user: JwtPayload) {
    await this.clearRefreshToken(user.role, user.sub);
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
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(
    role: string,
    userId: string,
    refreshToken: string,
  ) {
    const hashedToken = await bcrypt.hash(refreshToken, 10);

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
