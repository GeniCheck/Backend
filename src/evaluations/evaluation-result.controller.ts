import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { EvaluationResultService } from './evaluation-result.service';

/**
 * 대표용 평가 비교 결과 (CEO JWT).
 * 직원용 결과 라우트(evaluations/result/:token)는 ResultLinkController로 분리해 먼저 등록한다.
 */
@ApiTags('Evaluations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('COMPANY')
@Controller('evaluations')
export class EvaluationResultController {
  constructor(private readonly evaluationResultService: EvaluationResultService) {}

  @Get(':evaluationId/result')
  @ApiOperation({ summary: '대표: 평가 비교 결과 조회 (자기선언·자기점수·대표점수·점수 차이·역량·결과 통보·직원 의견)' })
  @ApiParam({ name: 'evaluationId', description: '평가 ID' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 또는 직원 소속 불일치)' })
  @ApiResponse({ status: 404, description: 'EVALUATION_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'EVALUATION_NOT_COMPLETED (대표 검증 미완료)' })
  @ResponseMessage('대표 평가 비교 결과 조회 성공')
  getResult(@CurrentUser() user: JwtPayload, @Param('evaluationId') evaluationId: string) {
    return this.evaluationResultService.getCompanyResult(user, evaluationId);
  }
}
