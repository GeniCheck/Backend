import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

const configOf = (values: Record<string, string | undefined>) =>
  ({ get: jest.fn((key: string) => values[key]) }) as unknown as ConfigService;

const BASE_CONFIG = {
  STORAGE_ENDPOINT: 'https://storage.example.com',
  STORAGE_REGION: 'ap-northeast-2',
  STORAGE_BUCKET: 'genicheck-test',
  STORAGE_ACCESS_KEY: 'test-access-key',
  STORAGE_SECRET_KEY: 'test-secret-key',
  STORAGE_FORCE_PATH_STYLE: 'true',
};

describe('StorageService', () => {
  it('버킷이 비어 있으면 isConfigured=false', () => {
    expect(new StorageService(configOf({ ...BASE_CONFIG, STORAGE_BUCKET: '' })).isConfigured()).toBe(false);
    expect(new StorageService(configOf(BASE_CONFIG)).isConfigured()).toBe(true);
  });

  // presign은 네트워크 호출 없이 로컬에서 서명만 하므로 실제 SDK로 검증한다
  it('presignPut: 10분 만료 + Content-Type·Content-Length를 서명 헤더에 포함', async () => {
    const service = new StorageService(configOf(BASE_CONFIG));

    const url = new URL(await service.presignPut('referral-resumes/c/u/resume.pdf', 'application/pdf', 524288, 600));

    expect(url.origin).toBe('https://storage.example.com');
    expect(url.pathname).toBe('/genicheck-test/referral-resumes/c/u/resume.pdf'); // path-style
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
    expect(signed).toEqual(expect.arrayContaining(['content-type', 'content-length', 'host']));
  });

  it('presignGet: 지정한 만료 시간의 다운로드 URL', async () => {
    const service = new StorageService(configOf(BASE_CONFIG));

    const url = new URL(await service.presignGet('referral-resumes/c/u/resume.pdf', 300));

    expect(url.pathname).toBe('/genicheck-test/referral-resumes/c/u/resume.pdf');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  });

  describe('headObject', () => {
    let service: StorageService;
    let send: jest.SpyInstance;

    beforeEach(() => {
      service = new StorageService(configOf(BASE_CONFIG));
      send = jest.spyOn((service as any).client, 'send');
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    it('객체가 있으면 크기·타입을 반환', async () => {
      send.mockResolvedValue({ ContentLength: 524288, ContentType: 'application/pdf' });
      await expect(service.headObject('k')).resolves.toEqual({ contentLength: 524288, contentType: 'application/pdf' });
    });

    it.each([
      ['name NotFound', Object.assign(new Error('NotFound'), { name: 'NotFound' })],
      ['name NoSuchKey', Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })],
      ['HTTP 404', Object.assign(new Error('Unknown'), { name: 'Unknown', $metadata: { httpStatusCode: 404 } })],
    ])('객체가 없으면(%s) null', async (_label, error) => {
      send.mockRejectedValue(error);
      await expect(service.headObject('k')).resolves.toBeNull();
    });

    it('NotFound 외 오류(권한 403 등)는 그대로 던진다', async () => {
      const denied = Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
      send.mockRejectedValue(denied);
      await expect(service.headObject('k')).rejects.toBe(denied);
    });
  });
});
