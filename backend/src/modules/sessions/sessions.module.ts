import { Module } from '@nestjs/common';
import { SessionTemplatesController } from './session-templates.controller';
import { SessionTemplatesService } from './session-templates.service';
import { PatientSessionsController } from './patient-sessions.controller';
import { PatientSessionsService } from './patient-sessions.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';

@Module({
  imports: [AuthModule, PatientAccessModule],
  controllers: [SessionTemplatesController, PatientSessionsController],
  providers: [SessionTemplatesService, PatientSessionsService],
  exports: [SessionTemplatesService, PatientSessionsService],
})
export class SessionsModule {}
