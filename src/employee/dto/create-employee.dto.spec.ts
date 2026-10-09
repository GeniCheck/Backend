import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateEmployeeDto } from './create-employee.dto';

// 전역 ValidationPipe(transform + whitelist + forbidNonWhitelisted)와 같은 순서로 변환 후 검증
function validate(body: Record<string, unknown>) {
  const dto = plainToInstance(CreateEmployeeDto, body);
  return { dto, errors: validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }) };
}

describe('CreateEmployeeDto', () => {
  const base = { name: '김민준', employmentStartDate: '2026-05-09' };

  it('앞뒤 공백·대문자가 있는 이메일도 형식 검사 전에 정규화되어 통과한다', () => {
    const { dto, errors } = validate({ ...base, email: '  MinJun@Example.COM ' });

    expect(errors).toHaveLength(0);
    expect(dto.email).toBe('minjun@example.com');
  });

  it('이메일 형식이 아니면 실패한다', () => {
    expect(validate({ ...base, email: 'not-an-email' }).errors).toHaveLength(1);
  });

  it('입사일은 YYYY-MM-DD 형식만 허용한다', () => {
    expect(validate({ ...base, email: 'a@b.com', employmentStartDate: '2026/05/09' }).errors).toHaveLength(1);
    expect(validate({ ...base, email: 'a@b.com', employmentStartDate: '2026-05-09T00:00:00Z' }).errors).toHaveLength(1);
    expect(validate({ ...base, email: 'a@b.com', employmentStartDate: '2026-02-30' }).errors).toHaveLength(1);
  });
});
