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

describe('hasPermission — sessions and progress', () => {
  it('allows a CLINICIAN to manage session templates', () => {
    expect(hasPermission('CLINICIAN', Permission.MANAGE_SESSION_TEMPLATES)).toBe(true);
  });

  it('does not allow a PATIENT to manage session templates', () => {
    expect(hasPermission('PATIENT', Permission.MANAGE_SESSION_TEMPLATES)).toBe(false);
  });

  it('allows a PATIENT to start their program', () => {
    expect(hasPermission('PATIENT', Permission.START_SESSION)).toBe(true);
  });

  it('does not allow a CLINICIAN to start a session on a patient\'s behalf', () => {
    expect(hasPermission('CLINICIAN', Permission.START_SESSION)).toBe(false);
  });

  it('allows a CAREGIVER to submit a session sample', () => {
    expect(hasPermission('CAREGIVER', Permission.SUBMIT_SESSION)).toBe(true);
  });

  it('allows a CLINICIAN to review a session', () => {
    expect(hasPermission('CLINICIAN', Permission.REVIEW_SESSION)).toBe(true);
  });

  it('does not allow a PATIENT to review a session', () => {
    expect(hasPermission('PATIENT', Permission.REVIEW_SESSION)).toBe(false);
  });

  it('allows a SUPERVISOR to view progress', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_PROGRESS)).toBe(true);
  });
});
