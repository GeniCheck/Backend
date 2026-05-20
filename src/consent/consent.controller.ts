import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { ConsentService } from './consent.service';
import { CreateConsentDto, Step2ConsentDto } from './dto';

@ApiTags('Consent')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  // ===========================
  // 1단계 동의 생성
  // ===========================
  @Post('step1')
  @ApiOperation({ summary: '1단계 동의 — 지원자가 기업 지원 시 피드백 생성 사전 동의' })
  @ApiResponse({ status: 201, description: '1단계 동의 완료' })
  @ApiResponse({ status: 400, description: '이미 동의 내역 존재 또는 약관 미동의' })
  @ApiResponse({ status: 404, description: '지원자 또는 기업을 찾을 수 없음' })
  @ResponseMessage('1단계 동의가 완료되었습니다.')
  async createStep1(@Body() dto: CreateConsentDto, @Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.consentService.createStep1(dto, user.sub);
  }

  // ===========================
  // 동의 상태 조회
  // ===========================
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '동의 상태 조회 — 1단계/2단계 동의 현황 확인' })
  @ApiResponse({ status: 200, description: '동의 상태 조회 성공' })
  @ApiResponse({ status: 404, description: '동의 내역을 찾을 수 없음' })
  @ResponseMessage('동의 상태를 조회했습니다.')
  async getConsent(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.consentService.getConsent(id, user.sub);
  }

  // ===========================
  // 2단계 동의 처리
  // ===========================
  @Patch(':id/step2')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '2단계 동의 — 퇴직 후 지원자가 최종 피드백 생성 동의/거부' })
  @ApiResponse({ status: 200, description: '2단계 동의 처리 완료' })
  @ApiResponse({ status: 400, description: '1단계 미완료 또는 이미 처리됨' })
  @ApiResponse({ status: 403, description: '철회된 동의는 수정 불가' })
  @ApiResponse({ status: 404, description: '동의 내역을 찾을 수 없음' })
  @ResponseMessage('2단계 동의가 처리되었습니다.')
  async updateStep2(@Param('id') id: string, @Body() dto: Step2ConsentDto, @Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.consentService.updateStep2(id, dto, user.sub);
  }

  // ===========================
  // 동의 철회
  // ===========================
  @Delete(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '동의 철회 — 이전 동의를 즉시 비공개 처리' })
  @ApiResponse({ status: 200, description: '동의 철회 완료' })
  @ApiResponse({ status: 400, description: '이미 철회된 동의' })
  @ApiResponse({ status: 404, description: '동의 내역을 찾을 수 없음' })
  @ResponseMessage('동의가 철회되었습니다.')
  async withdraw(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.consentService.withdraw(id, user.sub);
  }
}
