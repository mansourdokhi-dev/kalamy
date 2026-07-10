import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import type { Request } from 'express';
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

@Controller('api/v1/patients/:patientId/cycles/current/sample-session')
@UseGuards(SessionGuard, PermissionsGuard)
export class SamplesController {
  constructor(
    private readonly samplesService: SamplesService,
    private readonly trainingCyclesService: TrainingCyclesService,
  ) {}

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
          const dir = join(process.cwd(), 'uploads', 'audio');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('audio/')) {
          cb(new BadRequestException('Only audio files are accepted'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadRecording(
    @Param('patientId') patientId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.trainingCyclesService.getCurrent(patientId, user);
    if (!file) {
      throw new BadRequestException('No audio file provided');
    }
    return { url: `${req.protocol}://${req.get('host')}/uploads/audio/${file.filename}` };
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
