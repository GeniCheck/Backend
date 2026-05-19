import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
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
  RefreshTokenDto,
  VerifyEmailDto,
} from './dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { EmailService } from './email/email.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
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

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const company = await this.prisma.company.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        companyName: dto.companyName,
        businessNumber: normalizedBizNumber,
        phone: dto.phone,
      },
    });

    return {
      id: company.id,
      email: company.email,
      companyName: company.companyName,
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
  // HR 매니저 로그인
  // ===========================
  async hrLogin(dto: HrLoginDto) {
    const company = await this.prisma.company.findUnique({
      where: { companyCode: dto.companyCode },
    });
    if (!company) {
      throw new UnauthorizedException('기업 코드가 올바르지 않습니다.');
    }

    const hrManager = await this.prisma.hrManager.findUnique({
      where: { phone: dto.phone },
    });
    if (!hrManager || hrManager.companyId !== company.id) {
      throw new UnauthorizedException('전화번호 또는 기업 코드가 올바르지 않습니다.');
    }

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

  private generateSixDigitCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}
