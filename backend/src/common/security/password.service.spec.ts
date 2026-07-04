import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password and verifies it matches', async () => {
    const hash = await service.hash('correct-horse-battery-staple');
    expect(await service.compare('correct-horse-battery-staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct-horse-battery-staple');
    expect(await service.compare('wrong-password', hash)).toBe(false);
  });
});
