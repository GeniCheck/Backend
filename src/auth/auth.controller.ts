import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import {
  ApplicantSignupDto,
  ApplicantLoginDto,
  CompanySignupDto,
  CompanyLoginDto,
  CompanyOtpVerifyDto,
  HrLoginDto,
  RefreshTokenDto,
} from './dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtPayload } from './strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ===========================
  // 지원자 회원가입
  // ===========================
  @Post('applicant/signup')
  @ApiOperation({ summary: '지원자 회원가입' })
  @ApiResponse({ status: 201, description: '회원가입 성공' })
  @ApiResponse({ status: 409, description: '이미 등록된 이메일' })
  @ResponseMessage('회원가입이 완료되었습니다.')
  async applicantSignup(@Body() dto: ApplicantSignupDto) {
    return this.authService.applicantSignup(dto);
  }

  // ===========================
  // 지원자 로그인
  // ===========================
  @Post('applicant/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '지원자 로그인' })
  @ApiResponse({ status: 200, description: '로그인 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ResponseMessage('로그인에 성공했습니다.')
  async applicantLogin(@Body() dto: ApplicantLoginDto) {
    return this.authService.applicantLogin(dto);
  }

  // ===========================
  // 기업 회원가입
  // ===========================
  @Post('company/signup')
  @ApiOperation({ summary: '기업 회원가입 (사업자등록번호 필수)' })
  @ApiResponse({ status: 201, description: '기업 회원가입 성공' })
  @ApiResponse({ status: 409, description: '이미 등록된 이메일 또는 사업자등록번호' })
  @ResponseMessage('기업 회원가입이 완료되었습니다.')
  async companySignup(@Body() dto: CompanySignupDto) {
    return this.authService.companySignup(dto);
  }

  // ===========================
  // CEO 로그인 Step1 (이메일/비밀번호 → tempToken)
  // ===========================
  @Post('company/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'CEO 로그인 1단계 - 이메일/비밀번호 인증' })
  @ApiResponse({ status: 200, description: '임시 토큰 발급 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ResponseMessage('인증에 성공했습니다. OTP를 확인해주세요.')
  async companyLogin(@Body() dto: CompanyLoginDto) {
    return this.authService.companyLoginStep1(dto);
  }

  // ===========================
  // CEO OTP 검증
  // ===========================
  @Post('company/otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'CEO 로그인 2단계 - OTP 검증' })
  @ApiResponse({ status: 200, description: 'OTP 검증 성공, 토큰 발급' })
  @ApiResponse({ status: 401, description: 'OTP 검증 실패' })
  @ResponseMessage('OTP 인증에 성공했습니다.')
  async companyOtpVerify(@Body() dto: CompanyOtpVerifyDto) {
    return this.authService.companyOtpVerify(dto);
  }

  // ===========================
  // HR 매니저 로그인
  // ===========================
  @Post('hr/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HR 매니저 로그인' })
  @ApiResponse({ status: 200, description: '로그인 성공' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ResponseMessage('로그인에 성공했습니다.')
  async hrLogin(@Body() dto: HrLoginDto) {
    return this.authService.hrLogin(dto);
  }

  // ===========================
  // 토큰 갱신
  // ===========================
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Access Token 갱신' })
  @ApiResponse({ status: 200, description: '토큰 갱신 성공' })
  @ApiResponse({ status: 401, description: 'Refresh Token 만료 또는 무효' })
  @ResponseMessage('토큰이 갱신되었습니다.')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  // ===========================
  // 로그아웃
  // ===========================
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '로그아웃' })
  @ApiResponse({ status: 200, description: '로그아웃 성공' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ResponseMessage('로그아웃되었습니다.')
  async logout(@Req() req: Request) {
    const user = req.user as JwtPayload;
    await this.authService.logout(user);
  }
}
