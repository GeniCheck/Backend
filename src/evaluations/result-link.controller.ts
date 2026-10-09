import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { SubmitOpinionDto } from './dto/submit-opinion.dto';
import { EvaluationResultService } from './evaluation-result.service';

/**
 * 직원용 평가 결과·의견 API. 메일로 받은 결과 링크 토큰으로만 인증한다.
 * 'evaluations/result/:token'이 대표용 'evaluations/:evaluationId/result'와 섞이지 않도록 별도 컨트롤러로 두고 먼저 등록한다.
 */
@ApiTags('Evaluations')
@Controller('evaluations/result')
export class ResultLinkController {
  constructor(private readonly evaluationResultService: EvaluationResultService) {}

  @Get(':token')
  @ApiOperation({ summary: '직원: 평가 비교 결과 조회 (결과 링크 토큰, 링크 소비 안 함, 최초 조회 시각 기록)' })
  @ApiParam({ name: 'token', description: '메일로 받은 평가 결과 링크 토큰' })
  @ApiResponse({ status: 200, description: '조회 성공 (자기점수·대표점수·점수 차이·역량·의견 제출 가능 여부)' })
  @ApiResponse({ status: 403, description: 'INVALID_LINK_PURPOSE (결과 확인용 토큰 아님)' })
  @ApiResponse({ status: 409, description: 'EVALUATION_NOT_COMPLETED (대표 검증 미완료)' })
  @ApiResponse({ status: 410, description: 'LINK_EXPIRED (링크 만료 또는 폐기)' })
  @ResponseMessage('직원 평가 비교 결과 조회 성공')
  getResult(@Param('token') token: string) {
    return this.evaluationResultService.getEmployeeResult(token);
  }

  @Post(':token/opinion')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '직원: 평가 결과 의견 제출 (1회, 완료 + 7일 이내, 점수는 변경되지 않음)' })
  @ApiParam({ name: 'token', description: '메일로 받은 평가 결과 링크 토큰' })
  @ApiResponse({ status: 201, description: '제출 성공 { evaluationId, opinionId, submittedAt }' })
  @ApiResponse({ status: 400, description: '형식 오류 (content 누락·문자열 아님)' })
  @ApiResponse({ status: 403, description: 'INVALID_LINK_PURPOSE' })
  @ApiResponse({ status: 409, description: 'OPINION_ALREADY_SUBMITTED / EVALUATION_NOT_COMPLETED' })
  @ApiResponse({ status: 410, description: 'OPINION_PERIOD_EXPIRED (의견 기한 만료) / LINK_EXPIRED' })
  @ApiResponse({ status: 422, description: 'INVALID_OPINION (빈 내용 또는 1000자 초과)' })
  @ResponseMessage('직원 평가 결과 의견 제출 성공')
  submitOpinion(
    @Param('token') token: string,
    @Body() dto: SubmitOpinionDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.evaluationResultService.submitOpinion(token, dto, { ip, userAgent });
  }
}
