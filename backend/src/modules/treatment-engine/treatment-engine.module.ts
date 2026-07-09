import { Module } from '@nestjs/common';
import { LevelsController } from './levels.controller';
import { LevelsService } from './levels.service';
import { TrainingCyclesController } from './training-cycles.controller';
import { TrainingCyclesService } from './training-cycles.service';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';

@Module({
  imports: [AuthModule, PatientAccessModule],
  controllers: [LevelsController, TrainingCyclesController, SamplesController],
  providers: [LevelsService, TrainingCyclesService, SamplesService],
  exports: [LevelsService, TrainingCyclesService, SamplesService],
})
export class TreatmentEngineModule {}
