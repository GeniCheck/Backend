import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { EmploymentService } from './employment.service';
import { ResignDto } from './dto/resign.dto';

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
      throw new Error('대표만 퇴사 등록이 가능합니다.');
    }
    return this.employmentService.resign(dto, user.sub);
  }
}
