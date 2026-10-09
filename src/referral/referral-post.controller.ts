import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { CreateReferralPostDto, ListReferralPostsQueryDto, UpdateReferralPostDto } from './dto/referral-post.dto';
import { ReferralPostService } from './referral-post.service';

/**
 * 인재 추천 게시물.
 * 작성·수정·삭제: 작성 기업 대표만 / 목록·상세: 모든 가입 기업의 대표·인사팀장
 */
@ApiTags('Referral')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('referral/posts')
export class ReferralPostController {
  constructor(private readonly referralPostService: ReferralPostService) {}

  @Post()
  @Roles('COMPANY')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '대표: 인재 추천 게시물 작성 (동의 AGREED 직원, 이력서는 업로드 확인 후 첨부)' })
  @ApiResponse({ status: 201, description: '작성 성공 { postId, status, publishedAt, expiresAt }' })
  @ApiResponse({ status: 400, description: '필수값 누락 또는 형식 오류 (publishMonths 3·6)' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한·직원 소속 불일치) / CONSENT_NOT_GIVEN (동의 없음·익명 동의인데 실명 게시)' })
  @ApiResponse({ status: 404, description: 'EMPLOYEE_NOT_FOUND / RESUME_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ACTIVE_POST_EXISTS (공개 중인 게시물 존재)' })
  @ApiResponse({ status: 422, description: 'INVALID_RECOMMENDATION_CONTENT (200자 초과·금지 표현) / RESUME_NOT_UPLOADED / RESUME_MISMATCH' })
  @ResponseMessage('인재 추천 게시물 작성 성공')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateReferralPostDto) {
    return this.referralPostService.create(user, dto);
  }

  @Get()
  @Roles('COMPANY', 'HR_MANAGER')
  @ApiOperation({ summary: '대표·인사팀장: 공개 중인 인재 추천 게시물 목록 (모든 기업, 익명은 이름 마스킹)' })
  @ApiResponse({ status: 200, description: '조회 성공 { items, page, size, total }' })
  @ApiResponse({ status: 400, description: '쿼리 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표·인사팀장 권한 아님)' })
  @ResponseMessage('인재 추천 게시물 목록 조회 성공')
  list(@CurrentUser() user: JwtPayload, @Query() query: ListReferralPostsQueryDto) {
    return this.referralPostService.list(user, query);
  }

  @Get(':postId')
  @Roles('COMPANY', 'HR_MANAGER')
  @ApiOperation({ summary: '대표·인사팀장: 인재 추천 게시물 상세 (업로드 확인된 이력서는 5분 다운로드 URL)' })
  @ApiParam({ name: 'postId', description: '게시물 ID' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표·인사팀장 권한 아님)' })
  @ApiResponse({ status: 404, description: 'REFERRAL_POST_NOT_FOUND (없음·비공개·동의 철회)' })
  @ApiResponse({ status: 410, description: 'REFERRAL_POST_EXPIRED (게시 기간 만료)' })
  @ResponseMessage('인재 추천 게시물 상세 조회 성공')
  findOne(@CurrentUser() user: JwtPayload, @Param('postId') postId: string) {
    return this.referralPostService.findOne(user, postId);
  }

  @Patch(':postId')
  @Roles('COMPANY')
  @ApiOperation({ summary: '작성 기업 대표: 추천 게시물 수정 (제목·추천 사유·이름 표시, 게시 기간 3 → 6개월 연장)' })
  @ApiParam({ name: 'postId', description: '게시물 ID' })
  @ApiResponse({ status: 200, description: '수정 성공 { postId, status, updatedAt, expiresAt }' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (작성 기업 아님) / CONSENT_WITHDRAWN (동의 철회) / CONSENT_NOT_GIVEN (익명 동의인데 실명)' })
  @ApiResponse({ status: 404, description: 'REFERRAL_POST_NOT_FOUND' })
  @ApiResponse({ status: 410, description: 'REFERRAL_POST_EXPIRED' })
  @ApiResponse({ status: 422, description: 'INVALID_RECOMMENDATION_CONTENT / INVALID_PUBLISH_PERIOD (기간 단축)' })
  @ResponseMessage('인재 추천 게시물 수정 성공')
  update(@CurrentUser() user: JwtPayload, @Param('postId') postId: string, @Body() dto: UpdateReferralPostDto) {
    return this.referralPostService.update(user, postId, dto);
  }

  @Delete(':postId')
  @Roles('COMPANY')
  @ApiOperation({ summary: '작성 기업 대표: 추천 게시물 삭제 (소프트 삭제 DELETED)' })
  @ApiParam({ name: 'postId', description: '게시물 ID' })
  @ApiResponse({ status: 200, description: '삭제 성공 { postId, status, deletedAt }' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 또는 작성 기업 불일치)' })
  @ApiResponse({ status: 404, description: 'REFERRAL_POST_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ALREADY_HIDDEN (이미 삭제됨)' })
  @ResponseMessage('인재 추천 게시물 삭제 성공')
  remove(@CurrentUser() user: JwtPayload, @Param('postId') postId: string) {
    return this.referralPostService.remove(user, postId);
  }
}
