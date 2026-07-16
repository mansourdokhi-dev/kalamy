import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, minutes } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';

// Stricter than the global 60/min default (throttler-config.ts): these routes are
// unauthenticated, cheap to spam, and each hides a real cost — register/forgot-password
// issue an OTP (real SMS-provider cost per request), login has a per-account (not
// per-IP) lockout that this closes the gap on. 10/min per IP still comfortably covers
// legitimate retries (a mistyped password, a family sharing one IP) while meaningfully
// slowing down automated abuse across many accounts from one source.
const AUTH_SENSITIVE_THROTTLE = { default: { limit: 10, ttl: minutes(1) } };

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify')
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  verify(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyRegistration(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, userAgent);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle(AUTH_SENSITIVE_THROTTLE)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ reset: true }> {
    await this.authService.resetPassword(dto);
    return { reset: true };
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.logout(user.sessionId);
  }

  @Get('sessions')
  @UseGuards(SessionGuard)
  listSessions(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @UseGuards(SessionGuard)
  @HttpCode(204)
  async revokeSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.authService.revokeSession(user.id, id);
  }

  @Post('change-password')
  @UseGuards(SessionGuard)
  @HttpCode(200)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedUser): Promise<{ changed: true }> {
    await this.authService.changePassword(user.id, dto);
    return { changed: true };
  }
}
