import { Module } from '@nestjs/common';
import { PatientAccessService } from './patient-access.service';

@Module({
  providers: [PatientAccessService],
  exports: [PatientAccessService],
})
export class PatientAccessModule {}
