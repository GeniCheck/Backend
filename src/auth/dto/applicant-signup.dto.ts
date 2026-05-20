import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ApplicantSignupDto {
  @ApiProperty({ example: 'user@example.com', description: '이메일 (최대 50자)' })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  @IsNotEmpty({ message: '이메일을 입력해주세요.' })
  @MaxLength(50, { message: '이메일은 최대 50자까지 입력할 수 있습니다.' })
  @Matches(/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/, {
    message: '이메일은 영문, 숫자만 사용할 수 있습니다.',
  })
  email!: string;

  @ApiProperty({
    example: 'Pass1!',
    description: '비밀번호 (6~10자, 영문 대소문자·숫자·특수문자(!@#$%^&*) 각 1개 이상)',
  })
  @IsString()
  @MinLength(6, { message: '비밀번호는 최소 6자 이상이어야 합니다.' })
  @MaxLength(10, { message: '비밀번호는 최대 10자까지 입력할 수 있습니다.' })
  @Matches(/^[a-zA-Z0-9!@#$%^&*]+$/, {
    message: '비밀번호는 영문, 숫자, 특수문자(!@#$%^&*)만 사용할 수 있습니다.',
  })
  @Matches(/(?=.*[a-z])/, { message: '비밀번호에 소문자를 포함해야 합니다.' })
  @Matches(/(?=.*[A-Z])/, { message: '비밀번호에 대문자를 포함해야 합니다.' })
  @Matches(/(?=.*\d)/, { message: '비밀번호에 숫자를 포함해야 합니다.' })
  @Matches(/(?=.*[!@#$%^&*])/, { message: '비밀번호에 특수문자(!@#$%^&*)를 포함해야 합니다.' })
  password!: string;

  @ApiProperty({ example: '홍길동', description: '이름 (2~10자, 한글 완성형·영문만 허용)' })
  @IsString()
  @IsNotEmpty({ message: '이름을 입력해주세요.' })
  @MinLength(2, { message: '이름은 최소 2자 이상이어야 합니다.' })
  @MaxLength(10, { message: '이름은 최대 10자까지 입력할 수 있습니다.' })
  @Matches(/^[가-힣a-zA-Z]+$/, {
    message: '이름은 한글(완성형) 또는 영문만 입력할 수 있습니다.',
  })
  name!: string;
}
