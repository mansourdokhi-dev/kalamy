import { calculateAge } from './patient-age.util';

describe('calculateAge', () => {
  it('calculates age when the birthday has already passed this year', () => {
    const dob = new Date('2010-01-15');
    const now = new Date('2026-06-01');
    expect(calculateAge(dob, now)).toBe(16);
  });

  it('calculates age when the birthday has not happened yet this year', () => {
    const dob = new Date('2010-12-15');
    const now = new Date('2026-06-01');
    expect(calculateAge(dob, now)).toBe(15);
  });

  it('calculates age correctly on the exact birthday', () => {
    const dob = new Date('2010-06-01');
    const now = new Date('2026-06-01');
    expect(calculateAge(dob, now)).toBe(16);
  });
});
