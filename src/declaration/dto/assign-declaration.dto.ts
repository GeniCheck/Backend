import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export const SEND_CHANNELS = ['EMAIL'] as const;

export class AssignDeclarationDto {
  @ApiProperty({ example: 'uuid', description: '할당할 질문 템플릿 ID (ACTIVE만 가능)' })
  @IsString()
  @IsNotEmpty()
  templateId!: string;

  @ApiProperty({ enum: SEND_CHANNELS, example: 'EMAIL', description: '발송 채널 (MVP는 EMAIL만)' })
  @IsIn(SEND_CHANNELS)
  sendChannel!: (typeof SEND_CHANNELS)[number];
}
