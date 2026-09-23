import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Request } from "express";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
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
} from "./dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { JwtPayload } from "./strategies/jwt.strategy";
import { ResponseMessage } from "../common/decorators/response-message.decorator";

@ApiTags("Auth")
@Controller("auth")
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ===========================
  // 지원자 회원가입
  // ===========================
  @Post("applicant/signup")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "지원자 회원가입 - 가입 완료 후 이메일 인증코드 자동 발송" })
  @ApiResponse({
    status: 201,
    description: "회원가입 성공, 인증 이메일 발송됨",
  })
  @ApiResponse({ status: 409, description: "이미 등록된 이메일" })
  @ResponseMessage("회원가입이 완료되었습니다. 이메일 인증을 진행해주세요.")
  async applicantSignup(@Body() dto: ApplicantSignupDto) {
    return this.authService.applicantSignup(dto);
  }

  // ===========================
  // 이메일 인증 코드 확인
  // ===========================
  @Post("applicant/verify-email")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "지원자 회원가입 - 이메일 인증코드 확인" })
  @ApiResponse({ status: 200, description: "이메일 인증 성공" })
  @ApiResponse({ status: 400, description: "코드 불일치 또는 만료" })
  @ResponseMessage("이메일 인증이 완료되었습니다.")
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  // ===========================
  // 지원자 로그인
  // ===========================
  @Post("applicant/login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "지원자 로그인 - 이메일/비밀번호 (가입 시 이메일 인증 필요)" })
  @ApiResponse({ status: 200, description: "로그인 성공" })
  @ApiResponse({ status: 401, description: "인증 실패" })
  @ResponseMessage("로그인에 성공했습니다.")
  async applicantLogin(@Body() dto: ApplicantLoginDto) {
    return this.authService.applicantLogin(dto);
  }

  // ===========================
  // 기업 회원가입
  // ===========================
  @Post("company/signup")
  @ApiOperation({
    summary: "기업대표 회원가입 3단계(최종) - 사업자 인증 + 본인 이메일 인증 토큰 검증 후 계정 생성",
  })
  @ApiResponse({ status: 201, description: "기업 회원가입 성공" })
  @ApiResponse({
    status: 409,
    description: "이미 등록된 이메일 또는 사업자등록번호",
  })
  @ResponseMessage("기업 회원가입이 완료되었습니다.")
  async companySignup(@Body() dto: CompanySignupDto) {
    return this.authService.companySignup(dto);
  }

  @Post("company/signup/business/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "기업대표 회원가입 1단계 - 사업자등록번호 진위 확인" })
  @ApiResponse({ status: 200, description: "사업자 정보 인증 성공" })
  @ApiResponse({ status: 400, description: "사업자 정보 인증 실패" })
  async verifyCompanyBusiness(@Body() dto: CompanyBusinessVerifyDto) {
    return this.authService.verifyCompanyBusiness(dto);
  }

  // ===========================
  // CEO 로그인 Step1 (이메일/비밀번호 → tempToken)
  // ===========================
  @Post("company/login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "기업대표 로그인 1단계 - 이메일/비밀번호 확인 후 본인 이메일로 인증코드 발송" })
  @ApiResponse({ status: 200, description: "임시 토큰 발급 성공" })
  @ApiResponse({ status: 401, description: "인증 실패" })
  @ResponseMessage("인증에 성공했습니다. OTP를 확인해주세요.")
  async companyLogin(@Body() dto: CompanyLoginDto) {
    return this.authService.companyLoginStep1(dto);
  }

  // ===========================
  // CEO OTP 검증
  // ===========================
  @Post("company/otp/verify")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "기업대표 로그인 2단계 - 본인 이메일 인증코드 확인 후 토큰 발급" })
  @ApiResponse({ status: 200, description: "OTP 검증 성공, 토큰 발급" })
  @ApiResponse({ status: 401, description: "OTP 검증 실패" })
  @ResponseMessage("OTP 인증에 성공했습니다.")
  async companyOtpVerify(@Body() dto: CompanyOtpVerifyDto) {
    return this.authService.companyOtpVerify(dto);
  }

  // ===========================
  // HR 매니저 초대 (대표 로그인 필수 — HR 본인 이메일로 초대 메일 발송)
  // ===========================
  @Post("hr/invite")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("access-token")
  @ApiOperation({
    summary: "인사팀장 초대 - 대표가 로그인한 상태에서 이름/이메일만 입력, HR 본인 이메일로 초대 메일 발송 (COMPANY 권한 필요)",
  })
  @ApiResponse({ status: 200, description: "초대 메일 발송 성공" })
  @ApiResponse({ status: 401, description: "인증 실패" })
  @ApiResponse({ status: 403, description: "대표만 인사팀장을 초대할 수 있음" })
  @ApiResponse({ status: 409, description: "이미 등록된 이메일" })
  @ResponseMessage("초대 메일이 발송되었습니다.")
  async hrInvite(@Body() dto: HrInviteDto, @Req() req: Request) {
    const user = req.user as JwtPayload;
    if (user.role !== "COMPANY") {
      throw new ForbiddenException("대표만 인사팀장을 초대할 수 있습니다.");
    }
    return this.authService.hrInvite(dto, user.sub);
  }

  // ===========================
  // HR 매니저 초대 수락 (HR 본인이 비밀번호 설정 → 계정 생성)
  // ===========================
  @Post("hr/accept-invite")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: "인사팀장 초대 수락 - 초대 메일의 링크를 통해 HR 본인이 비밀번호를 설정하고 가입 완료",
  })
  @ApiResponse({ status: 200, description: "HR 매니저 계정 생성 완료" })
  @ApiResponse({ status: 400, description: "유효하지 않은 토큰" })
  @ApiResponse({ status: 401, description: "초대 링크 만료 또는 무효" })
  @ApiResponse({ status: 409, description: "이미 가입이 완료된 이메일" })
  @ResponseMessage("인사팀장 계정이 생성되었습니다. 로그인해주세요.")
  async hrAcceptInvite(@Body() dto: HrAcceptInviteDto) {
    return this.authService.hrAcceptInvite(dto);
  }

  // ===========================
  // HR 매니저 로그인 Step1 (이메일 OTP 발송)
  // ===========================
  @Post("hr/login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: "인사팀장 로그인 1단계 - 본인 email/password 확인 후 대표 이메일로 인증코드 발송",
  })
  @ApiResponse({
    status: 200,
    description: "임시 토큰 발급 성공, 회사 대표 이메일로 인증 코드 발송",
  })
  @ApiResponse({ status: 401, description: "인증 실패" })
  @ResponseMessage("인증번호가 회사 대표 이메일로 발송되었습니다.")
  async hrLogin(@Body() dto: HrLoginDto) {
    return this.authService.hrLogin(dto);
  }

  // ===========================
  // HR 매니저 로그인 Step2 (이메일 OTP 검증 → 토큰 발급)
  // ===========================
  @Post("hr/otp/verify")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: "인사팀장 로그인 2단계 - 대표 이메일 인증 코드 검증 후 토큰 발급",
  })
  @ApiResponse({
    status: 200,
    description: "대표 이메일 인증 코드 검증 성공, 토큰 발급",
  })
  @ApiResponse({ status: 400, description: "유효하지 않은 토큰" })
  @ApiResponse({ status: 401, description: "OTP 검증 실패" })
  @ResponseMessage("로그인에 성공했습니다.")
  async hrOtpVerify(@Body() dto: HrOtpVerifyDto) {
    return this.authService.hrOtpVerify(dto);
  }

  // ===========================
  // 토큰 갱신
  // ===========================
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Access Token 갱신" })
  @ApiResponse({ status: 200, description: "토큰 갱신 성공" })
  @ApiResponse({ status: 401, description: "Refresh Token 만료 또는 무효" })
  @ResponseMessage("토큰이 갱신되었습니다.")
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto);
  }

  // ===========================
  // 회원가입 대표 OTP 요청·재요청
  // ===========================
  @Post("company/signup/otp/request")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "기업대표 회원가입 2단계 - 본인 이메일로 인증코드 발송(재발송 포함)" })
  @ApiResponse({ status: 200, description: "OTP 발송 성공" })
  @ResponseMessage("OTP가 발송되었습니다.")
  async requestCompanySignupOtp(@Body() dto: CompanySignupOtpRequestDto) {
    return this.authService.requestCompanySignupOtp(dto);
  }

  // ===========================
  // 회원가입 대표 OTP 인증
  // ===========================
  @Post("company/signup/otp/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "기업대표 회원가입 2단계 - 본인 이메일 인증코드 확인, 최종가입용 토큰 발급" })
  @ApiResponse({ status: 200, description: "OTP 인증 성공" })
  @ApiResponse({ status: 401, description: "OTP 인증 실패" })
  @ResponseMessage("OTP 인증이 완료되었습니다.")
  async verifyCompanySignupOtp(@Body() dto: CompanySignupOtpVerifyDto) {
    return this.authService.verifyCompanySignupOtp(dto);
  }

  // ===========================
  // 로그인 OTP 재발송
  // ===========================
  @Post("otp/resend")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "로그인 OTP 재발송" })
  @ApiResponse({ status: 200, description: "OTP 재발송 성공" })
  @ResponseMessage("OTP가 재발송되었습니다.")
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  // ===========================
  // 비밀번호 재설정 요청 (대표/HR 본인 이메일로 코드 발송)
  // ===========================
  @Post("password/reset/request")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "비밀번호 재설정 요청 - 대표 또는 HR 본인 이메일로 재설정 코드 발송" })
  @ApiResponse({ status: 200, description: "요청 접수 (계정 존재 여부와 무관하게 동일 응답)" })
  @ResponseMessage("등록된 이메일이면 비밀번호 재설정 코드가 발송되었습니다.")
  async requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    return this.authService.passwordResetRequest(dto);
  }

  // ===========================
  // 비밀번호 재설정 확인
  // ===========================
  @Post("password/reset/confirm")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "비밀번호 재설정 확인 - 본인 이메일로 받은 코드 검증 후 새 비밀번호 반영" })
  @ApiResponse({ status: 200, description: "비밀번호 재설정 성공" })
  @ApiResponse({ status: 401, description: "코드 만료/불일치 또는 계정 없음" })
  @ResponseMessage("비밀번호가 재설정되었습니다.")
  async confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    return this.authService.passwordResetConfirm(dto);
  }

  // ===========================
  // 인사팀장 계정 삭제
  // ===========================
  @Delete("hr/:hrUserId")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "인사팀장 계정 삭제 (COMPANY 권한 필요)" })
  @ApiResponse({ status: 200, description: "인사팀장 계정 삭제 성공" })
  @ApiResponse({ status: 401, description: "권한 없음" })
  @ApiResponse({ status: 403, description: "대표만 인사팀장을 삭제할 수 있음" })
  @ResponseMessage("인사팀장 계정이 삭제되었습니다.")
  async deleteHrManager(
    @Param("hrUserId") hrUserId: string,
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    if (user.role !== "COMPANY") {
      throw new ForbiddenException("대표만 인사팀장을 삭제할 수 있습니다.");
    }
    return this.authService.deleteHrManager(hrUserId, user.sub);
  }

  // ===========================
  // 현재 로그인 사용자 조회
  // ===========================
  @Get("me")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "현재 로그인 사용자 조회" })
  @ApiResponse({ status: 200, description: "사용자 프로필 조회 성공" })
  @ApiResponse({ status: 401, description: "인증 필요" })
  @ResponseMessage("사용자 정보 조회가 완료되었습니다.")
  async getMe(@Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.authService.getMe(user);
  }

  // ===========================
  // 로그아웃 (POST 및 DELETE 지원)
  // ===========================
  @Post("logout")
  @Delete("logout")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "로그아웃" })
  @ApiResponse({ status: 200, description: "로그아웃 성공" })
  @ApiResponse({ status: 401, description: "인증 필요" })
  @ResponseMessage("로그아웃되었습니다.")
  async logout(@Req() req: Request) {
    const user = req.user as JwtPayload;
    // Authorization 헤더에서 Access Token 추출해 블랙리스트 등록
    const authHeader =
      (req.headers as Record<string, string>)["authorization"] ?? "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";
    return this.authService.logout(user, accessToken);
  }
}
