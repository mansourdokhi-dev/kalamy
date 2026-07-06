import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuditInterceptor } from './common/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { TreatmentPlansModule } from './modules/treatment-plans/treatment-plans.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { ProgressModule } from './modules/progress/progress.module';
import { ComplaintsModule } from './modules/complaints/complaints.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    PatientsModule,
    ExercisesModule,
    AssessmentsModule,
    TreatmentPlansModule,
    SessionsModule,
    ProgressModule,
    ComplaintsModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
