import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LinkService } from '../link/link.service';
import { EmailService } from '../auth/email/email.service';
import { ResignDto } from './dto/resign.dto';

@Injectable()
export class EmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkService: LinkService,
    private readonly emailService: EmailService,
  ) {}

  async resign(dto: ResignDto, companyId: string): Promise<unknown> {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: dto.applicantId },
    });
    if (!applicant) {
      throw new NotFoundException('지원자를 찾을 수 없습니다.');
    }

    const existing = await this.prisma.employment.findFirst({
      where: { applicantId: dto.applicantId, companyId },
    });
    if (existing) {
      throw new BadRequestException('이미 퇴사 등록된 직원입니다.');
    }

    const employment = await this.prisma.employment.create({
      data: {
        applicantId: dto.applicantId,
        companyId,
        resignationDate: new Date(dto.resignationDate),
        reason: dto.reason,
        status: 'resigned',
      },
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const token = await this.linkService.generateToken(employment.id);

    await this.prisma.evaluationLink.create({
      data: {
        employmentId: employment.id,
        token,
        expiresAt,
      },
    });

    // 직원 이메일로 평가 링크 발송
    try {
      await this.emailService.sendEvaluationLinkEmail(applicant.email, token);
    } catch {
      // 이메일 발송 실패 시 로그는 EmailService 내부에서 처리
    }

    return {
      employmentId: employment.id,
      status: employment.status,
      resignationDate: employment.resignationDate,
      linkExpiredAt: expiresAt,
    };
  }

  async applicantConfirm(id: string, confirmed: boolean, applicantId: string): Promise<unknown> {
    const employment = await this.prisma.employment.findUnique({
      where: { id },
    });
    if (!employment) {
      throw new NotFoundException('퇴직 내역을 찾을 수 없습니다.');
    }

    if (employment.applicantId !== applicantId) {
      throw new ForbiddenException('본인의 퇴직 내역만 확인할 수 있습니다.');
    }

    if (employment.confirmed) {
      throw new BadRequestException('이미 확인이 완료되었습니다.');
    }

    const confirmedAt = new Date();
    await this.prisma.employment.update({
      where: { id },
      data: { confirmed: true, confirmedAt },
    });

    return {
      employmentId: employment.id,
      confirmed: true,
      confirmedAt,
    };
  }
}
