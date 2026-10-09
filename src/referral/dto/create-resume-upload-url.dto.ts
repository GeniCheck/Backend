import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

/**
 * 형식만 여기서 검사(400). 지원하지 않는 형식은 415, 10MB 초과는 413으로 서비스에서 판정한다.
 */
export class CreateResumeUploadUrlDto {
  @ApiProperty({ example: 'uuid', description: '이력서를 올릴 퇴사 직원 ID (추천 게시 동의 AGREED 필요)' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ example: 'resume.pdf', description: '파일 이름 (.pdf 또는 .docx)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    example: 'application/pdf',
    description: 'application/pdf 또는 application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  @IsString()
  @IsNotEmpty()
  contentType!: string;

  @ApiProperty({ example: 524288, description: '파일 크기(바이트), 최대 10MB' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileSize!: number;
}
