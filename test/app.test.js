import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, listEmails, listSignatureDocuments, getSignatureDocumentByExternalId } from '../src/db.js';
import { createEmailService } from '../src/email.js';
import { createSkribbleClient } from '../src/skribble.js';
import { createServer } from '../src/server.js';

let app;

before(async () => {
  const db = openDb(':memory:');
  const config = { baseUrl: 'http://127.0.0.1', port: 0, skribbleWebhookSecret: 'test-secret' };
  const email = createEmailService(db);
  const skribble = createSkribbleClient({ mode: 'mock', appBaseUrl: 'http://127.0.0.1', db });
  const server = createServer({ db, config, email, skribble });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  app = { db, config, server, base: `http://127.0.0.1:${port}` };
  app.config.baseUrl = app.base;
  skribble.appBaseUrl = app.base;
});

after(() => app.server.close());

const json = (path, opts = {}) => fetch(app.base + path, {
  ...opts,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
});

const formPost = (path, entries) => fetch(app.base + path, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(entries).toString(),
  redirect: 'manual',
});

const personEntries = (extra = []) => [
  ['customer_type', 'person'],
  ['first_name', 'Ada'], ['last_name', 'Lovelace'], ['email', 'ada@example.com'], ['phone', '+43 1 234'],
  ['street', 'Mainstreet 1'], ['zip', '1010'], ['city', 'Vienna'], ['country', 'AT'],
  ['date_of_birth', '1990-05-17'], ['job_type', 'employee'], ['job', 'Engineer'],
  ['insurance_interests', 'home'], ['insurance_interests', 'accident'],
  ['prelim[home][square_meters]', '120'], ['prelim[home][building_type]', 'single_family'], ['prelim[home][plan]', 'existing'],
  ['prelim[accident][sports_activities]', 'skiing'], ['prelim[accident][sports_activities]', 'climbing'],
  ['prelim[accident][risky_occupation]', 'no'],
  ...extra,
];

const fullPersonBody = (email) => ({
  customer_type: 'person',
  first_name: 'Ada', last_name: 'Lovelace', email, phone: '+43 1 234',
  street: 'Mainstreet 1', zip: '1010', city: 'Vienna', country: 'AT',
  date_of_birth: '1990-05-17', job_type: 'employee', job: 'Engineer',
  insurance_interests: ['home', 'accident'],
  prelim: {
    home: { square_meters: '120', building_type: 'single_family', plan: 'existing' },
    accident: { sports_activities: ['skiing', 'climbing'], risky_occupation: 'no' },
  },
});

