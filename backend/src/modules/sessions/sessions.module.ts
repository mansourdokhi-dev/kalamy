import { Module } from '@nestjs/common';
import { SessionTemplatesController } from './session-templates.controller';
import { SessionTemplatesService } from './session-templates.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SessionTemplatesController],
  providers: [SessionTemplatesService],
  exports: [SessionTemplatesService],
})
export class SessionsModule {}
