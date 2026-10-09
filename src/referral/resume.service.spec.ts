import {
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RESUME_MAX_BYTES, ResumeService, sanitizeFileName } from './resume.service';
import { StorageService } from './storage/storage.service';

const CEO = { sub: 'comp-1', role: 'COMPANY' as const };
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DTO = { employeeId: 'emp-1', fileName: 'resume.pdf', contentType: PDF, fileSize: 524288 };

async function expectCode(
  promise: Promise<unknown>,
  type: new (...args: any[]) => HttpException,
  code: string,
  status?: number,
) {
  const error = await promise.then(
    () => {
      throw new Error('예외가 발생해야 합니다.');
    },
    (e) => e,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject({ code });
  if (status) expect((error as HttpException).getStatus()).toBe(status);
}

describe('ResumeService', () => {
  let prismaMock: any;
  let storageMock: { isConfigured: jest.Mock; presignPut: jest.Mock; headObject: jest.Mock };
  let auditMock: { log: jest.Mock };
  let service: ResumeService;
  let calls: string[];

  beforeEach(() => {
    calls = [];
    prismaMock = {
      hrManager: { findUnique: jest.fn() },
      employee: { findUnique: jest.fn().mockResolvedValue({ id: 'emp-1', companyId: 'comp-1' }) },
      referralConsent: { findFirst: jest.fn().mockResolvedValue({ id: 'consent-1' }) },
      resumeFile: {
        create: jest.fn(async ({ data }: any) => {
          calls.push('db.create');
          return { id: 'resume-1', uploadedAt: null, createdAt: new Date(), ...data };
        }),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    storageMock = {
      isConfigured: jest.fn().mockReturnValue(true),
      presignPut: jest.fn(async () => {
        calls.push('storage.presignPut');
        return 'https://storage.example.com/upload?sig=1';
      }),
      headObject: jest.fn(),
    };
    auditMock = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ResumeService(
      prismaMock as unknown as PrismaService,
      storageMock as unknown as StorageService,
      auditMock as unknown as AuditService,
    );
  });

  describe('업로드 URL 발급', () => {
    it('메타데이터를 먼저 저장(uploadedAt=null)한 뒤 10분짜리 presigned PUT을 발급한다', async () => {
      const before = Date.now();
      const result = await service.createUploadUrl(CEO, DTO);

      expect(calls).toEqual(['db.create', 'storage.presignPut']); // DB 저장 후 스토리지 호출
      expect(result.resumeFileId).toBe('resume-1');
      expect(result.uploadUrl).toBe('https://storage.example.com/upload?sig=1');
      expect(result.objectKey).toMatch(/^referral-resumes\/comp-1\/[0-9a-f-]{36}\/resume\.pdf$/);
      expect(result.expiresAt.getTime() - before).toBeGreaterThanOrEqual(600_000);
      expect(result.expiresAt.getTime() - before).toBeLessThan(605_000);

      const { data } = prismaMock.resumeFile.create.mock.calls[0][0];
      expect(data).toEqual({
        companyId: 'comp-1',
        employeeId: 'emp-1',
        objectKey: result.objectKey,
        fileName: 'resume.pdf',
        contentType: PDF,
        fileSize: 524288,
      });
      expect(data).not.toHaveProperty('uploadedAt'); // 기본값 null (미확인)
      expect(storageMock.presignPut).toHaveBeenCalledWith(result.objectKey, PDF, 524288, 600);
    });

    it('DOCX도 허용하고, Content-Type 대소문자는 정규화한다', async () => {
      await expect(
        service.createUploadUrl(CEO, { ...DTO, fileName: '이력서.docx', contentType: DOCX.toUpperCase() }),
      ).resolves.toMatchObject({ resumeFileId: 'resume-1' });
      expect(prismaMock.resumeFile.create.mock.calls[0][0].data.contentType).toBe(DOCX);
    });

    it.each([
      ['이미지', { fileName: 'photo.png', contentType: 'image/png' }],
      ['구형 Word', { fileName: 'resume.doc', contentType: 'application/msword' }],
      ['실행 파일', { fileName: 'resume.exe', contentType: 'application/octet-stream' }],
      ['형식과 확장자 불일치', { fileName: 'resume.docx', contentType: PDF }],
      ['확장자를 PDF로 위장', { fileName: 'resume.pdf.exe', contentType: PDF }],
    ])('%s는 415 UNSUPPORTED_FILE_TYPE', async (_label, over) => {
      await expectCode(service.createUploadUrl(CEO, { ...DTO, ...over }), HttpException, 'UNSUPPORTED_FILE_TYPE', 415);
      expect(prismaMock.resumeFile.create).not.toHaveBeenCalled();
    });

    it('10MB 초과는 413 FILE_TOO_LARGE, 정확히 10MB는 허용', async () => {
      await expectCode(service.createUploadUrl(CEO, { ...DTO, fileSize: RESUME_MAX_BYTES + 1 }), HttpException, 'FILE_TOO_LARGE', 413);
      expect(prismaMock.resumeFile.create).not.toHaveBeenCalled();

      await expect(service.createUploadUrl(CEO, { ...DTO, fileSize: RESUME_MAX_BYTES })).resolves.toMatchObject({ resumeFileId: 'resume-1' });
    });

    it('AGREED 동의가 없으면 403 CONSENT_NOT_GIVEN', async () => {
      prismaMock.referralConsent.findFirst.mockResolvedValue(null);
      await expectCode(service.createUploadUrl(CEO, DTO), ForbiddenException, 'CONSENT_NOT_GIVEN');
      expect(prismaMock.referralConsent.findFirst).toHaveBeenCalledWith({
        where: { employeeId: 'emp-1', status: 'AGREED' },
        select: { id: true },
      });
    });

    it('다른 기업 직원 403 FORBIDDEN, 없는 직원 404', async () => {
      prismaMock.employee.findUnique.mockResolvedValueOnce({ id: 'emp-1', companyId: 'comp-other' });
      await expectCode(service.createUploadUrl(CEO, DTO), ForbiddenException, 'FORBIDDEN');
      prismaMock.employee.findUnique.mockResolvedValueOnce(null);
      await expectCode(service.createUploadUrl(CEO, DTO), NotFoundException, 'EMPLOYEE_NOT_FOUND');
    });

    it('저장소가 설정되지 않았으면 503 STORAGE_NOT_CONFIGURED이고 메타데이터를 남기지 않는다', async () => {
      storageMock.isConfigured.mockReturnValue(false);
      await expectCode(service.createUploadUrl(CEO, DTO), ServiceUnavailableException, 'STORAGE_NOT_CONFIGURED');
      expect(prismaMock.resumeFile.create).not.toHaveBeenCalled();
    });

    it('파일 이름의 경로 문자를 제거해 객체 키에 넣는다', async () => {
      const result = await service.createUploadUrl(CEO, { ...DTO, fileName: '../../etc/../김민준_이력서.pdf' });
      expect(result.objectKey).toMatch(/\/김민준_이력서\.pdf$/);
      expect(result.objectKey).not.toContain('..');
    });
  });

  describe('sanitizeFileName', () => {
    it.each([
      ['C:\\Users\\me\\resume.pdf', 'resume.pdf'],
      ['../../secret/resume.pdf', 'resume.pdf'],
      ['..resume..pdf', 'resume.pdf'],
      ['re\u0000su\u001fme.pdf', 'resume.pdf'],
      ['/', 'resume'],
    ])('%p → %p', (input, expected) => {
      expect(sanitizeFileName(input)).toBe(expected);
    });
  });

  describe('confirmUploaded', () => {
    const stored = (over: Record<string, unknown> = {}) => ({
      id: 'resume-1',
      companyId: 'comp-1',
      employeeId: 'emp-1',
      objectKey: 'referral-resumes/comp-1/u/resume.pdf',
      fileName: 'resume.pdf',
      contentType: PDF,
      fileSize: 524288,
      uploadedAt: null,
      createdAt: new Date(),
      ...over,
    });

    beforeEach(() => {
      prismaMock.resumeFile.findUnique.mockResolvedValue(stored());
    });

    it('스토리지 객체가 신고 값과 같으면 uploadedAt을 기록하고 반환', async () => {
      storageMock.headObject.mockResolvedValue({ contentLength: 524288, contentType: 'application/pdf; charset=binary' });

      const result = await service.confirmUploaded('resume-1', 'comp-1', 'emp-1');

      expect(result.uploadedAt).toBeInstanceOf(Date);
      expect(storageMock.headObject).toHaveBeenCalledWith('referral-resumes/comp-1/u/resume.pdf');
      expect(prismaMock.resumeFile.updateMany).toHaveBeenCalledWith({
        where: { id: 'resume-1', uploadedAt: null },
        data: { uploadedAt: result.uploadedAt },
      });
    });

    it('이미 확인된 파일은 스토리지를 다시 조회하지 않고 그대로 반환', async () => {
      const uploadedAt = new Date('2026-05-04T00:00:00Z');
      prismaMock.resumeFile.findUnique.mockResolvedValue(stored({ uploadedAt }));

      await expect(service.confirmUploaded('resume-1', 'comp-1', 'emp-1')).resolves.toMatchObject({ uploadedAt });
      expect(storageMock.headObject).not.toHaveBeenCalled();
    });

    it('스토리지에 객체가 없으면 422 RESUME_NOT_UPLOADED', async () => {
      storageMock.headObject.mockResolvedValue(null);
      await expectCode(service.confirmUploaded('resume-1', 'comp-1', 'emp-1'), UnprocessableEntityException, 'RESUME_NOT_UPLOADED');
      expect(prismaMock.resumeFile.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['크기 다름', { contentLength: 1, contentType: PDF }],
      ['타입 다름', { contentLength: 524288, contentType: DOCX }],
      ['타입 없음', { contentLength: 524288, contentType: null }],
    ])('%s이면 422 RESUME_MISMATCH', async (_label, head) => {
      storageMock.headObject.mockResolvedValue(head);
      await expectCode(service.confirmUploaded('resume-1', 'comp-1', 'emp-1'), UnprocessableEntityException, 'RESUME_MISMATCH');
      expect(prismaMock.resumeFile.updateMany).not.toHaveBeenCalled();
    });

    it('없거나 다른 기업·다른 직원의 파일이면 404 RESUME_NOT_FOUND', async () => {
      prismaMock.resumeFile.findUnique.mockResolvedValueOnce(null);
      await expectCode(service.confirmUploaded('nope', 'comp-1', 'emp-1'), NotFoundException, 'RESUME_NOT_FOUND');
      await expectCode(service.confirmUploaded('resume-1', 'comp-other', 'emp-1'), NotFoundException, 'RESUME_NOT_FOUND');
      await expectCode(service.confirmUploaded('resume-1', 'comp-1', 'emp-other'), NotFoundException, 'RESUME_NOT_FOUND');
      expect(storageMock.headObject).not.toHaveBeenCalled();
    });

    it('스토리지 조회 자체가 실패(권한 등)하면 그대로 오류를 던진다', async () => {
      storageMock.headObject.mockRejectedValue(new Error('AccessDenied'));
      await expect(service.confirmUploaded('resume-1', 'comp-1', 'emp-1')).rejects.toThrow('AccessDenied');
    });
  });
});
