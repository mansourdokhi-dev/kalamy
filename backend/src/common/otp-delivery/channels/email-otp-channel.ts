import { Injectable, Logger, Optional } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { OtpPurpose } from '@prisma/client';
import { OtpDeliveryChannel, OtpRecipient } from '../otp-delivery.types';

const PURPOSE_SUBJECTS: Record<OtpPurpose, string> = {
  REGISTRATION: 'رمز تفعيل حسابك في كلامي',
  PASSWORD_RESET: 'رمز إعادة تعيين كلمة المرور - كلامي',
};

@Injectable()
export class EmailOtpChannel implements OtpDeliveryChannel {
  readonly name = 'email';
  private readonly logger = new Logger(EmailOtpChannel.name);
  private readonly transporter: Pick<Transporter, 'sendMail'>;

  // Accepts an injected transporter so tests never open a real SMTP connection —
  // production code (see otp-delivery.module.ts) always calls this with no
  // argument, which builds the real nodemailer transport from env vars.
  constructor(@Optional() transporter?: Pick<Transporter, 'sendMail'>) {
    this.transporter =
      transporter ??
      createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      });
  }

  isEnabled(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
  }

  async send(recipient: OtpRecipient, code: string, purpose: OtpPurpose): Promise<void> {
    if (!recipient.email) {
      throw new Error('Cannot send OTP by email: recipient has no email address on file');
    }
    const subject = PURPOSE_SUBJECTS[purpose];
    const text = `مرحبًا ${recipient.fullName}،\n\nرمز التحقق الخاص بك هو: ${code}\n\nهذا الرمز صالح لمدة 5 دقائق. إذا لم تطلب هذا الرمز، يمكنك تجاهل هذه الرسالة.\n\nفريق كلامي`;

    await this.transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: recipient.email,
      subject,
      text,
    });
    this.logger.log(`Sent OTP email for purpose ${purpose} to ${recipient.email}`);
  }
}
