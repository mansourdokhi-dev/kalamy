import { Module } from '@nestjs/common';
import { LevelsController } from './levels.controller';
import { LevelsService } from './levels.service';
import { TrainingCyclesController } from './training-cycles.controller';
import { TrainingCyclesService } from './training-cycles.service';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';
import { SpecialistReviewController } from './specialist-review.controller';
import { SpecialistReviewService } from './specialist-review.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';
import { MediaStorageModule } from './media-storage/media-storage.module';

@Module({
  imports: [AuthModule, PatientAccessModule, MediaStorageModule],
  controllers: [LevelsController, TrainingCyclesController, SamplesController, SpecialistReviewController],
  providers: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService],
  exports: [LevelsService, TrainingCyclesService, SamplesService, SpecialistReviewService],
})
export class TreatmentEngineModule {}
