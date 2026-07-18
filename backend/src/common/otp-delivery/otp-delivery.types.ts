import { OtpPurpose } from '@prisma/client';

export interface OtpRecipient {
  mobile: string;
  email: string | null;
  fullName: string;
}

export interface OtpDeliveryChannel {
  readonly name: string;
  isEnabled(): boolean;
  send(recipient: OtpRecipient, code: string, purpose: OtpPurpose): Promise<void>;
}
