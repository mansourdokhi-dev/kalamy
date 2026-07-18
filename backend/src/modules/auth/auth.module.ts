import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordService } from '../../common/security/password.service';
import { SessionGuard } from '../../common/auth/session.guard';
import { OtpDeliveryModule } from '../../common/otp-delivery/otp-delivery.module';

@Module({
  imports: [OtpDeliveryModule],
  controllers: [AuthController],
  providers: [AuthService, OtpService, PasswordService, SessionGuard],
  exports: [PasswordService, SessionGuard],
})
export class AuthModule {}
