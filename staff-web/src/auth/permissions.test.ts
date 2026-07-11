import { canEditClinicalData } from './permissions';

describe('canEditClinicalData', () => {
  it('returns true for CLINICIAN', () => {
    expect(canEditClinicalData('CLINICIAN')).toBe(true);
  });

  it('returns true for ADMIN', () => {
    expect(canEditClinicalData('ADMIN')).toBe(true);
  });

  it('returns false for SUPERVISOR', () => {
    expect(canEditClinicalData('SUPERVISOR')).toBe(false);
  });
});
