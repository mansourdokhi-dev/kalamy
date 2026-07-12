import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermission } from '../../common/rbac/require-permission.decorator';
import { Permission } from '../../common/rbac/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { PatientAccessService } from '../../common/patient-access/patient-access.service';
import { MediaStorageService } from './media-storage/media-storage.service';

@Controller('api/v1/patients/:patientId/sample-parts')
@UseGuards(SessionGuard, PermissionsGuard)
export class SampleMediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientAccessService: PatientAccessService,
    private readonly mediaStorageService: MediaStorageService,
  ) {}

  @Get(':partId/media')
  @RequirePermission(Permission.VIEW_CYCLE)
  async streamPartMedia(
    @Param('patientId') patientId: string,
    @Param('partId') partId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const profile = await this.prisma.patientProfile.findUnique({ where: { id: patientId } });
    if (!profile) {
      throw new NotFoundException('Patient profile not found');
    }
    await this.patientAccessService.assertCanAccess(user, profile);

    const part = await this.prisma.sampleSamplePart.findUnique({
      where: { id: partId },
      include: { speechSample: { include: { trainingCycle: true } } },
    });
    if (!part || part.speechSample.trainingCycle.patientProfileId !== patientId || !part.recordingUrl || !part.mimeType) {
      throw new NotFoundException('Sample part media not found');
    }

    res.setHeader('Content-Type', part.mimeType);
    const stream = this.mediaStorageService.createReadStream(part.recordingUrl);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).end();
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  }
}