test('person with missing info: email sent, registration completed via link', async () => {
  const res = await json('/api/customers', { method: 'POST', body: JSON.stringify({
    customer_type: 'person', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com',
  }) });
  assert.equal(res.status, 201);
  const { customer, emailed, missing } = await res.json();
  assert.equal(emailed, true);
  assert.equal(customer.status, 'pending');
  assert.ok(missing.length > 0);
  assert.ok(customer.registration_token);

  const mails = listEmails(app.db).filter((m) => m.customer_id === customer.id);
  assert.equal(mails.length, 1);
  assert.match(mails[0].link, new RegExp(`/register/${customer.registration_token}$`));

  const page = await fetch(`${app.base}/register/${customer.registration_token}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Complete your registration/);

  const submit = await formPost(`/register/${customer.registration_token}`, personEntries());
  assert.equal(submit.status, 303);
  assert.match(submit.headers.get('location'), /\/register\/.*\/done/);

  const detail = await (await json(`/api/customers/${customer.id}`)).json();
  assert.equal(detail.customer.status, 'complete');
  assert.equal(detail.customer.complete, true);
  assert.deepEqual(detail.customer.insurance_interests.sort(), ['accident', 'home']);
  assert.equal(detail.customer.prelim.home.square_meters, '120');
  assert.deepEqual(detail.customer.prelim.accident.sports_activities, ['skiing', 'climbing']);
});

test('person with complete info at creation: email step skipped', async () => {
  const before_ = listEmails(app.db).length;
  const res = await json('/api/customers', { method: 'POST', body: JSON.stringify(fullPersonBody('ada-full@example.com')) });
  assert.equal(res.status, 201);
  const { customer, emailed } = await res.json();
  assert.equal(emailed, false);
  assert.equal(customer.status, 'complete');
  assert.equal(customer.registration_token, null);
  assert.equal(listEmails(app.db).length, before_);
});

test('registration submit with missing data is rejected and stays pending', async () => {
  const res = await json('/api/customers', { method: 'POST', body: JSON.stringify({
    customer_type: 'person', first_name: 'Grace', last_name: 'Hopper', email: 'grace@example.com',
  }) });
  const { customer } = await res.json();
  const submit = await formPost(`/register/${customer.registration_token}`, [
    ['customer_type', 'person'], ['first_name', 'Grace'], ['last_name', 'Hopper'], ['email', 'grace@example.com'],
    ['street', 'Navy Way 1'], ['zip', '1080'], ['city', 'Vienna'], ['country', 'AT'],
    ['insurance_interests', 'home'],
    ['prelim[home][square_meters]', '80'],
  ]);
  assert.equal(submit.status, 400);
  const html = await submit.text();
  assert.match(html, /Missing:/);
  const detail = await (await json(`/api/customers/${customer.id}`)).json();
  assert.equal(detail.customer.status, 'pending');
});

test('organization with representative: full flow incl. Firmenbuchnummer', async () => {
  const res = await json('/api/customers', { method: 'POST', body: JSON.stringify({
    customer_type: 'organization', company_name: 'ACME GmbH', org_type: 'private_company', rep_email: 'office@acme.example',
  }) });
  const { customer, emailed } = await res.json();
  assert.equal(emailed, true);
  assert.equal(customer.status, 'pending');

  const submit = await formPost(`/register/${customer.registration_token}`, [
    ['customer_type', 'organization'],
    ['company_name', 'ACME GmbH'], ['org_type', 'private_company'], ['firmenbuchnummer', 'FN 123456a'],
    ['rep_first_name', 'Max'], ['rep_last_name', 'Muster'], ['rep_email', 'office@acme.example'],
    ['rep_street', 'Ring 5'], ['rep_zip', '1010'], ['rep_city', 'Vienna'], ['rep_country', 'AT'],
    ['rep_date_of_birth', '1980-01-01'], ['rep_job_type', 'self'], ['rep_job', 'CEO'],
    ['insurance_interests', 'liability'],
    ['prelim[liability][family_status]', 'single'], ['prelim[liability][pets]', 'no'],
  ]);
  assert.equal(submit.status, 303);
  const detail = await (await json(`/api/customers/${customer.id}`)).json();
  assert.equal(detail.customer.complete, true);
  assert.equal(detail.customer.firmenbuchnummer, 'FN 123456a');
  assert.equal(detail.customer.rep_first_name, 'Max');
});

test('signature process by email: 3 templates, sign each via link, process becomes signed', async () => {
  const res = await json('/api/customers', { method: 'POST', body: JSON.stringify(fullPersonBody('sig@example.com')) });
  const { customer } = await res.json();
  assert.equal(customer.status, 'complete');

  const sigRes = await json(`/api/customers/${customer.id}/signatures`, {
    method: 'POST',
    body: JSON.stringify({ templates: ['authorization', 'broker_contract', 'health_gdpr'], mode: 'email', signer_email: 'sig@example.com' }),
  });
  assert.equal(sigRes.status, 201);
  const { process, docs } = await sigRes.json();
  assert.equal(process.mode, 'email');
  assert.equal(docs.length, 3);
  for (const d of docs) {
    assert.match(d.external_id, /^mock-/);
    assert.match(d.signing_url, new RegExp(`^${app.base.replace(/[/.]/g, '\\$&')}/sign/`));
    assert.equal(d.status, 'open');
  }
  const sigMails = listEmails(app.db).filter((m) => m.to_email === 'sig@example.com' && m.subject.includes('signature'));
  assert.equal(sigMails.length, 1);

  for (const d of docs) {
    const token = d.signing_url.split('/sign/')[1];
    const page = await fetch(`${app.base}/sign/${token}`);
    assert.equal(page.status, 200);
    const signed = await fetch(`${app.base}/sign/${token}`, { method: 'POST' });
    assert.equal(signed.status, 200);
    assert.match(await signed.text(), /Document signed/);
  }

  const sigs = await (await json(`/api/customers/${customer.id}/signatures`)).json();
  assert.equal(sigs.signature_processes[0].status, 'signed');
  assert.ok(sigs.signature_processes[0].documents.every((d) => d.status === 'signed'));
});

test('signature process onsite: signing links shown on process page', async () => {
  const res = await json('/api/customers', { method: 'POST', body: JSON.stringify(fullPersonBody('onsite@example.com')) });
  const { customer } = await res.json();
  const sigRes = await json(`/api/customers/${customer.id}/signatures`, {
    method: 'POST',
    body: JSON.stringify({ templates: ['broker_contract'], mode: 'onsite' }),
  });
  assert.equal(sigRes.status, 201);
  const { process, docs } = await sigRes.json();
  assert.equal(docs[0].signer_email, 'onsite@example.com');
  const page = await fetch(`${app.base}/customers/${customer.id}/signatures/${process.id}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /touchpad/);
});

