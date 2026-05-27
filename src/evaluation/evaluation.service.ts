import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LinkService } from '../link/link.service';
import { SelfEvaluationDto, CeoEvaluationDto } from './dto';

@Injectable()
export class EvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkService: LinkService,
  ) {}

  // 직원: 자기 평가 제출 (선언별)
  async submitSelf(token: string, dto: SelfEvaluationDto): Promise<unknown> {
    const { employmentId } = await this.linkService.validate(token);

    const employment = await this.prisma.employment.findUnique({
      where: { id: employmentId },
    });
    if (!employment) {
      throw new NotFoundException('퇴사 기록을 찾을 수 없습니다.');
    }

    if (employment.status !== 'resigned') {
      throw new ForbiddenException({
        success: false,
        code: 'STILL_EMPLOYED',
        message: '재직 중인 직원은 평가를 제출할 수 없습니다.',
      });
    }

    const alreadySubmitted = await this.prisma.selfEvaluationScore.findFirst({
      where: { employmentId },
    });
    if (alreadySubmitted) {
      throw new ConflictException({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: '이미 자기 평가를 제출했습니다.',
      });
    }

    const now = new Date();
    const evaluationCloseAt = new Date(now);
    evaluationCloseAt.setDate(evaluationCloseAt.getDate() + 15);

    // 선언별 자기 평가 점수 일괄 생성
    await this.prisma.selfEvaluationScore.createMany({
      data: dto.scores.map((item) => ({
        answerId: item.answerId,
        employmentId,
        score: item.score,
      })),
    });

    // 선언별 CEO 검증 점수 레코드 미리 생성 (score null 상태)
    await this.prisma.ceoEvaluationScore.createMany({
      data: dto.scores.map((item) => ({
        answerId: item.answerId,
        employmentId,
      })),
    });

    // 골든타임 시작 기록
    await this.prisma.employment.update({
      where: { id: employmentId },
      data: {
        evaluationOpenAt: now,
        evaluationCloseAt,
      },
    });

    // 링크 즉시 만료
    await this.linkService.invalidate(token);
    await this.prisma.evaluationLink.update({
      where: { token },
      data: { status: 'used' },
    });

    return { submittedAt: now, evaluationCloseAt };
  }

  // 대표: CEO 검증 점수 입력 (선언별) + 재고용 의향
  async submitCeo(employmentId: string, dto: CeoEvaluationDto, companyId: string): Promise<unknown> {
    const employment = await this.prisma.employment.findUnique({
      where: { id: employmentId },
    });
    if (!employment) {
      throw new NotFoundException('퇴사 기록을 찾을 수 없습니다.');
    }
    if (employment.companyId !== companyId) {
      throw new ForbiddenException('해당 직원에 대한 권한이 없습니다.');
    }
    if (!employment.evaluationOpenAt) {
      throw new NotFoundException('직원이 아직 자기 평가를 제출하지 않았습니다.');
    }

    if (employment.windowClosed || (employment.evaluationCloseAt && new Date() > employment.evaluationCloseAt)) {
      throw new GoneException({
        success: false,
        code: 'EVALUATION_EXPIRED',
        message: '15일 골든타임이 초과되었습니다.',
      });
    }

    const alreadySubmitted = await this.prisma.ceoEvaluationScore.findFirst({
      where: { employmentId, submittedAt: { not: null } },
    });
    if (alreadySubmitted) {
      throw new ConflictException('이미 검증 점수를 입력했습니다.');
    }

    const now = new Date();

    // 선언별 검증 점수 일괄 업데이트
    await Promise.all(
      dto.scores.map((item) =>
        this.prisma.ceoEvaluationScore.update({
          where: { answerId: item.answerId },
          data: { score: item.score, submittedAt: now },
        }),
      ),
    );

    // 재고용 의향 + 골든타임 종료 처리
    await this.prisma.employment.update({
      where: { id: employmentId },
      data: {
        rehireIntent: dto.rehireIntent,
        windowClosed: true,
      },
    });

    return { submittedAt: now, rehireIntent: dto.rehireIntent };
  }

  // 대표: 선언 vs 검증 대조 결과 조회
  async getResult(employmentId: string, companyId: string): Promise<unknown> {
    const employment = await this.prisma.employment.findUnique({
      where: { id: employmentId },
      include: {
        declarationQuestions: {
          include: {
            answer: {
              include: {
                selfEvaluationScore: true,
                ceoEvaluationScore: true,
              },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!employment) {
      throw new NotFoundException('퇴사 기록을 찾을 수 없습니다.');
    }
    if (employment.companyId !== companyId) {
      throw new ForbiddenException('해당 직원에 대한 권한이 없습니다.');
    }

    const declarations = employment.declarationQuestions.map((q) => ({
      question: q.content,
      answer: q.answer?.content ?? null,
      selfScore: q.answer?.selfEvaluationScore?.score ?? null,
      ceoScore: q.answer?.ceoEvaluationScore?.score ?? null,
    }));

    return {
      employmentId,
      evaluationOpenAt: employment.evaluationOpenAt,
      evaluationCloseAt: employment.evaluationCloseAt,
      windowClosed: employment.windowClosed,
      rehireIntent: employment.rehireIntent,
      declarations,
    };
  }
}
