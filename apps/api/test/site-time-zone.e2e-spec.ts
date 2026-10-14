import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

/**
 * A separate time zone per site: a company on Kolkata time with a site in Dubai.
 *
 * At 19:00 UTC it is already 00:30 tomorrow in Kolkata and still 23:00 today in Dubai, so the two
 * sites are on different days — the roll call, a daily report's default date and the overview's
 * per-site "today" all follow the site's own clock, while a site with no zone of its own keeps the
 * company's.
 *
 * The instant is pinned by faking `Date` alone (timers, ticks and I/O run for real), for the whole
 * spec, so tokens are issued and checked on the same clock.
 */
const INSTANT = new Date('2026-10-06T19:00:00.000Z');
const KOLKATA_DAY = '2026-10-07';
const DUBAI_DAY = '2026-10-06';

describe('a separate time zone per site', () => {
  let test: TestApp;
  let company: OnboardedTenant;
  let auth: { Authorization: string };
  let mumbai: string;
  let dubai: string;

  beforeAll(async () => {
    jest.useFakeTimers({
      now: INSTANT,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    test = await createTestApp();
    company = await onboardTenant(test, { name: 'Two Clocks Builders', phone: uniquePhone() });
    auth = { Authorization: `Bearer ${company.accessToken}` };
  });

  afterAll(async () => {
    if (company) await destroyTenant(test, company.tenantId);
    await test.close();
    jest.useRealTimers();
  });

  it('keeps the company’s zone for a site with none, and takes a zone for one that has it', async () => {
    mumbai = (
      await test.http().post('/v1/projects').set(auth).send({ name: 'Andheri Tower', status: 'active' }).expect(201)
    ).body.id;
    const created = await test
      .http()
      .post('/v1/projects')
      .set(auth)
      .send({ name: 'Business Bay Villas', status: 'active' })
      .expect(201);
    dubai = created.body.id;
    expect(created.body).toMatchObject({ time_zone: null, today: KOLKATA_DAY });

    await test
      .http()
      .patch(`/v1/projects/${dubai}`)
      .set(auth)
      .send({ time_zone: 'Mars/Olympus_Mons' })
      .expect(422);
    const edited = await test
      .http()
      .patch(`/v1/projects/${dubai}`)
      .set(auth)
      .send({ time_zone: 'Asia/Dubai' })
      .expect(200);
    expect(edited.body).toMatchObject({ time_zone: 'Asia/Dubai', today: DUBAI_DAY });

    const home = await test.http().get(`/v1/projects/${mumbai}`).set(auth).expect(200);
    expect(home.body).toMatchObject({ time_zone: null, today: KOLKATA_DAY });
  });

  it('opens each site’s roll call on its own today', async () => {
    const atMumbai = await test.http().get(`/v1/attendance?project_id=${mumbai}`).set(auth).expect(200);
    expect(atMumbai.body).toMatchObject({
      attendance_date: KOLKATA_DAY,
      site_today: KOLKATA_DAY,
      time_zone: 'Asia/Kolkata',
    });

    const atDubai = await test.http().get(`/v1/attendance?project_id=${dubai}`).set(auth).expect(200);
    expect(atDubai.body).toMatchObject({
      attendance_date: DUBAI_DAY,
      site_today: DUBAI_DAY,
      time_zone: 'Asia/Dubai',
    });

    // An explicit date is still honoured.
    const asked = await test
      .http()
      .get(`/v1/attendance?project_id=${dubai}&date=2026-10-01`)
      .set(auth)
      .expect(200);
    expect(asked.body.attendance_date).toBe('2026-10-01');
  });

  it('counts the Dubai crew on the overview against Dubai’s day', async () => {
    const worker = (
      await test.http().post('/v1/workers').set(auth).send({ name: 'Imran', daily_wage: '80000' }).expect(201)
    ).body.id;
    await test
      .http()
      .post('/v1/attendance')
      .set(auth)
      .send({
        project_id: dubai,
        attendance_date: DUBAI_DAY,
        rows: [{ worker_id: worker, status: 'present' }],
      })
      .expect(201);

    const overview = await test.http().get('/v1/dashboard/overview').set(auth).expect(200);
    const site = (id: string) => overview.body.sites.find((row: { id: string }) => row.id === id);
    expect(site(dubai)).toMatchObject({ today: DUBAI_DAY, time_zone: 'Asia/Dubai', headcount_today: 1 });
    expect(site(mumbai)).toMatchObject({ today: KOLKATA_DAY, headcount_today: 0 });
    // The company's own figures stay on the company's clock.
    expect(overview.body.date).toBe(KOLKATA_DAY);
    expect(overview.body.totals.headcount_today).toBe(1);
  });

  it('dates a daily report for today at its site when no date is given', async () => {
    const atMumbai = await test
      .http()
      .post('/v1/dpr')
      .set(auth)
      .send({ project_id: mumbai, work_done: 'Slab cast on level 4' })
      .expect(201);
    expect(atMumbai.body.report_date).toBe(KOLKATA_DAY);

    const atDubai = await test
      .http()
      .post('/v1/dpr')
      .set(auth)
      .send({ project_id: dubai, work_done: 'Blockwork, villa 3', status: 'submitted' })
      .expect(201);
    expect(atDubai.body.report_date).toBe(DUBAI_DAY);

    const overview = await test.http().get('/v1/dashboard/overview').set(auth).expect(200);
    const site = overview.body.sites.find((row: { id: string }) => row.id === dubai);
    expect(site.dpr_status).toBe('submitted');
  });

  it('goes back to the company’s clock when the zone is cleared', async () => {
    const cleared = await test
      .http()
      .patch(`/v1/projects/${dubai}`)
      .set(auth)
      .send({ time_zone: null })
      .expect(200);
    expect(cleared.body).toMatchObject({ time_zone: null, today: KOLKATA_DAY });
    const roll = await test.http().get(`/v1/attendance?project_id=${dubai}`).set(auth).expect(200);
    expect(roll.body.attendance_date).toBe(KOLKATA_DAY);
  });
});
