import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SamplesService } from './samples.service';
import { TrainingCyclesService } from './training-cycles.service';
import { MediaStorageService } from './media-storage/media-storage.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { RecordAttemptDto } from './dto/record-attempt.dto';
import { SubmitSampleDto } from './dto/submit-sample.dto';
import { RerecordPartsDto } from './dto/rerecord-parts.dto';

@Controller('api/v1/patients/:patientId/cycles/current/sample-session')
@UseGuards(SessionGuard, PermissionsGuard)
export class SamplesController {
  constructor(
    private readonly samplesService: SamplesService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly mediaStorageService: MediaStorageService,
  ) {}

  @Post()
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async openSession(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.openSession(current.id, user);
  }

  @Post('upload')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  // Storage/limits/fileFilter come from TreatmentEngineModule's MulterModule.registerAsync
  // registration (which resolves MediaStorageService via Nest DI). FileInterceptor's mixin
  // optionally injects those module-level options and merges them with any options passed
  // here, so intentionally passing none keeps this endpoint on the DI-resolved config.
  @UseInterceptors(FileInterceptor('audio'))
  async uploadRecording(
    @Param('patientId') patientId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.trainingCyclesService.getCurrent(patientId, user);
    if (!file) {
      throw new BadRequestException('No video file provided');
    }
    return { url: file.filename, mimeType: file.mimetype, fileSizeBytes: file.size };
  }

  @Post('attempts')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async recordAttempt(@Param('patientId') patientId: string, @Body() dto: RecordAttemptDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.recordAttempt(current.id, dto, user);
  }

  @Delete('attempts/:attemptId')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async deleteAttempt(
    @Param('patientId') patientId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.deleteAttempt(current.id, attemptId, user);
  }

  @Get('attempts')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async listAttempts(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.listAttempts(current.id, user);
  }

  @Get('attempts/:attemptId/media')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async streamAttemptMedia(
    @Param('patientId') patientId: string,
    @Param('attemptId') attemptId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    const attempt = await this.samplesService.findAttemptOrThrow(current.id, attemptId, user);
    res.setHeader('Content-Type', attempt.mimeType);
    const stream = this.mediaStorageService.createReadStream(attempt.recordingUrl);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).end();
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  }

  @Post('submit')
  @RequirePermission(Permission.SUBMIT_SAMPLE)
  async submitSample(@Param('patientId') patientId: string, @Body() dto: SubmitSampleDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.submitSample(current.id, dto, user);
  }

  @Post('rerecord')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async rerecordDamagedParts(@Param('patientId') patientId: string, @Body() dto: RerecordPartsDto, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.rerecordDamagedParts(current.id, dto, user);
  }
}
