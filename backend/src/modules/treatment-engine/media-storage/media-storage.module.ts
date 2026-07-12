import { Module } from '@nestjs/common';
import { MediaStorageService, LocalDiskMediaStorageService } from './media-storage.service';

@Module({
  providers: [
    {
      provide: MediaStorageService,
      // useFactory (not useClass) deliberately bypasses Nest's constructor-parameter
      // DI resolution: LocalDiskMediaStorageService's constructor takes a plain
      // `string` (rootDir), which Nest cannot resolve as an injectable type. Calling
      // it with no arguments here lets its own default parameter (process.cwd())
      // apply, exactly as it does when a test constructs it directly with `new`.
      useFactory: () => new LocalDiskMediaStorageService(),
    },
  ],
  exports: [MediaStorageService],
})
export class MediaStorageModule {}
