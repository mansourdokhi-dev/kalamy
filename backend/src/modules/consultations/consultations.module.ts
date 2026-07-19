import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { ConsultationRemindersService } from './consultation-reminders.service';
import { ConsultationSlotsController } from './consultation-slots.controller';
import { ConsultationSlotsService } from './consultation-slots.service';
import { AuthModule } from '../auth/auth.module';
import { PatientAccessModule } from '../../common/patient-access/patient-access.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, PatientAccessModule, NotificationsModule],
  controllers: [ConsultationsController, ConsultationSlotsController],
  providers: [ConsultationsService, ConsultationRemindersService, ConsultationSlotsService],
  exports: [ConsultationsService, ConsultationRemindersService, ConsultationSlotsService],
})
export class ConsultationsModule {}
