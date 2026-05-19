import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response_message';

/**
 * 컨트롤러 응답 메시지 커스터마이즈 데코레이터
 *
 * @example
 * @ResponseMessage('회원가입이 완료되었습니다.')
 */
export const ResponseMessage = (message: string) =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
