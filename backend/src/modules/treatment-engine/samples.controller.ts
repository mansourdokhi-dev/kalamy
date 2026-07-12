import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { SamplesService } from './samples.service';
import { TrainingCyclesService } from './training-cycles.service';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { RecordAttemptDto } from './dto/record-attempt.dto';
import { SubmitSampleDto } from './dto/submit-sample.dto';
import { RerecordPartsDto } from './dto/rerecord-parts.dto';
import { MediaStorageService } from './media-storage/media-storage.service';

@Controller('api/v1/patients/:patientId/cycles/current/sample-session')
@UseGuards(SessionGuard, PermissionsGuard)
export class SamplesController {
  // Multer's diskStorage `destination` callback runs outside Nest's request
  // DI context (it's invoked directly by the underlying storage engine, not
  // by Nest's interceptor pipeline) and is wired up via decorator metadata
  // evaluated once at class-definition time, before any controller instance
  // exists — so it cannot close over `this` or use constructor injection.
  // `req.app.get(token)` does not help either: `req.app` is the raw Express
  // instance, and its `.get()` is Express's app-settings getter, not Nest's
  // DI resolver (verified: it returns `undefined` for a class token).
  // SamplesController is a default (singleton) provider, so its constructor
  // runs once per application instance, before any request is handled;
  // stashing the resolved instance on this static field makes it safely
  // available to the callback below.
  private static mediaStorageServiceInstance: MediaStorageService;

  constructor(
    private readonly samplesService: SamplesService,
    private readonly trainingCyclesService: TrainingCyclesService,
    private readonly mediaStorageService: MediaStorageService,
  ) {
    SamplesController.mediaStorageServiceInstance = mediaStorageService;
  }

  @Post()
  @RequirePermission(Permission.PREPARE_SAMPLE)
  async openSession(@Param('patientId') patientId: string, @CurrentUser() user: AuthenticatedUser) {
    const current = await this.trainingCyclesService.getCurrent(patientId, user);
    return this.samplesService.openSession(current.id, user);
  }

  @Post('upload')
  @RequirePermission(Permission.PREPARE_SAMPLE)
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          cb(null, SamplesController.mediaStorageServiceInstance.getUploadDir());
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 100 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('video/')) {
          cb(new BadRequestException('Only video files are accepted'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
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
