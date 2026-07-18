import { OtpPurpose } from '@prisma/client';
import { WhatsAppOtpChannel } from './whatsapp-otp-channel';

const recipient = { mobile: '+966500000000', email: null, fullName: 'Test Patient' };

describe('WhatsAppOtpChannel', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('is disabled when the WhatsApp Business API credentials are not configured (the default today)', () => {
    delete process.env.WHATSAPP_BUSINESS_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const channel = new WhatsAppOtpChannel();

    expect(channel.isEnabled()).toBe(false);
  });

  it('is enabled once both credentials are configured', () => {
    process.env.WHATSAPP_BUSINESS_API_TOKEN = 'token-123';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id-456';
    const channel = new WhatsAppOtpChannel();

    expect(channel.isEnabled()).toBe(true);
  });

  it('posts to the Meta Cloud API with the OTP code in the message body', async () => {
    process.env.WHATSAPP_BUSINESS_API_TOKEN = 'token-123';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id-456';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('{}') });
    global.fetch = fetchMock as any;
    const channel = new WhatsAppOtpChannel();

    await channel.send(recipient, '123456', OtpPurpose.REGISTRATION);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/phone-id-456/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token-123' }),
        body: expect.stringContaining('123456'),
      }),
    );
  });

  it('throws when the Meta API responds with a non-OK status', async () => {
    process.env.WHATSAPP_BUSINESS_API_TOKEN = 'token-123';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id-456';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve('invalid token') }) as any;
    const channel = new WhatsAppOtpChannel();

    await expect(channel.send(recipient, '123456', OtpPurpose.REGISTRATION)).rejects.toThrow('WhatsApp API responded 401');
  });
});
