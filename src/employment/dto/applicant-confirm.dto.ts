import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ApplicantConfirmDto {
  @ApiProperty({ example: true, description: '퇴직 사실 확인 여부' })
  @IsBoolean({ message: '확인 여부는 boolean이어야 합니다.' })
  confirmed!: boolean;
}
