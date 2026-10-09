import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { CreateReferralConsentDto } from './dto/create-referral-consent.dto';
import { AgreeReferralConsentDto, WithdrawReferralConsentDto } from './dto/referral-consent-decision.dto';
import { ReferralConsentService } from './referral-consent.service';

/**
 * 인재 추천 게시 동의.
 * 요청(POST)은 대표 JWT, 조회·동의·철회는 직원이 메일로 받은 링크 토큰으로 인증한다.
 */
@ApiTags('Referral')
@Controller('referral/consents')
export class ReferralConsentController {
  constructor(private readonly referralConsentService: ReferralConsentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('COMPANY')
  @ApiOperation({ summary: '대표: 퇴사 직원에게 인재 추천 게시 동의 요청 (동의 링크 메일 발송)' })
  @ApiResponse({ status: 201, description: '요청 성공 { consentId, status, sentAt, expiresAt, linkSent }' })
  @ApiResponse({ status: 400, description: '필수값 누락 또는 형식 오류 (expiresInDays 1~30)' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 또는 직원 소속 불일치)' })
  @ApiResponse({ status: 404, description: 'EMPLOYEE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ACTIVE_CONSENT_EXISTS (진행 중·동의된 요청 존재)' })
  @ApiResponse({ status: 422, description: 'EMPLOYEE_NOT_RESIGNED (퇴사 직원 아님)' })
  @ApiResponse({ status: 429, description: 'LINK_RATE_LIMITED (같은 직원 24시간 3회 초과)' })
  @ResponseMessage('인재 추천 게시 동의 요청 성공')
  request(@CurrentUser() user: JwtPayload, @Body() dto: CreateReferralConsentDto) {
    return this.referralConsentService.request(user, dto);
  }

  @Get(':token')
  @ApiOperation({ summary: '직원: 추천 게시 동의 내용 조회 (목적·공개 항목·게시 기간·현재 상태)' })
  @ApiParam({ name: 'token', description: '메일로 받은 추천 동의 링크 토큰' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 403, description: 'INVALID_LINK_PURPOSE (추천 동의용 토큰 아님)' })
  @ApiResponse({ status: 404, description: 'CONSENT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ALREADY_PROCESSED (철회된 동의)' })
  @ApiResponse({ status: 410, description: 'LINK_EXPIRED (동의 링크 만료)' })
  @ResponseMessage('인재 추천 게시 동의 내용 조회 성공')
  getByToken(@Param('token') token: string) {
    return this.referralConsentService.getByToken(token);
  }

  @Patch(':token/agree')
  @ApiOperation({ summary: '직원: 추천 게시·이력서 공개 동의 (링크는 철회용으로 유지)' })
  @ApiParam({ name: 'token', description: '메일로 받은 추천 동의 링크 토큰' })
  @ApiResponse({ status: 200, description: '동의 성공 { consentId, status, agreedAt }' })
  @ApiResponse({ status: 400, description: '형식 오류 (동의 값은 true/false만)' })
  @ApiResponse({ status: 403, description: 'CONSENT_NOT_GIVEN (필수 동의 누락) / INVALID_LINK_PURPOSE' })
  @ApiResponse({ status: 404, description: 'CONSENT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ALREADY_PROCESSED (이미 처리된 동의)' })
  @ApiResponse({ status: 410, description: 'LINK_EXPIRED (동의 링크 만료)' })
  @ApiResponse({ status: 422, description: 'INVALID_CONSENT (최종 확인 누락)' })
  @ResponseMessage('인재 추천 게시 동의 성공')
  agree(
    @Param('token') token: string,
    @Body() dto: AgreeReferralConsentDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.referralConsentService.agree(token, dto, { ip, userAgent });
  }

  @Patch(':token/withdraw')
  @ApiOperation({ summary: '직원: 추천 게시 동의 철회 (공개 중인 게시물 즉시 비공개)' })
  @ApiParam({ name: 'token', description: '메일로 받은 추천 동의 링크 토큰' })
  @ApiResponse({ status: 200, description: '철회 성공 { consentId, status, postVisibility, withdrawnAt }' })
  @ApiResponse({ status: 400, description: '형식 오류' })
  @ApiResponse({ status: 403, description: 'INVALID_LINK_PURPOSE (철회 가능한 토큰 아님)' })
  @ApiResponse({ status: 404, description: 'CONSENT_NOT_FOUND (동의 기록 없음)' })
  @ApiResponse({ status: 409, description: 'ALREADY_WITHDRAWN (이미 철회) / ALREADY_PROCESSED (만료된 요청)' })
  @ApiResponse({ status: 410, description: 'LINK_EXPIRED (철회 링크 만료)' })
  @ApiResponse({ status: 422, description: 'INVALID_CONSENT (최종 확인 누락)' })
  @ResponseMessage('인재 추천 게시 동의 철회 성공')
  withdraw(
    @Param('token') token: string,
    @Body() dto: WithdrawReferralConsentDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.referralConsentService.withdraw(token, dto, { ip, userAgent });
  }
}
