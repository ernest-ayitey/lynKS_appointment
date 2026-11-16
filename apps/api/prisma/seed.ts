import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { createPrismaAdapter } from '../src/prisma/create-prisma-adapter';

// Allow running this script standalone (`ts-node prisma/seed.ts`), not
// just via `prisma migrate dev`'s seed hook which already has the env
// loaded from `prisma.config.ts`.
try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // no .env file present — rely on already-exported env vars.
}

const prisma = new PrismaClient({ adapter: createPrismaAdapter() });

/** Stable permission keys. See spec `6.1` for the per-role toggle examples. */
const PERMISSION_KEYS = [
  'clinical_notes.read',
  'patients.contact_details.read',
  'doctors.hours.manage',
  'cancellation_fees.override',
  'bookings.manage',
] as const;

const ROLE_NAMES = ['Doctor', 'Front desk', 'Dental assistant', 'Clinic admin'] as const;

/**
 * Default allowed/denied permission keys per role, matching `6.1`'s
 * example (e.g. a front-desk role sees contact details but not clinical
 * notes). Roles not listed here (e.g. "Dental assistant") are seeded with
 * no explicit RolePermission rows — a missing row means "not allowed".
 */
const DEFAULT_ALLOWED_PERMISSIONS: Record<string, readonly string[]> = {
  'Clinic admin': PERMISSION_KEYS,
  Doctor: ['clinical_notes.read', 'doctors.hours.manage'],
  'Front desk': ['bookings.manage', 'patients.contact_details.read'],
};

async function seedClinicAndLocations(): Promise<void> {
  const clinic = await prisma.clinic.upsert({
    where: { id: 'seed-clinic' },
    update: {},
    create: {
      id: 'seed-clinic',
      name: '[CLINIC NAME]',
      timezone: 'Africa/Accra',
    },
  });

  for (const name of ['Airport branch', 'Osu clinic']) {
    await prisma.location.upsert({
      where: { id: `seed-location-${name}` },
      update: { name, clinicId: clinic.id },
      create: {
        id: `seed-location-${name}`,
        name,
        clinicId: clinic.id,
      },
    });
  }
}

async function seedRoles(): Promise<Record<string, string>> {
  const roleIdsByName: Record<string, string> = {};

  for (const name of ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, isSystemDefault: true },
    });
    roleIdsByName[name] = role.id;
  }

  return roleIdsByName;
}

async function seedPermissions(): Promise<Record<string, string>> {
  const permissionIdsByKey: Record<string, string> = {};

  for (const key of PERMISSION_KEYS) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
    permissionIdsByKey[key] = permission.id;
  }

  return permissionIdsByKey;
}

async function seedRolePermissions(
  roleIdsByName: Record<string, string>,
  permissionIdsByKey: Record<string, string>,
): Promise<void> {
  for (const [roleName, allowedKeys] of Object.entries(DEFAULT_ALLOWED_PERMISSIONS)) {
    const roleId = roleIdsByName[roleName];

    for (const permissionKey of PERMISSION_KEYS) {
      const permissionId = permissionIdsByKey[permissionKey];
      const allowed = allowedKeys.includes(permissionKey);

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: { allowed },
        create: { roleId, permissionId, allowed },
      });
    }
  }
}

async function main(): Promise<void> {
  await seedClinicAndLocations();
  const roleIdsByName = await seedRoles();
  const permissionIdsByKey = await seedPermissions();
  await seedRolePermissions(roleIdsByName, permissionIdsByKey);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
