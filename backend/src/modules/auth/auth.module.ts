import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { PasswordService } from '../../common/security/password.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, OtpService, PasswordService],
  exports: [PasswordService],
})
export class AuthModule {}
