import { Module } from '@nestjs/common';
import { MediaStorageService, LocalDiskMediaStorageService } from './media-storage.service';

@Module({
  providers: [{ provide: MediaStorageService, useClass: LocalDiskMediaStorageService }],
  exports: [MediaStorageService],
})
export class MediaStorageModule {}
