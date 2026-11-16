import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from '../src/prisma/create-prisma-adapter';

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

describe('Seed data', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds exactly 2 locations and 4 roles', async () => {
    const locations = await prisma.location.findMany();
    const roles = await prisma.role.findMany();

    expect(locations).toHaveLength(2);
    expect(roles.map((r) => r.name).sort()).toEqual([
      'Clinic admin',
      'Dental assistant',
      'Doctor',
      'Front desk',
    ]);
  });

  it('seeds the permission keys with a default RolePermission matrix', async () => {
    const permissions = await prisma.permission.findMany();
    expect(permissions.map((p) => p.key).sort()).toEqual(
      [
        'bookings.manage',
        'cancellation_fees.override',
        'clinical_notes.read',
        'doctors.hours.manage',
        'patients.contact_details.read',
      ].sort(),
    );

    const clinicAdmin = await prisma.role.findUniqueOrThrow({
      where: { name: 'Clinic admin' },
      include: { rolePermissions: { include: { permission: true } } },
    });
    expect(clinicAdmin.rolePermissions.every((rp) => rp.allowed)).toBe(true);
    expect(clinicAdmin.rolePermissions).toHaveLength(permissions.length);

    const doctor = await prisma.role.findUniqueOrThrow({
      where: { name: 'Doctor' },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const doctorAllowed = doctor.rolePermissions
      .filter((rp) => rp.allowed)
      .map((rp) => rp.permission.key)
      .sort();
    expect(doctorAllowed).toEqual(['clinical_notes.read', 'doctors.hours.manage']);

    const frontDesk = await prisma.role.findUniqueOrThrow({
      where: { name: 'Front desk' },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const frontDeskAllowed = frontDesk.rolePermissions
      .filter((rp) => rp.allowed)
      .map((rp) => rp.permission.key)
      .sort();
    expect(frontDeskAllowed).toEqual(['bookings.manage', 'patients.contact_details.read']);

    const frontDeskClinicalNotes = frontDesk.rolePermissions.find(
      (rp) => rp.permission.key === 'clinical_notes.read',
    );
    expect(frontDeskClinicalNotes?.allowed).toBe(false);
  });
});
