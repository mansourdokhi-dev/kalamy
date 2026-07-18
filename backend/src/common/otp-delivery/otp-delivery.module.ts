import { Module } from '@nestjs/common';
import { OtpDeliveryService } from './otp-delivery.service';
import { OTP_DELIVERY_CHANNELS } from './otp-delivery.constants';
import { EmailOtpChannel } from './channels/email-otp-channel';
import { WhatsAppOtpChannel } from './channels/whatsapp-otp-channel';

@Module({
  providers: [
    EmailOtpChannel,
    WhatsAppOtpChannel,
    {
      // Priority order: WhatsApp first (matches the founder's stated
      // preference), falling back to email — see otp-delivery.service.ts.
      // WhatsApp stays disabled (isEnabled() false) until its env vars are
      // set, so in practice this resolves to email-only for now.
      provide: OTP_DELIVERY_CHANNELS,
      useFactory: (whatsapp: WhatsAppOtpChannel, email: EmailOtpChannel) => [whatsapp, email],
      inject: [WhatsAppOtpChannel, EmailOtpChannel],
    },
    OtpDeliveryService,
  ],
  exports: [OtpDeliveryService],
})
export class OtpDeliveryModule {}
