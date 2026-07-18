import { Inject, Injectable, Logger } from '@nestjs/common';
import { OtpPurpose } from '@prisma/client';
import { OTP_DELIVERY_CHANNELS } from './otp-delivery.constants';
import { OtpDeliveryChannel, OtpRecipient } from './otp-delivery.types';

export type OtpDeliveryResult = { delivered: true; channel: string } | { delivered: false };

// Channels are tried in the order they're provided (see otp-delivery.module.ts —
// WhatsApp first, then email) and the first one that's both enabled (has its
// required credentials configured) and succeeds wins. A channel failing or
// being unconfigured must never throw out of here: OTP issuance itself already
// succeeded (the code is stored and verifiable), and the caller falls back to
// devOtpCode in DEV_MODE — this only decides whether a real user also got a
// message, mirroring the "never let a notification failure block the primary
// operation" pattern already used elsewhere in this codebase.
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(@Inject(OTP_DELIVERY_CHANNELS) private readonly channels: OtpDeliveryChannel[]) {}

  async deliver(recipient: OtpRecipient, code: string, purpose: OtpPurpose): Promise<OtpDeliveryResult> {
    for (const channel of this.channels) {
      if (!channel.isEnabled()) {
        continue;
      }
      try {
        await channel.send(recipient, code, purpose);
        return { delivered: true, channel: channel.name };
      } catch (err) {
        this.logger.error(`OTP delivery via ${channel.name} failed for ${recipient.mobile}: ${err}`);
      }
    }
    this.logger.warn(`No OTP delivery channel succeeded for ${recipient.mobile} (purpose ${purpose}) — code was generated but not delivered`);
    return { delivered: false };
  }
}
