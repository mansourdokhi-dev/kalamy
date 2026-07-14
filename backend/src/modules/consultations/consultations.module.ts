import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { ConsultationRemindersService } from './consultation-reminders.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, PatientAccessModule, NotificationsModule],
  controllers: [ConsultationsController],
  providers: [ConsultationsService, ConsultationRemindersService],
  exports: [ConsultationsService, ConsultationRemindersService],
})
export class ConsultationsModule {}
