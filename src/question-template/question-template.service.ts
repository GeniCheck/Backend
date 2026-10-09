import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuestionTemplate, TemplateQuestion } from '@prisma/client';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { resolveCompanyId } from '../core/utils/company-scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuestionTemplateDto } from './dto/create-question-template.dto';
import { ListQuestionTemplatesQueryDto } from './dto/list-question-templates-query.dto';
import { UpdateQuestionTemplateDto } from './dto/update-question-template.dto';
import { NormalizedQuestion, validateQuestionSet } from './question-set.validator';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 20;

type Client = PrismaService | Prisma.TransactionClient;

@Injectable()
export class QuestionTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: JwtPayload, dto: CreateQuestionTemplateDto) {
    const companyId = await resolveCompanyId(user, this.prisma);
    const questions = validateQuestionSet(dto.questions);

    const template = await this.prisma.questionTemplate.create({
      data: {
        companyId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        questions: { create: questions.map(toQuestionData) },
      },
    });

    return {
      templateId: template.id,
      version: template.version,
      questionCount: questions.length,
      status: template.status,
    };
  }

  async list(user: JwtPayload, query: ListQuestionTemplatesQueryDto) {
    const companyId = await resolveCompanyId(user, this.prisma);
    const page = query.page ?? DEFAULT_PAGE;
    const size = query.size ?? DEFAULT_SIZE;
    const keyword = query.keyword?.trim();

    const where: Prisma.QuestionTemplateWhereInput = {
      companyId,
      ...(query.status && { status: query.status }),
      ...(keyword && {
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { description: { contains: keyword, mode: 'insensitive' } },
        ],
      }),
    };

    const [totalElements, templates] = await this.prisma.$transaction([
      this.prisma.questionTemplate.count({ where }),
      this.prisma.questionTemplate.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * size,
        take: size,
        include: { _count: { select: { questions: true } } },
      }),
    ]);

    return {
      items: templates.map((template) => ({
        templateId: template.id,
        name: template.name,
        version: template.version,
        questionCount: template._count.questions,
        status: template.status,
        updatedAt: template.updatedAt,
      })),
      page,
      size,
      totalElements,
    };
  }

  async findOne(user: JwtPayload, templateId: string) {
    const companyId = await resolveCompanyId(user, this.prisma);
    const template = await this.findOwnedTemplate(this.prisma, templateId, companyId);

    return {
      templateId: template.id,
      name: template.name,
      description: template.description,
      version: template.version,
      status: template.status,
      questions: template.questions.map(toQuestionResponse),
    };
  }

  /**
   * 이름·설명·상태 수정과 질문 전체 교체.
   * 질문 내용이 바뀌면 TemplateQuestion을 교체하고 version을 1 올린다.
   * 이미 직원에게 발송된 질문지는 발송 시점에 DeclarationQuestionSnapshot으로 복사돼 있으므로
   * 여기서 질문을 지우고 다시 만들어도 발송·제출된 질문지와 답변에는 영향이 없다.
   */
  async update(user: JwtPayload, templateId: string, dto: UpdateQuestionTemplateDto) {
    const companyId = await resolveCompanyId(user, this.prisma);
    // 질문 검증은 트랜잭션 밖에서 먼저 (실패 시 DB를 건드리지 않음)
    const questions = dto.questions ? validateQuestionSet(dto.questions) : null;

    return this.prisma.$transaction(async (tx) => {
      const template = await this.findOwnedTemplate(tx, templateId, companyId);

      if (dto.version !== template.version) {
        throw versionConflict();
      }

      const questionsChanged = !!questions && !isSameQuestionSet(questions, template.questions);

      const data: Prisma.QuestionTemplateUpdateManyMutationInput = {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description?.trim() || null }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(questionsChanged && { version: { increment: 1 } }),
      };

      if (Object.keys(data).length > 0) {
        // 조회 이후 다른 요청이 먼저 수정했으면 version이 달라져 0건 → 409
        const { count } = await tx.questionTemplate.updateMany({
          where: { id: templateId, version: dto.version },
          data,
        });
        if (count === 0) {
          throw versionConflict();
        }
      }

      if (questionsChanged) {
        await tx.templateQuestion.deleteMany({ where: { templateId } });
        await tx.templateQuestion.createMany({
          data: questions.map((q) => ({ ...toQuestionData(q), templateId })),
        });
      }

      return {
        templateId,
        version: questionsChanged ? template.version + 1 : template.version,
        questionCount: questions ? questions.length : template.questions.length,
        status: dto.status ?? template.status,
      };
    });
  }

  private async findOwnedTemplate(
    client: Client,
    templateId: string,
    companyId: string,
  ): Promise<QuestionTemplate & { questions: TemplateQuestion[] }> {
    const template = await client.questionTemplate.findUnique({
      where: { id: templateId },
      include: { questions: { orderBy: { order: 'asc' } } },
    });

    if (!template) {
      throw new NotFoundException({
        code: 'QUESTION_TEMPLATE_NOT_FOUND',
        message: '질문 템플릿을 찾을 수 없습니다.',
      });
    }
    if (template.companyId !== companyId) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: '다른 기업의 질문 템플릿에는 접근할 수 없습니다.',
      });
    }

    return template;
  }
}

function versionConflict(): ConflictException {
  return new ConflictException({
    code: 'TEMPLATE_VERSION_CONFLICT',
    message: '질문 템플릿이 이미 수정되었습니다. 최신 버전을 다시 불러와 주세요.',
  });
}

function toQuestionData(q: NormalizedQuestion) {
  return {
    order: q.order,
    type: q.type,
    text: q.text,
    required: q.required,
    scoreMin: q.scoreMin ?? null,
    scoreMax: q.scoreMax ?? null,
    // Json? 컬럼은 null 대신 생략해야 DB NULL로 저장된다
    options: q.options,
    maxLength: q.maxLength ?? null,
    evaluationEnabled: q.evaluationEnabled,
  };
}

/** 질문 유형에 해당하는 필드만 응답에 포함 (노션 명세 형식) */
function toQuestionResponse(q: TemplateQuestion) {
  return {
    questionId: q.id,
    order: q.order,
    type: q.type,
    text: q.text,
    required: q.required,
    ...(q.type === 'SCORE' && { scoreMin: q.scoreMin, scoreMax: q.scoreMax }),
    ...(q.type === 'SINGLE_CHOICE' && { options: (q.options as string[] | null) ?? [] }),
    ...(q.type === 'TEXT' && { maxLength: q.maxLength }),
    evaluationEnabled: q.evaluationEnabled,
  };
}

function isSameQuestionSet(next: NormalizedQuestion[], current: TemplateQuestion[]): boolean {
  if (next.length !== current.length) {
    return false;
  }
  const comparable = (q: {
    order: number;
    type: string;
    text: string;
    required: boolean;
    scoreMin?: number | null;
    scoreMax?: number | null;
    options?: unknown;
    maxLength?: number | null;
    evaluationEnabled: boolean;
  }) =>
    JSON.stringify([
      q.order,
      q.type,
      q.text,
      q.required,
      q.scoreMin ?? null,
      q.scoreMax ?? null,
      q.options ?? null,
      q.maxLength ?? null,
      q.evaluationEnabled,
    ]);

  const sortedCurrent = [...current].sort((a, b) => a.order - b.order);
  return next.every((q, i) => comparable(q) === comparable(sortedCurrent[i]));
}
