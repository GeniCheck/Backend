import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
  CompanySignupOtpRequestDto,
  CompanySignupOtpVerifyDto,
  HrLoginDto,
  HrRegisterDto,
  HrOtpVerifyDto,
  RefreshTokenDto,
  VerifyEmailDto,
  ResendOtpDto,
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
  @ApiOperation({ summary: '지원자 회원가입 (완료 후 인증 이메일 자동 발송)' })
  @ApiResponse({ status: 201, description: '회원가입 성공, 인증 이메일 발송됨' })
  @ApiResponse({ status: 409, description: '이미 등록된 이메일' })
  @ResponseMessage('회원가입이 완료되었습니다. 이메일 인증을 진행해주세요.')
  async applicantSignup(@Body() dto: ApplicantSignupDto) {
    return this.authService.applicantSignup(dto);
  }

  // ===========================
  // 이메일 인증 코드 확인
  // ===========================
  @Post('applicant/verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '지원자 이메일 인증 코드 확인' })
  @ApiResponse({ status: 200, description: '이메일 인증 성공' })
  @ApiResponse({ status: 400, description: '코드 불일치 또는 만료' })
  @ResponseMessage('이메일 인증이 완료되었습니다.')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
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
  // HR 매니저 등록 Step1 (CEO OTP 발송)
  // ===========================
  @Post('hr/register')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'HR 매니저 등록 1단계 - CEO 인증 OTP 발송 (COMPANY 권한 필요)' })
  @ApiResponse({ status: 200, description: '임시 토큰 발급 성공, CEO 전화번호로 OTP 발송' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ApiResponse({ status: 409, description: '이미 등록된 전화번호' })
  @ResponseMessage('OTP가 발송되었습니다. CEO 전화번호를 확인해주세요.')
  async hrRegister(@Body() dto: HrRegisterDto, @Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.authService.hrRegister(dto, user.sub);
  }

  // ===========================
  // HR 매니저 등록 Step2 (OTP 검증 → HR 생성)
  // ===========================
  @Post('hr/register/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'HR 매니저 등록 2단계 - OTP 검증 및 HR 계정 생성 (COMPANY 권한 필요)' })
  @ApiResponse({ status: 200, description: 'HR 매니저 등록 완료' })
  @ApiResponse({ status: 400, description: '유효하지 않은 토큰' })
  @ApiResponse({ status: 401, description: 'OTP 검증 실패' })
  @ResponseMessage('HR 매니저 등록이 완료되었습니다.')
  async hrRegisterVerify(@Body() dto: HrOtpVerifyDto) {
    return this.authService.hrRegisterVerify(dto);
  }

  // ===========================
  // HR 매니저 로그인 Step1 (OTP 발송)
  // ===========================
  @Post('hr/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HR 매니저 로그인 1단계 - 전화번호/기업코드 확인 후 OTP 발송' })
  @ApiResponse({ status: 200, description: '임시 토큰 발급 성공, HR 전화번호로 OTP 발송' })
  @ApiResponse({ status: 401, description: '인증 실패' })
  @ResponseMessage('OTP가 발송되었습니다. 전화번호를 확인해주세요.')
  async hrLogin(@Body() dto: HrLoginDto) {
    return this.authService.hrLogin(dto);
  }

  // ===========================
  // HR 매니저 로그인 Step2 (OTP 검증 → 토큰 발급)
  // ===========================
  @Post('hr/otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HR 매니저 로그인 2단계 - OTP 검증 및 토큰 발급' })
  @ApiResponse({ status: 200, description: 'OTP 검증 성공, 토큰 발급' })
  @ApiResponse({ status: 400, description: '유효하지 않은 토큰' })
  @ApiResponse({ status: 401, description: 'OTP 검증 실패' })
  @ResponseMessage('로그인에 성공했습니다.')
  async hrOtpVerify(@Body() dto: HrOtpVerifyDto) {
    return this.authService.hrOtpVerify(dto);
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
  // 회원가입 대표 OTP 요청·재요청
  // ===========================
  @Post('company/signup/otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '회원가입 대표 OTP 요청·재요청' })
  @ApiResponse({ status: 200, description: 'OTP 발송 성공' })
  @ResponseMessage('OTP가 발송되었습니다.')
  async requestCompanySignupOtp(@Body() dto: CompanySignupOtpRequestDto) {
    return this.authService.requestCompanySignupOtp(dto);
  }

  // ===========================
  // 회원가입 대표 OTP 인증
  // ===========================
  @Post('company/signup/otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '회원가입 대표 OTP 인증' })
  @ApiResponse({ status: 200, description: 'OTP 인증 성공' })
  @ApiResponse({ status: 401, description: 'OTP 인증 실패' })
  @ResponseMessage('OTP 인증이 완료되었습니다.')
  async verifyCompanySignupOtp(@Body() dto: CompanySignupOtpVerifyDto) {
    return this.authService.verifyCompanySignupOtp(dto);
  }

  // ===========================
  // 로그인 OTP 재발송
  // ===========================
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '로그인 OTP 재발송' })
  @ApiResponse({ status: 200, description: 'OTP 재발송 성공' })
  @ResponseMessage('OTP가 재발송되었습니다.')
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  // ===========================
  // 인사팀장 계정 삭제
  // ===========================
  @Delete('hr/:hrUserId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '인사팀장 계정 삭제 (COMPANY 권한 필요)' })
  @ApiResponse({ status: 200, description: '인사팀장 계정 삭제 성공' })
  @ApiResponse({ status: 401, description: '권한 없음' })
  @ResponseMessage('인사팀장 계정이 삭제되었습니다.')
  async deleteHrManager(
    @Param('hrUserId') hrUserId: string,
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    return this.authService.deleteHrManager(hrUserId, user.sub);
  }

  // ===========================
  // 현재 로그인 사용자 조회
  // ===========================
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '현재 로그인 사용자 조회' })
  @ApiResponse({ status: 200, description: '사용자 프로필 조회 성공' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ResponseMessage('사용자 정보 조회가 완료되었습니다.')
  async getMe(@Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.authService.getMe(user);
  }

  // ===========================
  // 로그아웃 (POST 및 DELETE 지원)
  // ===========================
  @Post('logout')
  @Delete('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '로그아웃' })
  @ApiResponse({ status: 200, description: '로그아웃 성공' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ResponseMessage('로그아웃되었습니다.')
  async logout(@Req() req: Request) {
    const user = req.user as JwtPayload;
    // Authorization 헤더에서 Access Token 추출해 블랙리스트 등록
    const authHeader = (req.headers as Record<string, string>)['authorization'] ?? '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    return this.authService.logout(user, accessToken);
  }
}