test('signature start is blocked while registration is incomplete', async () => {
  const res = await json('/api/customers', { method: 'POST', body: JSON.stringify({
    customer_type: 'person', first_name: 'Alan', last_name: 'Turing', email: 'alan@example.com',
  }) });
  const { customer } = await res.json();
  const sigRes = await json(`/api/customers/${customer.id}/signatures`, {
    method: 'POST',
    body: JSON.stringify({ templates: ['authorization'], mode: 'email' }),
  });
  assert.equal(sigRes.status, 400);
  assert.match((await sigRes.json()).error, /not complete/);
});

test('skribble webhook updates document and process status; secret enforced', async () => {
  const res = await json('/api/customers', { method: 'POST', body: JSON.stringify(fullPersonBody('hook@example.com')) });
  const { customer } = await res.json();
  const sigRes = await json(`/api/customers/${customer.id}/signatures`, {
    method: 'POST',
    body: JSON.stringify({ templates: ['authorization'], mode: 'email', signer_email: 'hook@example.com' }),
  });
  const { docs } = await sigRes.json();
  const externalId = docs[0].external_id;

  const bad = await fetch(`${app.base}/webhooks/skribble`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'wrong' },
    body: JSON.stringify({ signature_request_id: externalId, status_overall: 'SIGNED' }),
  });
  assert.equal(bad.status, 401);

  const ok = await fetch(`${app.base}/webhooks/skribble`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'test-secret' },
    body: JSON.stringify({ signature_request_id: externalId, status_overall: 'SIGNED' }),
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, updated: true });
  const doc = getSignatureDocumentByExternalId(app.db, externalId);
  assert.equal(doc.status, 'signed');
});

test('template PDFs are served and valid', async () => {
  for (const key of ['authorization', 'broker_contract', 'health_gdpr']) {
    const res = await fetch(`${app.base}/templates/${key}.pdf`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buf.length > 500);
  }
});

test('dashboard and outbox pages render', async () => {
  const dash = await fetch(`${app.base}/`);
  assert.equal(dash.status, 200);
  assert.match(await dash.text(), /Customers/);
  const outbox = await fetch(`${app.base}/outbox`);
  assert.equal(outbox.status, 200);
  assert.match(await outbox.text(), /Email outbox/);
  const health = await json('/healthz');
  assert.equal((await health.json()).ok, true);
});
