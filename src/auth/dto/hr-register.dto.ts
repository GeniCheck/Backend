import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class HrRegisterDto {
  @ApiProperty({ example: '홍길동', description: 'HR 담당자 이름' })
  @IsString()
  @IsNotEmpty({ message: '이름을 입력해주세요.' })
  name!: string;

  @ApiProperty({ example: '010-1234-5678', description: 'HR 담당자 전화번호 (형식: 010-0000-0000)' })
  @IsString()
  @Matches(/^01[016789]-\d{3,4}-\d{4}$/, {
    message: '전화번호는 010-0000-0000 형식이어야 합니다.',
  })
  phone!: string;
}
