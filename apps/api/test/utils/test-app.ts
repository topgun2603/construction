import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { APP_OPTIONS, configureApp } from '../../src/app-setup';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { TenantDb } from '../../src/common/prisma/tenant-db.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  tenantDb: TenantDb;
  http: () => request.Agent;
  close: () => Promise<void>;
}

/**
 * Boots the real application — real guards, real Prisma, real Postgres. Nothing is
 * stubbed, because the behaviour under test (RLS) lives in the database.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  // Configured exactly as the real server is, via the shared helper. Wiring it by hand here is what
  // let the raw-body capture exist in production and not under test, so every correctly signed
  // webhook was rejected by the suite.
  const app = moduleRef.createNestApplication({ ...APP_OPTIONS, logger: false });
  configureApp(app);
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    tenantDb: app.get(TenantDb),
    http: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

export interface OnboardedTenant {
  tenantId: string;
  ownerId: string;
  phone: string;
  accessToken: string;
  refreshToken: string;
}

/** Signs in a fresh phone and completes onboarding, returning a usable session. */
export async function onboardTenant(
  test: TestApp,
  options: { name: string; phone: string; ownerName?: string; plan?: 'starter' | 'pro' },
): Promise<OnboardedTenant> {
  const exchange = await test
    .http()
    .post('/v1/auth/exchange')
    .send({ firebase_token: `dev:${options.phone}` })
    .expect(200);

  expect(exchange.body.onboarding_required).toBe(true);

  const created = await test
    .http()
    .post('/v1/tenants')
    .set('X-Onboarding-Token', exchange.body.onboarding_token)
    .send({
      name: options.name,
      owner_name: options.ownerName ?? 'Owner',
      plan: options.plan ?? 'starter',
    })
    .expect(201);

  const me = await test
    .http()
    .get('/v1/me')
    .set('Authorization', `Bearer ${created.body.tokens.access_token}`)
    .expect(200);

  return {
    tenantId: created.body.tenant.id,
    ownerId: me.body.user.id,
    phone: `91${options.phone.slice(-10)}`,
    accessToken: created.body.tokens.access_token,
    refreshToken: created.body.tokens.refresh_token,
  };
}

/** Removes a tenant and everything cascading from it. */
export async function destroyTenant(test: TestApp, tenantId: string): Promise<void> {
  await test.tenantDb.transaction(tenantId, async (tx) => {
    await tx.tenant.deleteMany({ where: { id: tenantId } });
  });
}

/** A phone number unlikely to collide with another run of the suite. */
/**
 * A fresh Indian mobile for a test fixture.
 *
 * Every other call returns one that itself *begins* with 91, so each run exercises
 * the number shape that a naive `replace(/^91/, '')` normaliser mangles — that bug
 * shipped once and showed up only as a 1-in-3 flake, because a purely random phone
 * hit the case about a tenth of the time.
 */
let phoneSeq = 0;

export function uniquePhone(): string {
  const digits = String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0');
  return phoneSeq++ % 2 === 0 ? `91${digits}` : `98${digits}`;
}
