import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LinkService } from '../link/link.service';
import { EmailService } from '../auth/email/email.service';

@Injectable()
export class EmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkService: LinkService,
    private readonly emailService: EmailService,
  ) {}

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
