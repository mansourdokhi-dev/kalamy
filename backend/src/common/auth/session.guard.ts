import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { hashToken } from '../security/token-hash.util';
import { AuthenticatedUser } from './authenticated-user.interface';

export type { AuthenticatedUser } from './authenticated-user.interface';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    const tokenHash = hashToken(token);

    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    request.user = { id: session.user.id, role: session.user.role, sessionId: session.id };
    return true;
  }
}
