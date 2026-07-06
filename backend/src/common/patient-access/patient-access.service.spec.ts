import { ForbiddenException } from '@nestjs/common';
import { PatientAccessService } from './patient-access.service';
import { PatientProfile } from '@prisma/client';

function makePrismaMock() {
  const guardianLink = { findFirst: jest.fn() };
  return { guardianLink } as any;
}

function makeProfile(overrides: Partial<PatientProfile> = {}): PatientProfile {
  return {
    id: 'profile-1',
    userId: 'patient-user-1',
    fullName: 'Test Patient',
    gender: 'MALE',
    dateOfBirth: new Date('2000-01-01'),
    nationalId: 'NID-1',
    address: null,
    referralSource: null,
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PatientProfile;
}

describe('PatientAccessService', () => {
  it('allows a CLINICIAN unconditionally', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);

    await expect(
      service.assertCanAccess({ id: 'clinician-1', role: 'CLINICIAN', sessionId: 's1' }, makeProfile()),
    ).resolves.toBeUndefined();
  });

  it('allows a SUPERVISOR unconditionally', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);

    await expect(
      service.assertCanAccess({ id: 'supervisor-1', role: 'SUPERVISOR', sessionId: 's1' }, makeProfile()),
    ).resolves.toBeUndefined();
  });

  it('allows an ADMIN unconditionally', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);

    await expect(
      service.assertCanAccess({ id: 'admin-1', role: 'ADMIN', sessionId: 's1' }, makeProfile()),
    ).resolves.toBeUndefined();
  });

  it('allows a PATIENT to access their own profile', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);
    const profile = makeProfile({ userId: 'patient-user-1' });

    await expect(
      service.assertCanAccess({ id: 'patient-user-1', role: 'PATIENT', sessionId: 's1' }, profile),
    ).resolves.toBeUndefined();
  });

  it('denies a PATIENT accessing another patient\'s profile', async () => {
    const prisma = makePrismaMock();
    const service = new PatientAccessService(prisma);
    const profile = makeProfile({ userId: 'patient-user-1' });

    await expect(
      service.assertCanAccess({ id: 'patient-user-2', role: 'PATIENT', sessionId: 's1' }, profile),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows a CAREGIVER linked as guardian', async () => {
    const prisma = makePrismaMock();
    prisma.guardianLink.findFirst.mockResolvedValue({ id: 'link-1' });
    const service = new PatientAccessService(prisma);
    const profile = makeProfile({ userId: 'patient-user-1' });

    await expect(
      service.assertCanAccess({ id: 'guardian-1', role: 'CAREGIVER', sessionId: 's1' }, profile),
    ).resolves.toBeUndefined();
    expect(prisma.guardianLink.findFirst).toHaveBeenCalledWith({
      where: { guardianUserId: 'guardian-1', patientUserId: 'patient-user-1' },
    });
  });

  it('denies a CAREGIVER not linked as guardian', async () => {
    const prisma = makePrismaMock();
    prisma.guardianLink.findFirst.mockResolvedValue(null);
    const service = new PatientAccessService(prisma);
    const profile = makeProfile({ userId: 'patient-user-1' });

    await expect(
      service.assertCanAccess({ id: 'guardian-2', role: 'CAREGIVER', sessionId: 's1' }, profile),
    ).rejects.toThrow(ForbiddenException);
  });
});
