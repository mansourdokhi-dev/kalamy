import { Module } from '@nestjs/common';
import { LevelsController } from './levels.controller';
import { LevelsService } from './levels.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';

@Module({
  imports: [AuthModule, PatientAccessModule],
  controllers: [LevelsController],
  providers: [LevelsService],
  exports: [LevelsService],
})
export class TreatmentEngineModule {}
