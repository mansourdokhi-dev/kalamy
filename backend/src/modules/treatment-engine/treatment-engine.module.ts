import { BadRequestException, Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { LevelsController } from './levels.controller';
import { LevelsService } from './levels.service';
import { TrainingCyclesController } from './training-cycles.controller';
import { TrainingCyclesService } from './training-cycles.service';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';
import { SampleMediaController } from './sample-media.controller';
import { SpecialistReviewController } from './specialist-review.controller';
import { SpecialistReviewQueueController } from './specialist-review-queue.controller';
import { SpecialistReviewService } from './specialist-review.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';
import { MediaStorageModule } from './media-storage/media-storage.module';
import { MediaStorageService } from './media-storage/media-storage.service';

@Module({
  imports: [
    AuthModule,
    PatientAccessModule,
    MediaStorageModule,
    // Registered here (rather than options passed directly to `FileInterceptor` in
    // SamplesController) because Multer's diskStorage `destination` callback runs
    // outside Nest's request DI context and can't use constructor injection or
    // `req.app.get(token)`. `MulterModule.registerAsync` resolves MediaStorageService
    // once via Nest's DI at module-init time and publishes the resulting options
    // under MULTER_MODULE_OPTIONS; `FileInterceptor('audio')` (with no local options)
    // picks them up automatically because its mixin optionally injects that same
    // token and merges it with any local options.
    MulterModule.registerAsync({
      imports: [MediaStorageModule],
      inject: [MediaStorageService],
      useFactory: (mediaStorageService: MediaStorageService) => ({
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            cb(null, mediaStorageService.getUploadDir());
          },
          filename: (_req, file, cb) => {
            cb(null, `${randomUUID()}${extname(file.originalname)}`);
          },
        }),
        limits: { fileSize: 100 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => {
          if (!file.mimetype.startsWith('video/')) {
            cb(new BadRequestException('Only video files are accepted'), false);
            return;
          }
          cb(null, true);
        },
      }),
    }),
  ],
  controllers: [LevelsController, TrainingCyclesController, SamplesController, SampleMediaController, SpecialistReviewController, SpecialistReviewQueueController],
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService],
})
export class TreatmentEngineModule {}
