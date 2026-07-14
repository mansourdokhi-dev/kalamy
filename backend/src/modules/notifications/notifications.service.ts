import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Notification, NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/auth/session.guard';

const DECISION_LABELS: Record<string, string> = {
  TRANSITION: 'الانتقال إلى المستوى التالي',
  LEVEL_REPEAT: 'إعادة المستوى الحالي',
  TECHNICAL_RERECORD: 'طلب إعادة تسجيل بعض الأجزاء لأسباب تقنية',
};

const NOTIFICATION_TEMPLATES: Record<NotificationType, (ctx: Record<string, string>) => { title: string; body: string }> = {
  SAMPLE_ESCALATED_TO_SUPERVISOR: (ctx) => ({
    title: 'عينة متأخرة تحتاج متابعة',
    body: `لم يتم حجز عينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} خلال 24 ساعة من رفعها.`,
  }),
  SPECIALIST_DECISION_ISSUED: (ctx) => {
    const decisionLabel = DECISION_LABELS[ctx.decision] ?? ctx.decision;
    const isRerecord = ctx.decision === 'TECHNICAL_RERECORD';
    return {
      title: isRerecord ? 'مطلوب إعادة تسجيل جزء من العينة' : 'قرار الأخصائي جاهز',
      body: `${isRerecord ? 'أفاد الأخصائي بوجود' : 'صدر قرار الأخصائي'} (${decisionLabel}) بخصوص المستوى ${ctx.levelName}.`,
    };
  },
  INTERVENTION_TIMED_OUT: (ctx) => ({
    title: 'تدخل متأخر يحتاج تصعيد',
    body: `لم يُنفَّذ التدخل المطلوب لعينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} خلال 7 أيام.`,
  }),
  SAMPLE_ELIGIBLE_FOR_RECORDING: (ctx) => ({
    title: 'حان وقت تسجيل العينة',
    body: `أصبحت جاهزًا لتسجيل عينتك الصوتية في المستوى ${ctx.levelName}.`,
  }),
  SAMPLE_AVAILABLE_FOR_REVIEW: (ctx) => ({
    title: 'عينة جديدة بانتظار المراجعة',
    body: `عينة المريض ${ctx.patientName} في المستوى ${ctx.levelName} أصبحت متاحة للمراجعة.`,
  }),
  SAMPLE_SUBMISSION_REMINDER: (ctx) => ({
    title: 'تذكير بإرسال العينة',
    body: `لم ترسل عينتك الصوتية بعد في المستوى ${ctx.levelName}. يمكنك إرسالها الآن.`,
  }),
  SAMPLE_SUBMISSION_DELAYED_TO_SUPERVISOR: (ctx) => ({
    title: 'تأخر في إرسال عينة مريض',
    body: `لم يرسل المريض ${ctx.patientName} عينته في المستوى ${ctx.levelName} خلال المهلة المحددة.`,
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
