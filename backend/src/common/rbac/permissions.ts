import { Role } from '@prisma/client';

export enum Permission {
  CREATE_PATIENT_PROFILE = 'CREATE_PATIENT_PROFILE',
  VIEW_PATIENT_PROFILE = 'VIEW_PATIENT_PROFILE',
  EDIT_PATIENT_PROFILE = 'EDIT_PATIENT_PROFILE',
  DISABLE_PATIENT_PROFILE = 'DISABLE_PATIENT_PROFILE',
  LINK_GUARDIAN = 'LINK_GUARDIAN',
  SEARCH_PATIENTS = 'SEARCH_PATIENTS',
  MANAGE_USERS = 'MANAGE_USERS',
}

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  PATIENT: [Permission.VIEW_PATIENT_PROFILE, Permission.EDIT_PATIENT_PROFILE],
  CAREGIVER: [Permission.VIEW_PATIENT_PROFILE, Permission.EDIT_PATIENT_PROFILE],
  CLINICIAN: [
    Permission.CREATE_PATIENT_PROFILE,
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.DISABLE_PATIENT_PROFILE,
    Permission.LINK_GUARDIAN,
    Permission.SEARCH_PATIENTS,
  ],
  SUPERVISOR: [Permission.VIEW_PATIENT_PROFILE, Permission.SEARCH_PATIENTS],
  ADMIN: [
    Permission.CREATE_PATIENT_PROFILE,
    Permission.VIEW_PATIENT_PROFILE,
    Permission.EDIT_PATIENT_PROFILE,
    Permission.DISABLE_PATIENT_PROFILE,
    Permission.LINK_GUARDIAN,
    Permission.SEARCH_PATIENTS,
    Permission.MANAGE_USERS,
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
