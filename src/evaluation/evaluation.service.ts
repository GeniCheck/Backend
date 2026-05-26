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

  // 직원: 자기 평가 제출
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

    const alreadySubmitted = await this.prisma.selfEvaluation.findUnique({
      where: { employmentId },
    });
    if (alreadySubmitted) {
      throw new ConflictException({
        success: false,
        code: 'ALREADY_SUBMITTED',
        message: '이미 자기 평가를 제출했습니다.',
      });
    }

    const selfEvaluation = await this.prisma.selfEvaluation.create({
      data: { employmentId, score: dto.score },
    });

    const deadlineAt = new Date(selfEvaluation.submittedAt);
    deadlineAt.setDate(deadlineAt.getDate() + 15);

    await this.prisma.ceoEvaluation.create({
      data: {
        employmentId,
        selfEvaluationId: selfEvaluation.id,
        deadlineAt,
      },
    });

    await this.linkService.invalidate(token);
    await this.prisma.evaluationLink.update({
      where: { token },
      data: { status: 'used' },
    });

    return { submittedAt: selfEvaluation.submittedAt, deadlineAt };
  }

  // 대표: CEO 검증 점수 입력
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

    const ceoEvaluation = await this.prisma.ceoEvaluation.findUnique({
      where: { employmentId },
    });
    if (!ceoEvaluation) {
      throw new NotFoundException('직원이 아직 자기 평가를 제출하지 않았습니다.');
    }

    if (new Date() > ceoEvaluation.deadlineAt) {
      throw new GoneException({
        success: false,
        code: 'EVALUATION_EXPIRED',
        message: '15일 골든타임이 초과되었습니다.',
      });
    }

    if (ceoEvaluation.submittedAt !== null) {
      throw new ConflictException('이미 검증 점수를 입력했습니다.');
    }

    const updated = await this.prisma.ceoEvaluation.update({
      where: { employmentId },
      data: { score: dto.score, submittedAt: new Date() },
    });

    return { score: updated.score, submittedAt: updated.submittedAt };
  }

  // 대표: 선언 vs 검증 결과 조회
  async getResult(employmentId: string, companyId: string): Promise<unknown> {
    const employment = await this.prisma.employment.findUnique({
      where: { id: employmentId },
      include: { selfEvaluation: true, ceoEvaluation: true },
    });
    if (!employment) {
      throw new NotFoundException('퇴사 기록을 찾을 수 없습니다.');
    }
    if (employment.companyId !== companyId) {
      throw new ForbiddenException('해당 직원에 대한 권한이 없습니다.');
    }

    return {
      employmentId,
      selfEvaluation: employment.selfEvaluation
        ? { score: employment.selfEvaluation.score, submittedAt: employment.selfEvaluation.submittedAt }
        : null,
      ceoEvaluation: employment.ceoEvaluation
        ? {
            score: employment.ceoEvaluation.score,
            deadlineAt: employment.ceoEvaluation.deadlineAt,
            submittedAt: employment.ceoEvaluation.submittedAt,
          }
        : null,
    };
  }
}
