import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Ip, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { DeclarationService } from './declaration.service';
import { SubmitDeclarationDto } from './dto/submit-declaration.dto';

/** 직원용 자기선언 API. 계정 없이 메일로 받은 1회성 링크 토큰으로만 인증한다. */
@ApiTags('Declaration')
@Controller('declarations/forms')
export class DeclarationFormController {
  constructor(private readonly declarationService: DeclarationService) {}

  @Get(':token')
  @ApiOperation({ summary: '직원: 자기선언 질문지 조회 (링크 토큰, 조회만으로는 링크 소비 안 함)' })
  @ApiParam({ name: 'token', description: '메일로 받은 자기선언 링크 토큰' })
  @ApiResponse({ status: 200, description: '조회 성공 (질문 스냅샷, 필수 동의 항목, 동의서 버전)' })
  @ApiResponse({ status: 403, description: 'INVALID_LINK_PURPOSE (자기선언용 토큰 아님)' })
  @ApiResponse({ status: 409, description: 'ALREADY_SUBMITTED (이미 제출 완료)' })
  @ApiResponse({ status: 410, description: 'LINK_EXPIRED (링크 만료 또는 폐기)' })
  @ResponseMessage('직원 자기선언 질문지 조회 성공')
  getForm(@Param('token') token: string) {
    return this.declarationService.getForm(token);
  }

  @Post(':token/submit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '직원: 자기선언 답변·필수 동의 제출 (성공 시 링크 소비, 이후 수정 불가)' })
  @ApiParam({ name: 'token', description: '메일로 받은 자기선언 링크 토큰' })
  @ApiResponse({ status: 201, description: '제출 성공 { declarationId, status, submittedAt, linkConsumed }' })
  @ApiResponse({ status: 400, description: 'INVALID_ANSWER_TYPE (질문 유형과 답변 필드 불일치) 또는 형식 오류' })
  @ApiResponse({ status: 403, description: 'CONSENT_NOT_GIVEN (필수 동의 누락) / INVALID_LINK_PURPOSE' })
  @ApiResponse({ status: 409, description: 'ALREADY_SUBMITTED (이미 제출 완료)' })
  @ApiResponse({ status: 410, description: 'LINK_EXPIRED (링크 만료 또는 폐기)' })
  @ApiResponse({ status: 422, description: 'ANSWER_VALIDATION_FAILED (필수 누락·점수 범위·선택지·글자 수 위반)' })
  @ResponseMessage('직원 자기선언 답변 제출 성공')
  submit(
    @Param('token') token: string,
    @Body() dto: SubmitDeclarationDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.declarationService.submit(token, dto, { ip, userAgent });
  }
}
