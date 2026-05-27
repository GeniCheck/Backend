import { Body, Controller, ForbiddenException, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { EmploymentService } from './employment.service';
import { ResignDto } from './dto/resign.dto';
import { ApplicantConfirmDto } from './dto/applicant-confirm.dto';

@ApiTags('Employment')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('employment')
export class EmploymentController {
  constructor(private readonly employmentService: EmploymentService) {}

  @Post('resign')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '대표: 직원 퇴사 등록 및 평가 링크 자동 발송' })
  @ApiResponse({ status: 201, description: '퇴사 등록 완료, 평가 링크 발송됨' })
  @ApiResponse({ status: 400, description: '이미 퇴사 등록된 직원' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '지원자를 찾을 수 없음' })
  @ResponseMessage('퇴사 등록이 완료되었습니다. 평가 링크가 발송되었습니다.')
  async resign(@Body() dto: ResignDto, @Req() req: Request) {
    const user = req.user as JwtPayload;
    if (user.role !== 'COMPANY') {
      throw new ForbiddenException('대표만 퇴사 등록이 가능합니다.');
    }
    return this.employmentService.resign(dto, user.sub);
  }

  @Post(':id/applicant-confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '지원자: 퇴직 사실 확인 및 2단계 동의 트리거' })
  @ApiResponse({ status: 200, description: '퇴직 확인 완료' })
  @ApiResponse({ status: 400, description: '이미 확인이 완료됨' })
  @ApiResponse({ status: 403, description: '권한 없음 또는 본인 확인 불가' })
  @ApiResponse({ status: 404, description: '퇴직 내역을 찾을 수 없음' })
  @ResponseMessage('퇴직 확인이 완료되었습니다.')
  async applicantConfirm(
    @Param('id') id: string,
    @Body() dto: ApplicantConfirmDto,
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    if (user.role !== 'APPLICANT') {
      throw new ForbiddenException('지원자만 확인할 수 있습니다.');
    }
    return this.employmentService.applicantConfirm(id, dto.confirmed, user.sub);
  }
}
