import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { SubmitSelfEvaluationDto } from './dto/submit-self-evaluation.dto';
import { SelfEvaluationService } from './self-evaluation.service';

/**
 * 직원용 자기평가 API. 메일로 받은 1회성 링크 토큰으로만 인증한다.
 * 레거시 /evaluation/*(단수)과 라우트가 겹치지 않는다.
 */
@ApiTags('Evaluations')
@Controller('evaluations/self')
export class SelfEvaluationController {
  constructor(private readonly selfEvaluationService: SelfEvaluationService) {}

  @Get(':token')
  @ApiOperation({ summary: '직원: 자기평가 폼 조회 (링크 토큰, 자기선언 답변 포함, 링크 소비 안 함)' })
  @ApiParam({ name: 'token', description: '메일로 받은 자기평가 링크 토큰' })
  @ApiResponse({ status: 200, description: '조회 성공 { evaluationId, employee, status, dueAt, scoreMin, scoreMax, items }' })
  @ApiResponse({ status: 403, description: 'INVALID_LINK_PURPOSE (자기평가용 토큰 아님)' })
  @ApiResponse({ status: 409, description: 'INVALID_EVALUATION_STATUS (자기평가 가능한 상태 아님) / ALREADY_SUBMITTED' })
  @ApiResponse({ status: 410, description: 'LINK_EXPIRED (링크 만료 또는 폐기)' })
  @ResponseMessage('직원 자기평가 폼 조회 성공')
  getForm(@Param('token') token: string) {
    return this.selfEvaluationService.getForm(token);
  }

  @Post(':token/submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '직원: 자기평가 제출 (항목별 1~10점, 제출 후 CEO_PENDING, 수정 불가)' })
  @ApiParam({ name: 'token', description: '메일로 받은 자기평가 링크 토큰' })
  @ApiResponse({ status: 201, description: '제출 성공 { evaluationId, status, submittedAt, ceoEvaluationDueAt }' })
  @ApiResponse({ status: 400, description: 'MISSING_EVALUATION_ITEM (항목 누락·중복) 또는 형식 오류' })
  @ApiResponse({ status: 409, description: 'ALREADY_SUBMITTED (이미 제출 완료)' })
  @ApiResponse({ status: 410, description: 'LINK_EXPIRED (링크 만료 또는 폐기)' })
  @ApiResponse({ status: 422, description: 'INVALID_SCORE (점수 범위 1~10 위반)' })
  @ResponseMessage('직원 자기평가 제출 성공')
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitSelfEvaluationDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.selfEvaluationService.submit(token, dto, { ip, userAgent });
  }
}
