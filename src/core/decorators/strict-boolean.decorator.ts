import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidationOptions } from 'class-validator';

/**
 * 진짜 boolean(true/false)만 통과시킨다.
 *
 * 전역 ValidationPipe의 enableImplicitConversion이 boolean 필드를 검증 전에 Boolean(값)으로 바꾸기 때문에
 * 그냥 @IsBoolean()만 쓰면 "false"·"YES"·1 같은 값이 true로 바뀌어 통과한다.
 * 동의 여부·재고용 의사처럼 법적 의미가 있는 값이 뒤바뀌지 않도록, 변환 전 원래 값으로 검사한다.
 */
export function StrictBoolean(validationOptions?: ValidationOptions) {
  return applyDecorators(
    // obj는 변환 전 원본 요청 값. 암묵 변환된 값 대신 원본을 그대로 검증에 넘긴다
    Transform(({ obj, key }) => obj[key]),
    IsBoolean(validationOptions),
  );
}
