import { Module } from '@nestjs/common';
import { AccessLinkService } from './access-link.service';

@Module({
  providers: [AccessLinkService],
  exports: [AccessLinkService],
})
export class AccessLinkModule {}
