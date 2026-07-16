import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { buildThrottlerOptions } from './throttler-config';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { TreatmentPlansModule } from './modules/treatment-plans/treatment-plans.module';
import { ProgressModule } from './modules/progress/progress.module';
import { ComplaintsModule } from './modules/complaints/complaints.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';
import { SupervisionModule } from './modules/supervision/supervision.module';
import { TreatmentEngineModule } from './modules/treatment-engine/treatment-engine.module';
import { ConsultationsModule } from './modules/consultations/consultations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot(buildThrottlerOptions()),
    PrismaModule,
    AuthModule,
    PatientsModule,
    ExercisesModule,
    AssessmentsModule,
    TreatmentPlansModule,
    ProgressModule,
    ComplaintsModule,
    ReportsModule,
    AdminUsersModule,
    SupervisionModule,
    TreatmentEngineModule,
    ConsultationsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
