import { Controller, Get, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '../common/decorators/response-message.decorator';
import { LinkService } from './link.service';

@ApiTags('Link')
@Controller('employee/link')
export class LinkController {
  constructor(private readonly linkService: LinkService) {}

  @Get(':token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '직원: 평가 링크 유효성 검증' })
  @ApiParam({ name: 'token', description: '이메일로 발송된 256bit 평가 토큰' })
  @ApiResponse({ status: 200, description: '유효한 링크' })
  @ApiResponse({ status: 410, description: '만료된 링크 (LINK_EXPIRED)' })
  @ResponseMessage('유효한 링크입니다.')
  async validate(@Param('token') token: string) {
    return this.linkService.validate(token);
  }
}
