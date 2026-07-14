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

describe('hasPermission — progress', () => {
  it('allows a SUPERVISOR to view progress', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_PROGRESS)).toBe(true);
  });
});

describe('hasPermission — reports and complaints', () => {
  it('allows a PATIENT to submit a complaint', () => {
    expect(hasPermission('PATIENT', Permission.SUBMIT_COMPLAINT)).toBe(true);
  });

  it('does not allow a CLINICIAN to submit a complaint', () => {
    expect(hasPermission('CLINICIAN', Permission.SUBMIT_COMPLAINT)).toBe(false);
  });

  it('allows an ADMIN to manage complaints', () => {
    expect(hasPermission('ADMIN', Permission.MANAGE_COMPLAINTS)).toBe(true);
  });

  it('does not allow a CLINICIAN to manage complaints', () => {
    expect(hasPermission('CLINICIAN', Permission.MANAGE_COMPLAINTS)).toBe(false);
  });

  it('allows a CAREGIVER to view patient reports (ownership enforced elsewhere)', () => {
    expect(hasPermission('CAREGIVER', Permission.VIEW_PATIENT_REPORTS)).toBe(true);
  });

  it('allows a SUPERVISOR to view admin reports', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_ADMIN_REPORTS)).toBe(true);
  });

  it('does not allow a PATIENT to view admin reports', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_ADMIN_REPORTS)).toBe(false);
  });
});

describe('hasPermission — administration', () => {
  it('allows an ADMIN to create a staff account', () => {
    expect(hasPermission('ADMIN', Permission.CREATE_STAFF_ACCOUNT)).toBe(true);
  });

  it('does not allow a SUPERVISOR to create a staff account', () => {
    expect(hasPermission('SUPERVISOR', Permission.CREATE_STAFF_ACCOUNT)).toBe(false);
  });

  it('allows an ADMIN to manage user accounts', () => {
    expect(hasPermission('ADMIN', Permission.MANAGE_USER_ACCOUNTS)).toBe(true);
  });

  it('does not allow a CLINICIAN to manage user accounts', () => {
    expect(hasPermission('CLINICIAN', Permission.MANAGE_USER_ACCOUNTS)).toBe(false);
  });

  it('allows an ADMIN to manage supervision assignments', () => {
    expect(hasPermission('ADMIN', Permission.MANAGE_SUPERVISION)).toBe(true);
  });

  it('does not allow a SUPERVISOR to manage supervision assignments', () => {
    expect(hasPermission('SUPERVISOR', Permission.MANAGE_SUPERVISION)).toBe(false);
  });

  it('allows a SUPERVISOR to view supervision assignments (ownership enforced elsewhere)', () => {
    expect(hasPermission('SUPERVISOR', Permission.VIEW_SUPERVISION)).toBe(true);
  });

  it('does not allow a PATIENT to view supervision assignments', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_SUPERVISION)).toBe(false);
  });
});

describe('hasPermission — treatment engine v2', () => {
  it('grants VIEW_LEVELS and VIEW_CYCLE to PATIENT and CAREGIVER', () => {
    expect(hasPermission('PATIENT', Permission.VIEW_LEVELS)).toBe(true);
    expect(hasPermission('PATIENT', Permission.VIEW_CYCLE)).toBe(true);
    expect(hasPermission('CAREGIVER', Permission.VIEW_LEVELS)).toBe(true);
  });

  it('grants RECORD_TRAINING_EVENT, PREPARE_SAMPLE, SUBMIT_SAMPLE to PATIENT and CAREGIVER only', () => {
    expect(hasPermission('PATIENT', Permission.RECORD_TRAINING_EVENT)).toBe(true);
    expect(hasPermission('CAREGIVER', Permission.SUBMIT_SAMPLE)).toBe(true);
    expect(hasPermission('CLINICIAN', Permission.RECORD_TRAINING_EVENT)).toBe(false);
  });

  it('grants MANAGE_LEVELS to CLINICIAN and ADMIN only', () => {
    expect(hasPermission('CLINICIAN', Permission.MANAGE_LEVELS)).toBe(true);
    expect(hasPermission('ADMIN', Permission.MANAGE_LEVELS)).toBe(true);
    expect(hasPermission('SUPERVISOR', Permission.MANAGE_LEVELS)).toBe(false);
  });

  it('grants REVIEW_SAMPLE to CLINICIAN and ADMIN only', () => {
    expect(hasPermission('CLINICIAN', Permission.REVIEW_SAMPLE)).toBe(true);
    expect(hasPermission('PATIENT', Permission.REVIEW_SAMPLE)).toBe(false);
  });

  it('grants RESTART_CYCLE to CLINICIAN and ADMIN only', () => {
    expect(hasPermission('CLINICIAN', Permission.RESTART_CYCLE)).toBe(true);
    expect(hasPermission('ADMIN', Permission.RESTART_CYCLE)).toBe(true);
    expect(hasPermission('SUPERVISOR', Permission.RESTART_CYCLE)).toBe(false);
    expect(hasPermission('PATIENT', Permission.RESTART_CYCLE)).toBe(false);
    expect(hasPermission('CAREGIVER', Permission.RESTART_CYCLE)).toBe(false);
  });
});
