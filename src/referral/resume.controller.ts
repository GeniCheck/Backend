import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { CreateResumeUploadUrlDto } from './dto/create-resume-upload-url.dto';
import { ResumeService } from './resume.service';

@ApiTags('Referral')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('COMPANY')
@Controller('referral/resumes')
export class ResumeController {
  constructor(private readonly resumeService: ResumeService) {}

  @Post('presigned-url')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '대표: 추천 이력서 업로드 URL 발급 (presigned PUT 10분, 파일 형식·크기 서명 포함)' })
  @ApiResponse({ status: 201, description: '발급 성공 { resumeFileId, uploadUrl, objectKey, expiresAt }' })
  @ApiResponse({ status: 400, description: '필수값 누락 또는 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한·직원 소속 불일치) / CONSENT_NOT_GIVEN (추천·이력서 공개 동의 없음)' })
  @ApiResponse({ status: 404, description: 'EMPLOYEE_NOT_FOUND' })
  @ApiResponse({ status: 413, description: 'FILE_TOO_LARGE (10MB 초과)' })
  @ApiResponse({ status: 415, description: 'UNSUPPORTED_FILE_TYPE (PDF·DOCX 이외 형식)' })
  @ApiResponse({ status: 503, description: 'STORAGE_NOT_CONFIGURED (파일 저장소 미설정)' })
  @ResponseMessage('추천 이력서 업로드 URL 발급 성공')
  createUploadUrl(@CurrentUser() user: JwtPayload, @Body() dto: CreateResumeUploadUrlDto) {
    return this.resumeService.createUploadUrl(user, dto);
  }
}
