import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

const NOTIFICATION_TEMPLATES: Record<NotificationType, (ctx: Record<string, string>) => { title: string; body: string }> = {
  SAMPLE_ESCALATED_TO_SUPERVISOR: (ctx) => ({
    title: 'عينة متأخرة تحتاج متابعة',
    body: `لم يتم حجز عينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} خلال 24 ساعة من رفعها.`,
  }),
  SPECIALIST_DECISION_ISSUED: (ctx) => ({
    title: 'قرار الأخصائي جاهز',
    body: `صدر قرار الأخصائي (${ctx.decision}) بخصوص المستوى ${ctx.levelName}.`,
  }),
  INTERVENTION_TIMED_OUT: (ctx) => ({
    title: 'تدخل متأخر يحتاج تصعيد',
    body: `لم يُنفَّذ التدخل المطلوب لعينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} خلال 7 أيام.`,
  }),
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    recipientUserId: string,
    type: NotificationType,
    context: Record<string, string>,
    related?: { entity: string; entityId: string },
  ): Promise<Notification> {
    const { title, body } = NOTIFICATION_TEMPLATES[type](context);
    return this.prisma.notification.create({
      data: { recipientUserId, type, title, body, relatedEntity: related?.entity, relatedEntityId: related?.entityId },
    });
  }

  async notifyRole(
    role: Role,
    type: NotificationType,
    context: Record<string, string>,
    related?: { entity: string; entityId: string },
  ): Promise<Notification[]> {
    const recipients = await this.prisma.user.findMany({ where: { role }, select: { id: true } });
    return Promise.all(recipients.map((r) => this.create(r.id, type, context, related)));
  }

  async listForUser(userId: string): Promise<Notification[]> {
    return this.prisma.notification.findMany({ where: { recipientUserId: userId }, orderBy: { createdAt: 'desc' } });
  }

  async markRead(notificationId: string, actor: AuthenticatedUser): Promise<Notification> {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.recipientUserId !== actor.id) {
      throw new ForbiddenException('This notification does not belong to you');
    }
    return this.prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }
}
