import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { ResignEmployeeDto } from './dto/resign-employee.dto';
import { EmployeeResignService } from './employee-resign.service';

/**
 * 신규 흐름의 퇴사 등록. 레거시 src/employment의 같은 라우트(POST /employment/resign)는 이 이슈에서 제거했다.
 * 레거시 EmploymentController(@Controller('employment'))의 applicant-confirm은 그대로 남아 있다.
 */
@ApiTags('Employment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('COMPANY')
@Controller('employment')
export class EmployeeResignController {
  constructor(private readonly employeeResignService: EmployeeResignService) {}

  @Post('resign')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '대표: 직원 퇴사 등록 및 자기평가 시작 (평가 생성 + 자기평가 링크 메일)' })
  @ApiResponse({
    status: 201,
    description:
      '등록 성공 { employmentId(=employeeId), evaluationId, employmentStatus, evaluationStatus, selfEvaluationDueAt, ceoEvaluationDueAt, linkSent }',
  })
  @ApiResponse({ status: 400, description: '필수값 누락 또는 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 또는 직원 소속 불일치)' })
  @ApiResponse({ status: 404, description: 'EMPLOYEE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ALREADY_RESIGNED / DECLARATION_NOT_SUBMITTED' })
  @ApiResponse({ status: 422, description: 'INVALID_RESIGNATION_DATE (입사일 이전 또는 유효하지 않은 퇴사일)' })
  @ResponseMessage('직원 퇴사 등록 및 자기평가 시작 성공')
  resign(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ResignEmployeeDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.employeeResignService.resign(user, dto, { ip, userAgent });
  }
}
