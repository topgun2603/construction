import { addDays, todayIn } from '@sitebook/shared';
import { RfiRemindersService } from '../src/modules/rfis/rfi-reminders.service';
import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';

type Auth = { Authorization: string };

/**
 * Submittals (roadmap Phase 2, module 9): Rev 0 to approval through the consultant's link, every
 * review outcome, resubmissions as linked revisions, a review recorded by hand, the client reviewing
 * through the portal's approvals, overdue reminders, permissions, tenant isolation and the audit log.
 */
describe('submittals', () => {
  let test: TestApp;
  let alpha: OnboardedTenant;
  let beta: OnboardedTenant;
  let owner: Auth;
  let pm: Auth;
  let supervisor: Auth;
  let client: Auth;
  let stranger: Auth;
  let site: string;
  let drawing: string;
  let costCode: string;
  let contractor: string;
  let shopDrawing: string;
  let sample: string;
  let token: string;

  const tz = 'Asia/Kolkata';
  const http = () => test.http();
  const tokenOf = (path: string) => path.split('/').pop()!;

  async function invite(role: string, projectIds: string[]): Promise<Auth> {
    const phone = uniquePhone();
    await http()
      .post('/v1/tenants/current/invite')
      .set(owner)
      .send({ phone, name: role === 'client' ? 'Vikram Shah' : `A ${role}`, role, project_ids: projectIds })
      .expect(201);
    const login = await http().post('/v1/auth/exchange').send({ firebase_token: `dev:${phone}` }).expect(200);
    return { Authorization: `Bearer ${login.body.access_token}` };
  }

  async function document(title: string): Promise<string> {
    const presigned = await http()
      .post('/v1/uploads/presign')
      .set(owner)
      .send({ kind: 'document', content_type: 'application/pdf', content_length: 4000, project_id: site })
      .expect(200);
    return (
      await http()
        .post('/v1/documents')
        .set(owner)
        .send({ project_id: site, title, category: 'drawing', s3_key: presigned.body.s3_key, content_type: 'application/pdf', size_bytes: 4000 })
        .expect(201)
    ).body.id;
  }

  beforeAll(async () => {
    test = await createTestApp();
    alpha = await onboardTenant(test, { name: 'Shop Drawing Builders', phone: uniquePhone() });
    beta = await onboardTenant(test, { name: 'Prying Builders', phone: uniquePhone() });
    owner = { Authorization: `Bearer ${alpha.accessToken}` };
    stranger = { Authorization: `Bearer ${beta.accessToken}` };
    site = (await http().post('/v1/projects').set(owner).send({ name: 'Harbour Point', status: 'active' }).expect(201)).body.id;
    pm = await invite('project_manager', [site]);
    supervisor = await invite('site_supervisor', [site]);
    client = await invite('client', [site]);
    drawing = await document('SD-14 Staircase steel');
    costCode = (
      await http().post(`/v1/projects/${site}/cost-codes`).set(owner).send({ code: '05.10', name: 'Structural steel' }).expect(201)
    ).body.id;
    contractor = (await http().post('/v1/contractors').set(owner).send({ name: 'Iron Works Co', trade: 'Fabrication' }).expect(201))
      .body.id;
  });

  afterAll(async () => {
    if (alpha) await destroyTenant(test, alpha.tenantId);
    if (beta) await destroyTenant(test, beta.tenantId);
    await test.close();
  });

  it('starts Rev 0 as a draft with its files, numbered per site', async () => {
    await http().post('/v1/submittals').set(supervisor).send({ project_id: site, title: 'X' }).expect(403);
    const made = await http()
      .post('/v1/submittals')
      .set(pm)
      .send({
        project_id: site,
        title: 'Staircase steel shop drawings',
        type: 'shop_drawing',
        spec_section: '05 12 00',
        cost_code_id: costCode,
        contractor_id: contractor,
        reviewer_kind: 'external',
        reviewer_name: 'Arun Mehta',
        reviewer_company: 'Mehta Associates',
        reviewer_email: 'arun@mehta.example',
        files: [{ document_id: drawing }],
      })
      .expect(201);
    shopDrawing = made.body.id;
    expect(made.body).toMatchObject({
      label: 'SUB-001',
      status: 'draft',
      current_revision: 0,
      submitted_by: 'Iron Works Co',
      cost_code: { code: '05.10' },
      reviewer: { kind: 'external', company: 'Mehta Associates' },
    });
    expect(made.body.revisions).toHaveLength(1);
    expect(made.body.revisions[0].files).toEqual([expect.objectContaining({ document: expect.objectContaining({ id: drawing }) })]);
  });

  it('submits with the company’s review period and sends the consultant a link', async () => {
    // A link before it is submitted is refused.
    await http().post(`/v1/submittals/${shopDrawing}/link`).set(pm).expect(409);
    const submitted = await http()
      .post(`/v1/submittals/${shopDrawing}/submit`)
      .set(pm)
      .send({ note: 'For approval before fabrication' })
      .expect(200);
    expect(submitted.body).toMatchObject({ status: 'submitted', due_on: addDays(todayIn(tz), 14), overdue: false });
    // Files are fixed once it is sent.
    await http().post(`/v1/submittals/${shopDrawing}/files`).set(pm).send({ files: [{ document_id: drawing }] }).expect(409);

    const sent = await http().post(`/v1/submittals/${shopDrawing}/link`).set(pm).expect(200);
    expect(sent.body.message).toContain('SUB-001');
    token = tokenOf(sent.body.path);

    // Opening it is the consultant picking it up.
    const view = await http().get('/v1/rfi-links/view').query({ token }).expect(200);
    expect(view.body).toMatchObject({
      kind: 'submittal',
      can_respond: true,
      submittal: { label: 'SUB-001', status: 'under_review', submitted_by: 'Iron Works Co', note: 'For approval before fabrication' },
    });
    expect(view.body.submittal.files).toHaveLength(1);
    const detail = await http().get(`/v1/submittals/${shopDrawing}`).set(pm).expect(200);
    expect(detail.body.status).toBe('under_review');
  });

  it('takes "revise and resubmit" with a mark-up through the link, then resubmits as Rev 1', async () => {
    const upload = await http()
      .post('/v1/rfi-links/presign')
      .send({ token, content_type: 'application/pdf', content_length: 5000 })
      .expect(200);
    const reviewed = await http()
      .post('/v1/rfi-links/review')
      .send({
        token,
        name: 'Arun Mehta',
        email: 'arun@mehta.example',
        outcome: 'revise_resubmit',
        comments: 'Stringer section too light — use ISMC 200.',
        markups: [{ s3_key: upload.body.s3_key, content_type: 'application/pdf', filename: 'SD-14 marked.pdf' }],
      })
      .expect(200);
    expect(reviewed.body.can_respond).toBe(false);
    expect(reviewed.body.submittal).toMatchObject({ status: 'revise_resubmit', reviewer: 'Arun Mehta' });
    // Reviewed once: the link reads but takes no second review.
    await http().post('/v1/rfi-links/review').send({ token, name: 'Arun', outcome: 'approved' }).expect(409);

    const inbox = await http().get('/v1/notifications').set(pm).expect(200);
    expect(inbox.body.items.map((n: { type: string }) => n.type)).toContain('submittal.reviewed');

    const next = await http().post(`/v1/submittals/${shopDrawing}/resubmit`).set(pm).send({ copy_files: true }).expect(200);
    expect(next.body).toMatchObject({ label: 'SUB-001 Rev 1', status: 'draft', current_revision: 1, due_on: null });
    const [rev1, rev0] = next.body.revisions;
    expect(rev1).toMatchObject({ revision: 1, status: 'draft' });
    expect(rev1.files).toHaveLength(1);
    expect(rev0).toMatchObject({ revision: 0, status: 'revise_resubmit', reviewer_name: 'Arun Mehta' });
    expect(rev0.markups).toEqual([expect.objectContaining({ filename: 'SD-14 marked.pdf' })]);
    // The old revision's link no longer reviews anything.
    await http().post('/v1/rfi-links/review').send({ token, name: 'Arun', outcome: 'approved' }).expect(409);
    // Only a returned revision is resubmitted.
    await http().post(`/v1/submittals/${shopDrawing}/resubmit`).set(pm).send({}).expect(409);
  });

  it('records each outcome: rejected, then approved as noted, then approved', async () => {
    const review = async (outcome: string, comments: string) => {
      await http().post(`/v1/submittals/${shopDrawing}/submit`).set(pm).send({}).expect(200);
      const sent = await http().post(`/v1/submittals/${shopDrawing}/link`).set(pm).expect(200);
      const reviewed = await http()
        .post('/v1/rfi-links/review')
        .send({ token: tokenOf(sent.body.path), name: 'Arun Mehta', outcome, comments })
        .expect(200);
      return reviewed.body.submittal.status as string;
    };
    expect(await review('rejected', 'Wrong grade of steel')).toBe('rejected');
    await http().post(`/v1/submittals/${shopDrawing}/resubmit`).set(pm).send({ copy_files: true }).expect(200);
    expect(await review('approved_as_noted', 'Add a handrail bracket at mid-landing')).toBe('approved_as_noted');
    // Approved as noted is accepted: nothing to resubmit.
    await http().post(`/v1/submittals/${shopDrawing}/resubmit`).set(pm).send({}).expect(409);

    const detail = await http().get(`/v1/submittals/${shopDrawing}`).set(pm).expect(200);
    expect(detail.body.revisions.map((r: { revision: number; status: string }) => [r.revision, r.status])).toEqual([
      [2, 'approved_as_noted'],
      [1, 'rejected'],
      [0, 'revise_resubmit'],
    ]);

    // A review recorded by hand, for one that came back stamped by email.
    const second = await http()
      .post('/v1/submittals')
      .set(pm)
      .send({ project_id: site, title: 'Fire door hardware data sheet', type: 'data_sheet', files: [{ document_id: drawing }] })
      .expect(201);
    await http().post(`/v1/submittals/${second.body.id}/submit`).set(pm).send({}).expect(200);
    await http().post(`/v1/submittals/${second.body.id}/review`).set(supervisor).send({ outcome: 'approved' }).expect(403);
    await http().post(`/v1/submittals/${second.body.id}/start-review`).set(pm).expect(200);
    const approved = await http()
      .post(`/v1/submittals/${second.body.id}/review`)
      .set(pm)
      .send({ outcome: 'approved', reviewer_name: 'Arun Mehta (by email)', comments: 'Stamped copy attached' })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', label: 'SUB-002' });
    expect(approved.body.revisions[0].reviewer_name).toBe('Arun Mehta (by email)');
  });

  it('lets the client review through the portal’s approvals', async () => {
    const made = await http()
      .post('/v1/submittals')
      .set(pm)
      .send({
        project_id: site,
        title: 'Kitchen granite sample',
        type: 'material_sample',
        reviewer_kind: 'client',
        files: [{ document_id: drawing }],
      })
      .expect(201);
    sample = made.body.id;
    const submitted = await http().post(`/v1/submittals/${sample}/submit`).set(pm).send({ due_on: addDays(todayIn(tz), -1) }).expect(200);
    expect(submitted.body).toMatchObject({ status: 'submitted', overdue: true });
    const approvalId = submitted.body.revisions[0].approval.id as string;
    // No link for a client reviewer, and nobody but the client answers it.
    await http().post(`/v1/submittals/${sample}/link`).set(pm).expect(409);
    await http().post(`/v1/submittals/${sample}/review`).set(pm).send({ outcome: 'approved' }).expect(409);
    await http().delete(`/v1/approvals/${approvalId}`).set(pm).expect(409);

    const waiting = await http().get('/v1/approvals').query({ project_id: site }).set(client).expect(200);
    expect(waiting.body.items.map((a: { title: string }) => a.title)).toContain('Submittal SUB-003: Kitchen granite sample');

    // The overdue reminder goes before the client answers.
    const reminders = test.app.get(RfiRemindersService);
    expect((await reminders.remindTenant(alpha.tenantId)).reminded).toBe(1);
    expect((await reminders.remindTenant(alpha.tenantId)).reminded).toBe(0);
    const pmInbox = await http().get('/v1/notifications').set(pm).expect(200);
    expect(pmInbox.body.items.map((n: { type: string }) => n.type)).toContain('submittal.overdue');

    await http()
      .patch(`/v1/approvals/${approvalId}`)
      .set(client)
      .send({ status: 'rejected', note: 'Too dark — show me something lighter' })
      .expect(200);
    const after = await http().get(`/v1/submittals/${sample}`).set(pm).expect(200);
    expect(after.body).toMatchObject({ status: 'revise_resubmit', overdue: false });
    expect(after.body.revisions[0]).toMatchObject({
      reviewer_name: 'Vikram Shah',
      review_comments: 'Too dark — show me something lighter',
      approval: { status: 'rejected' },
    });

    // Rev 1 goes back to the client, who approves it.
    await http().post(`/v1/submittals/${sample}/resubmit`).set(pm).send({ copy_files: true }).expect(200);
    const rev1 = await http().post(`/v1/submittals/${sample}/submit`).set(pm).send({}).expect(200);
    await http().patch(`/v1/approvals/${rev1.body.revisions[0].approval.id}`).set(client).send({ status: 'approved' }).expect(200);
    expect((await http().get(`/v1/submittals/${sample}`).set(pm).expect(200)).body.status).toBe('approved');
  });

  it('filters the log and exports it', async () => {
    const log = await http().get('/v1/submittals').query({ project_id: site }).set(supervisor).expect(200);
    expect(log.body.stats).toMatchObject({ total: 3, approved: 3, overdue: 0 });
    expect(typeof log.body.stats.avg_review_days).toBe('number');
    const samples = await http().get('/v1/submittals').query({ type: 'material_sample' }).set(pm).expect(200);
    expect(samples.body.items.map((row: { id: string }) => row.id)).toEqual([sample]);
    const byParty = await http().get('/v1/submittals').query({ party: 'iron works' }).set(pm).expect(200);
    expect(byParty.body.items.map((row: { id: string }) => row.id)).toEqual([shopDrawing]);
    const exported = await http().get('/v1/submittals/export').query({ project_id: site }).set(pm).expect(200);
    expect(exported.text).toContain('SUB-001 Rev 2,2,Harbour Point,Staircase steel shop drawings,Shop drawing,05 12 00,Approved as noted');
  });

  it('keeps submittals to their company and their permissions', async () => {
    await http().get('/v1/submittals').set(client).expect(403);
    await http().get(`/v1/submittals/${shopDrawing}`).set(stranger).expect(404);
    expect((await http().get('/v1/submittals').set(stranger).expect(200)).body.items).toHaveLength(0);
    await http().post(`/v1/submittals/${shopDrawing}/resubmit`).set(stranger).send({}).expect(404);
    // Only a first draft never sent can be deleted.
    await http().delete(`/v1/submittals/${shopDrawing}`).set(pm).expect(409);
    const draft = await http().post('/v1/submittals').set(pm).send({ project_id: site, title: 'Temp' }).expect(201);
    await http().post(`/v1/submittals/${draft.body.id}/submit`).set(pm).send({}).expect(409);
    await http().delete(`/v1/submittals/${draft.body.id}`).set(pm).expect(204);
  });

  it('records every change in the audit log', async () => {
    const entries = async (query: Record<string, string>) =>
      (await http().get('/v1/audit').query(query).set(owner).expect(200)).body.items as Array<{ action: string }>;
    expect((await entries({ entity: 'submittals', entity_id: shopDrawing })).length).toBeGreaterThanOrEqual(4);
    expect((await entries({ entity: 'submittal_revisions' })).length).toBeGreaterThanOrEqual(6);
    expect((await entries({ entity: 'submittal_files' })).length).toBeGreaterThanOrEqual(4);
  });
});
