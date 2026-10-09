import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { RolesGuard } from '../core/guards/roles.guard';
import { CreateQuestionTemplateDto } from './dto/create-question-template.dto';
import { ListQuestionTemplatesQueryDto } from './dto/list-question-templates-query.dto';
import { UpdateQuestionTemplateDto } from './dto/update-question-template.dto';
import { QuestionTemplateService } from './question-template.service';

@ApiTags('QuestionTemplate')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('COMPANY')
@Controller('question-templates')
export class QuestionTemplateController {
  constructor(private readonly questionTemplateService: QuestionTemplateService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '대표: 질문 템플릿 생성 (version 1)' })
  @ApiResponse({ status: 201, description: '생성 성공 { templateId, version, questionCount, status }' })
  @ApiResponse({ status: 400, description: '필수값 누락 또는 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 아님)' })
  @ApiResponse({ status: 422, description: 'INVALID_QUESTION_SET (질문 유형별 제약조건 위반)' })
  @ResponseMessage('질문 템플릿 생성 성공')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateQuestionTemplateDto) {
    return this.questionTemplateService.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: '대표: 질문 템플릿 목록 조회 (최신 수정순)' })
  @ApiResponse({ status: 200, description: '조회 성공 { items, page, size, totalElements }' })
  @ApiResponse({ status: 400, description: '쿼리 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (대표 권한 아님)' })
  @ResponseMessage('질문 템플릿 목록 조회 성공')
  list(@CurrentUser() user: JwtPayload, @Query() query: ListQuestionTemplatesQueryDto) {
    return this.questionTemplateService.list(user, query);
  }

  @Get(':templateId')
  @ApiOperation({ summary: '대표: 질문 템플릿 상세 조회 (질문 order순)' })
  @ApiParam({ name: 'templateId', description: '질문 템플릿 ID' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (다른 기업의 템플릿)' })
  @ApiResponse({ status: 404, description: 'QUESTION_TEMPLATE_NOT_FOUND' })
  @ResponseMessage('질문 템플릿 상세 조회 성공')
  findOne(@CurrentUser() user: JwtPayload, @Param('templateId') templateId: string) {
    return this.questionTemplateService.findOne(user, templateId);
  }

  @Patch(':templateId')
  @ApiOperation({ summary: '대표: 질문 템플릿 수정 (질문 변경 시 version 증가, 발송된 질문지는 영향 없음)' })
  @ApiParam({ name: 'templateId', description: '질문 템플릿 ID' })
  @ApiResponse({ status: 200, description: '수정 성공 { templateId, version, questionCount, status }' })
  @ApiResponse({ status: 400, description: '필수값 누락 또는 형식 오류' })
  @ApiResponse({ status: 401, description: '인증 필요' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN (다른 기업의 템플릿)' })
  @ApiResponse({ status: 404, description: 'QUESTION_TEMPLATE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'TEMPLATE_VERSION_CONFLICT (요청 버전과 최신 버전 불일치)' })
  @ApiResponse({ status: 422, description: 'INVALID_QUESTION_SET (질문 유형별 제약조건 위반)' })
  @ResponseMessage('질문 템플릿 수정 성공')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateQuestionTemplateDto,
  ) {
    return this.questionTemplateService.update(user, templateId, dto);
  }
}
