import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { SubmitDeclarationDto } from '../../declaration/dto/submit-declaration.dto';
import { CreateQuestionTemplateDto } from '../../question-template/dto/create-question-template.dto';
import { StrictBoolean } from './strict-boolean.decorator';

// src/main.ts의 전역 ValidationPipe와 같은 설정 (implicit conversion이 켜져 있는 상태에서 검증해야 의미가 있다)
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

async function transform<T>(metatype: new () => T, body: unknown): Promise<T> {
  return pipe.transform(body, { type: 'body', metatype });
}

class FlagDto {
  @StrictBoolean()
  flag!: boolean;
}

class NestedDto {
  @ValidateNested()
  @Type(() => FlagDto)
  inner!: FlagDto;
}

describe('StrictBoolean', () => {
  it.each([true, false])('진짜 boolean(%s)은 그대로 통과한다', async (value) => {
    await expect(transform(FlagDto, { flag: value })).resolves.toMatchObject({ flag: value });
  });

  it.each(['false', 'true', 'YES', 'HOLD', 'NO', 1, 0, '', null])(
    '%p는 true/false로 바뀌지 않고 400으로 거부된다',
    async (value) => {
      await expect(transform(FlagDto, { flag: value })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('중첩 DTO 안에서도 원래 값으로 검사한다', async () => {
    await expect(transform(NestedDto, { inner: { flag: 'false' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(transform(NestedDto, { inner: { flag: false } })).resolves.toMatchObject({ inner: { flag: false } });
  });

  it('비교: 그냥 @IsBoolean이었다면 "false"가 true로 바뀌어 통과했다 (implicit conversion)', async () => {
    const { IsBoolean } = await import('class-validator');
    class LooseDto {
      @IsBoolean()
      flag!: boolean;
    }
    await expect(transform(LooseDto, { flag: 'false' })).resolves.toMatchObject({ flag: true });
  });
});

describe('적용된 DTO', () => {
  const consents = { evaluationAgreed: true, dataAccessAgreed: true, evidenceRetentionAgreed: true, consentVersion: '2026-10-01' };

  it.each(['evaluationAgreed', 'dataAccessAgreed', 'evidenceRetentionAgreed'])(
    '자기선언 동의 %s에 "false" 문자열을 보내면 400 (동의로 저장되지 않음)',
    async (field) => {
      await expect(
        transform(SubmitDeclarationDto, { answers: [], consents: { ...consents, [field]: 'false' } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('자기선언 동의가 진짜 boolean이면 그대로 전달된다 (false도 false로)', async () => {
    const dto = await transform(SubmitDeclarationDto, { answers: [], consents: { ...consents, dataAccessAgreed: false } });
    expect(dto.consents.dataAccessAgreed).toBe(false);
    expect(dto.consents.evaluationAgreed).toBe(true);
  });

  it.each(['required', 'evaluationEnabled'])('질문 템플릿 %s에 "false" 문자열을 보내면 400', async (field) => {
    const question = {
      order: 1, type: 'SCORE', text: '질문', required: true, scoreMin: 1, scoreMax: 10, evaluationEnabled: true,
      [field]: 'false',
    };
    await expect(
      transform(CreateQuestionTemplateDto, { name: '템플릿', questions: [question] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
