import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './require-permission.decorator';
import { hasPermission, Permission } from './permissions';
import { AuthenticatedUser } from '../auth/authenticated-user.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<Permission | undefined>(PERMISSION_KEY, context.getHandler());
    if (!required) {
      return true;
    }
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new ForbiddenException('No authenticated user on request');
    }
    if (!hasPermission(request.user.role, required)) {
      throw new ForbiddenException(`Role ${request.user.role} lacks permission ${required}`);
    }
    return true;
  }
}
