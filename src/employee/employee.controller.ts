import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ListEmployeesQueryDto } from './dto/list-employees-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeService } from './employee.service';

@ApiTags('Employee')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('COMPANY')
@Controller('employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '대표: 직원 등록 (EMPLOYED / NOT_SENT로 생성)' })
  @ApiResponse({ status: 201, description: '등록 성공 { employeeId, employmentStatus, declarationStatus }' })
  @ApiResponse({ status: 400, description: '필수값 누락 또는 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 아님)' })
  @ApiResponse({ status: 409, description: 'EMPLOYEE_ALREADY_EXISTS (기업 내 이메일 중복)' })
  @ResponseMessage('직원 등록 성공')
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateEmployeeDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.employeeService.create(user, dto, { ip, userAgent });
  }

  @Get()
  @ApiOperation({ summary: '대표: 직원 목록 조회 (재직·선언 상태 필터, 이름·부서·직급 검색, 페이지네이션)' })
  @ApiResponse({
    status: 200,
    description: '조회 성공 { items, page, size, total } — items에 최근 평가의 evaluationId·evaluationStatus·ceoEvaluationDueAt 포함(없으면 null)',
  })
  @ApiResponse({ status: 400, description: '쿼리 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 아님)' })
  @ResponseMessage('직원 목록 조회 성공')
  list(@CurrentUser() user: JwtPayload, @Query() query: ListEmployeesQueryDto) {
    return this.employeeService.list(user, query);
  }

  @Get(':employeeId')
  @ApiOperation({ summary: '대표: 직원 상세 조회 (기본 정보 + 최근 자기선언·평가 요약)' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (다른 기업의 직원)' })
  @ApiResponse({ status: 404, description: 'EMPLOYEE_NOT_FOUND' })
  @ResponseMessage('직원 상세 조회 성공')
  findOne(@CurrentUser() user: JwtPayload, @Param('employeeId') employeeId: string) {
    return this.employeeService.findOne(user, employeeId);
  }

  @Patch(':employeeId')
  @ApiOperation({ summary: '대표: 직원 정보 수정 (이름·연락처·부서·직급·입사일만, 퇴사 전환은 별도 API)' })
  @ApiParam({ name: 'employeeId', description: '직원 ID' })
  @ApiResponse({ status: 200, description: '수정 성공' })
  @ApiResponse({ status: 400, description: '형식 오류 또는 수정 불가 필드(email 등)' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (다른 기업의 직원)' })
  @ApiResponse({ status: 404, description: 'EMPLOYEE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'INVALID_STATUS_CHANGE (재직·선언 상태 변경 시도)' })
  @ResponseMessage('직원 정보 수정 성공')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('employeeId') employeeId: string,
    @Body() dto: UpdateEmployeeDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.employeeService.update(user, employeeId, dto, { ip, userAgent });
  }
}
