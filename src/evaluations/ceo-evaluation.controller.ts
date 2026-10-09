import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { CeoEvaluationService } from './ceo-evaluation.service';
import { SubmitCeoEvaluationDto } from './dto/submit-ceo-evaluation.dto';

/** 대표 검증 API (CEO JWT). 레거시 /evaluation/ceo/:employmentId(단수)와 라우트가 겹치지 않는다. */
@ApiTags('Evaluations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('COMPANY')
@Controller('evaluations')
export class CeoEvaluationController {
  constructor(private readonly ceoEvaluationService: CeoEvaluationService) {}

  @Get(':evaluationId/ceo')
  @ApiOperation({ summary: '대표: 검증 평가 폼 조회 (자기선언 답변·자기점수 + 공통 역량 6개)' })
  @ApiParam({ name: 'evaluationId', description: '평가 ID' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한·직원 소속 불일치) / STILL_EMPLOYED (재직 중)' })
  @ApiResponse({ status: 404, description: 'EVALUATION_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ALREADY_COMPLETED / INVALID_EVALUATION_STATUS' })
  @ApiResponse({ status: 410, description: 'EVALUATION_EXPIRED (퇴사일 + 15일 대표 검증 기한 초과)' })
  @ResponseMessage('대표 검증 평가 폼 조회 성공')
  getForm(@CurrentUser() user: JwtPayload, @Param('evaluationId') evaluationId: string) {
    return this.ceoEvaluationService.getForm(user, evaluationId);
  }

  @Post(':evaluationId/ceo')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '대표: 검증 평가 제출 (항목 점수 + 공통 역량 6개 + 재고용 의사, 제출 후 수정 불가)' })
  @ApiParam({ name: 'evaluationId', description: '평가 ID' })
  @ApiResponse({ status: 201, description: '제출 성공 { evaluationId, status, completedAt, resultNotified, opinionDueAt }' })
  @ApiResponse({ status: 400, description: 'MISSING_EVALUATION_ITEM (항목·역량 누락·중복) 또는 형식 오류(서술형 필드, rehireIntent 비boolean)' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN / STILL_EMPLOYED (재직 중)' })
  @ApiResponse({ status: 404, description: 'EVALUATION_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ALREADY_COMPLETED / INVALID_EVALUATION_STATUS' })
  @ApiResponse({ status: 410, description: 'EVALUATION_EXPIRED (퇴사일 + 15일 대표 검증 기한 초과)' })
  @ApiResponse({ status: 422, description: 'INVALID_SCORE (점수 범위 1~10 위반)' })
  @ResponseMessage('대표 검증 평가 제출 성공')
  submit(
    @CurrentUser() user: JwtPayload,
    @Param('evaluationId') evaluationId: string,
    @Body() dto: SubmitCeoEvaluationDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.ceoEvaluationService.submit(user, evaluationId, dto, { ip, userAgent });
  }
}
