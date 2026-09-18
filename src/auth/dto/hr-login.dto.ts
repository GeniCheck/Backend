import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class HrLoginDto {
  @ApiProperty({ example: '010-1234-5678', description: 'HR 전화번호' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^01[016789]-\d{3,4}-\d{4}$/)
  phone!: string;

  // 이전 구현과의 내부 호환용. 로그인 요청에는 사용하지 않으며 Swagger에는 노출하지 않는다.
  @ApiHideProperty()
  @IsOptional()
  @IsString()
  companyCode?: string;
}
