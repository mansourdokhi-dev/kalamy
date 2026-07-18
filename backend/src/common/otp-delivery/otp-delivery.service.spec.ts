import { OtpPurpose } from '@prisma/client';
import { OtpDeliveryService } from './otp-delivery.service';
import { OtpDeliveryChannel, OtpRecipient } from './otp-delivery.types';

function makeChannel(name: string, opts: { enabled?: boolean; sendImpl?: () => Promise<void> } = {}): OtpDeliveryChannel {
  return {
    name,
    isEnabled: jest.fn(() => opts.enabled ?? true),
    send: jest.fn(opts.sendImpl ?? (() => Promise.resolve())),
  };
}

const recipient: OtpRecipient = { mobile: '+966500000000', email: 'patient@example.com', fullName: 'Test Patient' };

describe('OtpDeliveryService', () => {
  it('delivers via the first enabled channel, in priority order', async () => {
    const whatsapp = makeChannel('whatsapp');
    const email = makeChannel('email');
    const service = new OtpDeliveryService([whatsapp, email]);

    const result = await service.deliver(recipient, '123456', OtpPurpose.REGISTRATION);

    expect(whatsapp.send).toHaveBeenCalledWith(recipient, '123456', OtpPurpose.REGISTRATION);
    expect(email.send).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: true, channel: 'whatsapp' });
  });

  it('skips a disabled channel and falls through to the next enabled one', async () => {
    const whatsapp = makeChannel('whatsapp', { enabled: false });
    const email = makeChannel('email');
    const service = new OtpDeliveryService([whatsapp, email]);

    const result = await service.deliver(recipient, '123456', OtpPurpose.REGISTRATION);

    expect(whatsapp.send).not.toHaveBeenCalled();
    expect(email.send).toHaveBeenCalledWith(recipient, '123456', OtpPurpose.REGISTRATION);
    expect(result).toEqual({ delivered: true, channel: 'email' });
  });

  it('falls through to the next channel if the first enabled one throws', async () => {
    const whatsapp = makeChannel('whatsapp', { sendImpl: () => Promise.reject(new Error('network down')) });
    const email = makeChannel('email');
    const service = new OtpDeliveryService([whatsapp, email]);

    const result = await service.deliver(recipient, '123456', OtpPurpose.REGISTRATION);

    expect(whatsapp.send).toHaveBeenCalled();
    expect(email.send).toHaveBeenCalled();
    expect(result).toEqual({ delivered: true, channel: 'email' });
  });

  it('returns delivered:false and does not throw when no channel is enabled', async () => {
    const whatsapp = makeChannel('whatsapp', { enabled: false });
    const email = makeChannel('email', { enabled: false });
    const service = new OtpDeliveryService([whatsapp, email]);

    const result = await service.deliver(recipient, '123456', OtpPurpose.REGISTRATION);

    expect(result).toEqual({ delivered: false });
  });

  it('returns delivered:false and does not throw when every enabled channel fails', async () => {
    const whatsapp = makeChannel('whatsapp', { sendImpl: () => Promise.reject(new Error('down')) });
    const email = makeChannel('email', { sendImpl: () => Promise.reject(new Error('also down')) });
    const service = new OtpDeliveryService([whatsapp, email]);

    const result = await service.deliver(recipient, '123456', OtpPurpose.REGISTRATION);

    expect(result).toEqual({ delivered: false });
  });
});
