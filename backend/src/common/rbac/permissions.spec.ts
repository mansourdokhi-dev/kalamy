import { hasPermission, Permission } from './permissions';

describe('hasPermission', () => {
  it('allows a CLINICIAN to create a patient profile', () => {
    expect(hasPermission('CLINICIAN', Permission.CREATE_PATIENT_PROFILE)).toBe(true);
  });

  it('does not allow a PATIENT to create a patient profile', () => {
    expect(hasPermission('PATIENT', Permission.CREATE_PATIENT_PROFILE)).toBe(false);
  });

  it('allows a PATIENT to view a patient profile (ownership enforced elsewhere)', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_PATIENT_PROFILE)).toBe(true);
  });

  it('does not allow a SUPERVISOR to disable a patient profile', () => {
    expect(hasPermission('SUPERVISOR', Permission.DISABLE_PATIENT_PROFILE)).toBe(false);
  });

  it('allows an ADMIN to manage users', () => {
    expect(hasPermission('ADMIN', Permission.MANAGE_USERS)).toBe(true);
  });
});
