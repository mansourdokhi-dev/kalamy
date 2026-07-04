import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { SessionGuard, AuthenticatedUser } from '../../common/auth/session.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify')
  verify(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyRegistration(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string) {
    return this.authService.login(dto, userAgent);
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
}
