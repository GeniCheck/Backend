import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { DeclarationService } from './declaration.service';
import { AssignDeclarationDto } from './dto/assign-declaration.dto';

/** 대표용 자기선언 API (CEO JWT) */
@ApiTags('Declaration')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('COMPANY')
@Controller()
export class DeclarationController {
  constructor(private readonly declarationService: DeclarationService) {}

  @Post('employees/:employeeId/declarations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '대표: 직원에게 자기선언 질문지 할당·발송 (템플릿 스냅샷 저장 + 1회성 링크 메일)' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({
    status: 201,
    description: '발송 성공 { declarationId, templateId, templateVersion, questionCount, status, linkExpiresAt, linkSent }',
  })
  @ApiResponse({ status: 400, description: '필수값 누락 또는 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 또는 직원·템플릿 소속 불일치)' })
  @ApiResponse({ status: 404, description: 'EMPLOYEE_OR_TEMPLATE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ACTIVE_DECLARATION_EXISTS (제출 전 질문지 존재)' })
  @ApiResponse({ status: 422, description: 'TEMPLATE_NOT_ACTIVE (보관된 템플릿)' })
  @ResponseMessage('직원 자기선언 질문지 할당·발송 성공')
  assign(
    @CurrentUser() user: JwtPayload,
    @Param('employeeId') employeeId: string,
    @Body() dto: AssignDeclarationDto,
  ) {
    return this.declarationService.assign(user, employeeId, dto);
  }

  @Get('declarations/:employeeId')
  @ApiOperation({ summary: '대표: 직원의 제출된 자기선언 조회 (질문·답변·동의 이력, 최신순)' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '조회 성공 { employeeId, declarations[] }' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 또는 직원 소속 불일치)' })
  @ApiResponse({ status: 404, description: 'DECLARATION_NOT_FOUND (제출된 자기선언 없음) / EMPLOYEE_NOT_FOUND' })
  @ResponseMessage('직원 자기선언 조회 성공')
  getEmployeeDeclarations(@CurrentUser() user: JwtPayload, @Param('employeeId') employeeId: string) {
    return this.declarationService.getEmployeeDeclarations(user, employeeId);
  }
}
