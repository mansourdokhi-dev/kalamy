import { Injectable, Logger } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { OtpDeliveryChannel, OtpRecipient } from '../otp-delivery.types';

// Inert until the founder sets up a Meta WhatsApp Business Account and links it
// here — that's an account-creation step only the founder can take, not
// something this codebase can provision on its own (see
// docs/superpowers/plans/... MVP readiness report, 2026-07-17). isEnabled()
// stays false with no env vars configured, so OtpDeliveryService silently
// skips straight to the email channel until then.
//
// Uses the Meta Cloud API's free-form text message endpoint. Production OTP
// delivery to a user outside WhatsApp's 24h "session window" (which a brand
// new user always is) typically requires a pre-approved authentication
// message TEMPLATE rather than free-form text — that template still needs to
// be created and approved in Meta Business Manager once the account exists.
// This implementation is the correct shape for that switch but has not been
// tested against the real API (no credentials exist to test with).
@Injectable()
export class WhatsAppOtpChannel implements OtpDeliveryChannel {
  readonly name = 'whatsapp';
  private readonly logger = new Logger(WhatsAppOtpChannel.name);

  isEnabled(): boolean {
    return Boolean(process.env.WHATSAPP_BUSINESS_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  }

  async send(recipient: OtpRecipient, code: string, purpose: OtpPurpose): Promise<void> {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const token = process.env.WHATSAPP_BUSINESS_API_TOKEN;
    const body = purposeMessage(code, purpose);

    const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient.mobile.replace(/^\+/, ''),
        type: 'text',
        text: { body },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`WhatsApp API responded ${response.status}: ${detail}`);
    }
    this.logger.log(`Sent OTP WhatsApp message for purpose ${purpose} to ${recipient.mobile}`);
  }
}

function purposeMessage(code: string, purpose: OtpPurpose): string {
  const context = purpose === OtpPurpose.PASSWORD_RESET ? 'رمز إعادة تعيين كلمة المرور' : 'رمز تفعيل حسابك';
  return `كلامي: ${context} هو ${code}. صالح لمدة 5 دقائق.`;
}
