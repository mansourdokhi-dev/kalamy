import { OtpPurpose } from '@prisma/client';
import { EmailOtpChannel } from './email-otp-channel';

const recipient = { mobile: '+966500000000', email: 'patient@example.com', fullName: 'Test Patient' };

describe('EmailOtpChannel', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('is disabled when SMTP env vars are not configured', () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    const channel = new EmailOtpChannel();

    expect(channel.isEnabled()).toBe(false);
  });

  it('is enabled when all required SMTP env vars are configured', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'no-reply@example.com';
    process.env.SMTP_PASSWORD = 'secret';
    const channel = new EmailOtpChannel();

    expect(channel.isEnabled()).toBe(true);
  });

  it('rejects if the recipient has no email address', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'no-reply@example.com';
    process.env.SMTP_PASSWORD = 'secret';
    const channel = new EmailOtpChannel();

    await expect(channel.send({ ...recipient, email: null }, '123456', OtpPurpose.REGISTRATION)).rejects.toThrow(
      'no email address on file',
    );
  });

  it('sends via the configured SMTP transport with the OTP code in the body', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_USER = 'no-reply@example.com';
    process.env.SMTP_PASSWORD = 'secret';
    process.env.SMTP_FROM = 'كلامي <no-reply@example.com>';
    const sendMail = jest.fn().mockResolvedValue(undefined);
    const channel = new EmailOtpChannel({ sendMail } as any);

    await channel.send(recipient, '123456', OtpPurpose.REGISTRATION);

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'كلامي <no-reply@example.com>',
        to: 'patient@example.com',
        subject: expect.any(String),
        text: expect.stringContaining('123456'),
      }),
    );
  });
});
