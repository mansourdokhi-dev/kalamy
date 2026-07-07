import { Module } from '@nestjs/common';
import { SupervisionController } from './supervision.controller';
import { SupervisionService } from './supervision.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SupervisionController],
  providers: [SupervisionService],
  exports: [SupervisionService],
})
export class SupervisionModule {}
