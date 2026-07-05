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

describe('hasPermission — clinical core', () => {
  it('allows a CLINICIAN to create an exercise', () => {
    expect(hasPermission('CLINICIAN', Permission.CREATE_EXERCISE)).toBe(true);
  });

  it('does not allow a PATIENT to create an exercise', () => {
    expect(hasPermission('PATIENT', Permission.CREATE_EXERCISE)).toBe(false);
  });

  it('allows a PATIENT to view an exercise', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_EXERCISE)).toBe(true);
  });

  it('allows a CLINICIAN to approve an assessment', () => {
    expect(hasPermission('CLINICIAN', Permission.APPROVE_ASSESSMENT)).toBe(true);
  });

  it('does not allow a CAREGIVER to approve an assessment', () => {
    expect(hasPermission('CAREGIVER', Permission.APPROVE_ASSESSMENT)).toBe(false);
  });

  it('allows a CAREGIVER to view a treatment plan (ownership enforced elsewhere)', () => {
    expect(hasPermission('CAREGIVER', Permission.VIEW_TREATMENT_PLAN)).toBe(true);
  });

  it('does not allow a SUPERVISOR to create a treatment plan', () => {
    expect(hasPermission('SUPERVISOR', Permission.CREATE_TREATMENT_PLAN)).toBe(false);
  });

  it('allows a SUPERVISOR to view a treatment plan', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_TREATMENT_PLAN)).toBe(true);
  });
});
