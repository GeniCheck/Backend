import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { EvaluationService } from './evaluation.service';
import { SelfEvaluationDto, CeoEvaluationDto } from './dto';

@ApiTags('Evaluation')
@Controller('evaluation')
export class EvaluationController {
  constructor(private readonly evaluationService: EvaluationService) {}

  @Post('self/:token')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '직원: 자기 평가 제출 (토큰 인증)' })
  @ApiParam({ name: 'token', description: '이메일로 발송된 평가 토큰' })
  @ApiResponse({ status: 201, description: '자기 평가 제출 완료' })
  @ApiResponse({ status: 403, description: '재직 중 (STILL_EMPLOYED)' })
  @ApiResponse({ status: 409, description: '중복 제출 (ALREADY_SUBMITTED)' })
  @ApiResponse({ status: 410, description: '만료된 링크 (LINK_EXPIRED)' })
  @ResponseMessage('자기 평가가 제출되었습니다.')
  async submitSelf(@Param('token') token: string, @Body() dto: SelfEvaluationDto) {
    return this.evaluationService.submitSelf(token, dto);
  }

  @Post('ceo/:employmentId')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '대표: 검증 점수 입력 (15일 이내)' })
  @ApiParam({ name: 'employmentId', description: '퇴사 기록 ID' })
  @ApiResponse({ status: 201, description: '검증 점수 입력 완료' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 409, description: '이미 입력됨' })
  @ApiResponse({ status: 410, description: '15일 초과 (EVALUATION_EXPIRED)' })
  @ResponseMessage('검증 점수가 입력되었습니다.')
  async submitCeo(
    @Param('employmentId') employmentId: string,
    @Body() dto: CeoEvaluationDto,
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    return this.evaluationService.submitCeo(employmentId, dto, user.sub);
  }

  @Get(':employmentId/result')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '대표: 선언 vs 검증 결과 조회' })
  @ApiParam({ name: 'employmentId', description: '퇴사 기록 ID' })
  @ApiResponse({ status: 200, description: '결과 조회 성공' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '퇴사 기록 없음' })
  @ResponseMessage('평가 결과를 조회했습니다.')
  async getResult(@Param('employmentId') employmentId: string, @Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.evaluationService.getResult(employmentId, user.sub);
  }
}
