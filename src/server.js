import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  insertCustomer, getCustomer, getCustomerByToken, listCustomers, updateCustomer, setRegistrationToken,
  listEmails, createSignatureProcess, addSignatureDocument, getSignatureDocument, getSignatureDocumentByToken,
  getSignatureDocumentByExternalId, listSignatureDocuments, listProcessDocuments, listSignatureProcesses,
  updateSignatureDocumentStatus, recomputeProcessStatus,
} from './db.js';
import { TEMPLATES, ALL_CUSTOMER_FIELDS, customerDisplayName, customerEmail } from './catalog.js';
import { missingFields, isComplete, validateEnums, normalizeInterests, safeJson } from './validate.js';
import { registrationEmail, signatureEmail } from './email.js';
import { renderTemplatePdf } from './templates.js';
import { mapStatus } from './skribble.js';
import * as views from './views.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function setDeep(obj, keyPath, value) {
  const keys = keyPath.replace(/\[([^\]]*)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  if (last in cur) {
    if (!Array.isArray(cur[last])) cur[last] = [cur[last]];
    cur[last].push(value);
  } else {
    cur[last] = value;
  }
}

const decode = (s) => decodeURIComponent(s.replace(/\+/g, ' '));

function parseForm(str) {
  const out = {};
  for (const pair of str.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = decode(eq < 0 ? pair : pair.slice(0, eq));
    const v = decode(eq < 0 ? '' : pair.slice(eq + 1));
    setDeep(out, k, v);
  }
  return out;
}

function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  const ct = String(req.headers['content-type'] || '');
  const raw = await readBody(req);
  if (!raw) return {};
  if (ct.includes('application/json')) return JSON.parse(raw);
  if (ct.includes('application/x-www-form-urlencoded')) return parseForm(raw);
  return {};
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};
const sendHtml = (res, html, status = 200) => send(res, status, html, { 'Content-Type': 'text/html; charset=utf-8' });
const sendJson = (res, data, status = 200) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
const redirect = (res, location) => send(res, 303, '', { Location: location });

function compile(pattern) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([^/.]+)/g, (m, k) => { keys.push(k); return '([^/.]+)'; }) + '$');
  return { rx, keys };
}

function customerFieldsFrom(body) {
  const fields = {};
  for (const k of ALL_CUSTOMER_FIELDS) if (k in body) fields[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
  fields.insurance_interests = normalizeInterests(body.insurance_interests);
  fields.prelim = safeJson(body.prelim, {});
  return fields;
}

export function createServer({ db, config, email, skribble }) {
  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, ...compile(pattern), handler });

  const sendRegistrationEmail = (customer) => {
    const token = customer.registration_token || setRegistrationToken(db, customer.id);
    const mail = registrationEmail(config, token);
    return email.send({ to: customerEmail(customer), subject: mail.subject, body: mail.body, link: mail.link, customerId: customer.id });
  };

  const createCustomerFlow = (body) => {
    const customerType = body.customer_type === 'organization' ? 'organization' : body.customer_type === 'person' ? 'person' : null;
    if (!customerType) return { error: 'customer_type must be "person" or "organization"', status: 400 };
    const fields = customerFieldsFrom(body);
    let customer = insertCustomer(db, { ...fields, customer_type: customerType, created_by: body.created_by || null, status: 'pending' });
    const missing = missingFields(customer);
    let emailed = false;
    if (missing.length === 0) {
      customer = updateCustomer(db, customer.id, { status: 'complete' });
    } else {
      const token = setRegistrationToken(db, customer.id);
      const mail = registrationEmail(config, token);
      email.send({ to: customerEmail(customer), subject: mail.subject, body: mail.body, link: mail.link, customerId: customer.id });
      customer = getCustomer(db, customer.id);
      emailed = true;
    }
    return { customer, emailed, missing };
  };

  const startSignatureFlow = async (customerId, body) => {
    const customer = getCustomer(db, customerId);
    if (!customer) return { error: 'Customer not found', status: 404 };
    if (!isComplete(customer)) return { error: 'Registration is not complete yet', status: 400 };
    let templates = normalizeInterests(body.templates).filter((t) => TEMPLATES.some((x) => x.key === t));
    if (typeof body.templates === 'string' && body.templates) templates = [body.templates];
    if (!templates.length) return { error: 'Select at least one document template', status: 400 };
    const mode = body.mode === 'onsite' ? 'onsite' : 'email';
    const signerEmail = String(body.signer_email || customerEmail(customer) || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signerEmail)) return { error: 'A valid signer email is required', status: 400 };
    const process = createSignatureProcess(db, { customerId, mode, createdBy: body.created_by || null });
    const docs = [];
    for (const key of templates) {
      const tpl = TEMPLATES.find((t) => t.key === key);
      const pdf = renderTemplatePdf(key, customer);
      const res = await skribble.createSignatureRequest({
        title: `${tpl.title} - ${customerDisplayName(customer)}`,
        message: `Please sign the document "${tpl.title}".`,
        contentBase64: pdf.toString('base64'),
        signer: { email: signerEmail },
        mode,
        exitUrl: `${config.baseUrl}/customers/${customerId}`,
      });
      docs.push(addSignatureDocument(db, {
        processId: process.id,
        customerId,
        templateKey: key,
        title: tpl.title,
        externalId: res.id,
        signingUrl: res.signingUrl,
        signingToken: res.signingToken || null,
        signerEmail,
        status: res.status || 'open',
      }));
    }
    if (mode === 'email') {
      const mail = signatureEmail(config, customerDisplayName(customer), docs.map((d) => ({ title: d.title, signingUrl: d.signing_url })));
      email.send({ to: signerEmail, subject: mail.subject, body: mail.body, customerId, link: docs[0]?.signing_url || null });
    }
    return { process, docs, customer };
  };

  const signatureSummary = (customerId) => listSignatureDocuments(db, customerId);

  route('GET', '/', async ({ res }) => {
    const customers = listCustomers(db);
    const sigMap = new Map(customers.map((c) => [c.id, signatureSummary(c.id)]));
    sendHtml(res, views.dashboardPage(customers, sigMap));
  });

  route('GET', '/customers/new', async ({ res }) => sendHtml(res, views.newCustomerPage()));

  route('POST', '/customers', async (ctx) => {
    const { req, res, body } = ctx;
    const result = createCustomerFlow(body);
    if (result.error) return sendHtml(res, views.errorPage(result.status, result.error), result.status);
    const notice = result.emailed
      ? 'Registration incomplete - email with completion link sent to the customer.'
      : 'Registration already complete - email step skipped.';
    if (String(req.headers.accept || '').includes('application/json')) {
      return sendJson(res, { customer: result.customer, emailed: result.emailed, missing: result.missing }, 201);
    }
    redirect(res, `/customers/${result.customer.id}?notice=${encodeURIComponent(notice)}`);
  });

  route('GET', '/customers/:id', async ({ res, params, query }) => {
    const c = getCustomer(db, params.id);
    if (!c) return sendHtml(res, views.errorPage(404, 'Customer not found'), 404);
    const processes = listSignatureProcesses(db, c.id);
    const docsByProcess = new Map(processes.map((p) => [p.id, listProcessDocuments(db, p.id)]));
    sendHtml(res, views.customerDetailPage({ customer: c, processes, docsByProcess, templates: TEMPLATES, notice: query.get('notice') || '', error: query.get('error') || '' }));
  });

  route('POST', '/customers/:id/email', async ({ res, params, body }) => {
    const c = getCustomer(db, params.id);
    if (!c) return sendHtml(res, views.errorPage(404, 'Customer not found'), 404);
    sendRegistrationEmail(c);
    redirect(res, `/customers/${c.id}?notice=${encodeURIComponent('Registration email sent.')}`);
  });

  route('POST', '/customers/:id/signatures', async (ctx) => {
    const { req, res, params, body } = ctx;
    try {
      const result = await startSignatureFlow(params.id, body);
      if (result.error) {
        if (String(req.headers.accept || '').includes('application/json')) return sendJson(res, { error: result.error }, result.status);
        const c = getCustomer(db, params.id);
        if (!c) return sendHtml(res, views.errorPage(result.status, result.error), result.status);
        const processes = listSignatureProcesses(db, c.id);
        const docsByProcess = new Map(processes.map((p) => [p.id, listProcessDocuments(db, p.id)]));
        return sendHtml(res, views.customerDetailPage({ customer: c, processes, docsByProcess, templates: TEMPLATES, error: result.error }), result.status);
      }
      if (String(req.headers.accept || '').includes('application/json')) return sendJson(res, result, 201);
      redirect(res, `/customers/${params.id}/signatures/${result.process.id}`);
    } catch (err) {
      sendJson(res, { error: String(err.message || err) }, 502);
    }
  });

  route('GET', '/customers/:id/signatures/:processId', async ({ res, params }) => {
    const c = getCustomer(db, params.id);
    const docs = listProcessDocuments(db, params.processId);
    if (!c || !docs.length) return sendHtml(res, views.errorPage(404, 'Signature process not found'), 404);
    const process = db.prepare('SELECT * FROM signature_processes WHERE id = ?').get(params.processId);
    sendHtml(res, views.processPage({ customer: c, process, docs }));
  });

  route('GET', '/register/:token', async ({ res, params }) => {
    const c = getCustomerByToken(db, params.token);
    if (!c) return sendHtml(res, views.errorPage(404, 'Invalid or expired registration link.'), 404);
    if (c.status === 'complete') return redirect(res, `/register/${params.token}/done`);
    sendHtml(res, views.registerPage({ token: params.token, customer: c, values: null, errors: [] }));
  });

  route('POST', '/register/:token', async ({ res, params, body }) => {
    const c = getCustomerByToken(db, params.token);
    if (!c) return sendHtml(res, views.errorPage(404, 'Invalid or expired registration link.'), 404);
    if (c.status === 'complete') return redirect(res, `/register/${params.token}/done`);
    const update = customerFieldsFrom(body);
    const merged = { ...c, ...update, customer_type: c.customer_type };
    const enumErrors = validateEnums(merged);
    const missing = missingFields(merged);
    const errors = [
      ...enumErrors.map((e) => `Invalid value: ${e}`),
      ...missing.map((m) => `Missing: ${m.replace(/\./g, ' > ')}`),
    ];
    if (errors.length) {
      return sendHtml(res, views.registerPage({ token: params.token, customer: c, values: { ...body, customer_type: c.customer_type }, errors }), 400);
    }
    const saved = updateCustomer(db, c.id, { ...update, status: 'complete' });
    redirect(res, `/register/${params.token}/done?saved=${saved.id}`);
  });

  route('GET', '/register/:token/done', async ({ res, params }) => {
    const c = getCustomerByToken(db, params.token);
    if (!c || c.status !== 'complete') return sendHtml(res, views.errorPage(404, 'Registration not found or not completed yet.'), 404);
    sendHtml(res, views.registerDonePage(c));
  });

  route('GET', '/sign/:token', async ({ res, params }) => {
    const doc = getSignatureDocumentByToken(db, params.token);
    if (!doc) return sendHtml(res, views.errorPage(404, 'Unknown signing link.'), 404);
    if (doc.external_id && !doc.external_id.startsWith('mock-')) {
      return redirect(res, doc.signing_url || '/');
    }
    const c = getCustomer(db, doc.customer_id);
    sendHtml(res, views.signPage(doc, c));
  });

  route('POST', '/sign/:token', async ({ res, params }) => {
    const doc = getSignatureDocumentByToken(db, params.token);
    if (!doc) return sendHtml(res, views.errorPage(404, 'Unknown signing link.'), 404);
    if (doc.external_id && !doc.external_id.startsWith('mock-')) {
      return redirect(res, doc.signing_url || '/');
    }
    const updated = updateSignatureDocumentStatus(db, doc.id, 'signed');
    recomputeProcessStatus(db, doc.process_id);
    const c = getCustomer(db, doc.customer_id);
    sendHtml(res, views.signDonePage(updated, c));
  });

  route('POST', '/signatures/:docId/refresh', async (ctx) => {
    const { req, res, params } = ctx;
    const doc = getSignatureDocument(db, params.docId);
    if (!doc) return sendJson(res, { error: 'Not found' }, 404);
    if (doc.external_id && !doc.external_id.startsWith('mock-')) {
      try {
        const remote = await skribble.getSignatureRequest(doc.external_id);
        updateSignatureDocumentStatus(db, doc.id, remote.status);
        recomputeProcessStatus(db, doc.process_id);
      } catch (err) {
        return sendJson(res, { error: String(err.message || err) }, 502);
      }
    }
    const updated = getSignatureDocument(db, params.docId);
    if (String(req.headers.accept || '').includes('application/json')) return sendJson(res, { document: updated });
    redirect(res, req.headers.referer || `/customers/${updated.customer_id}`);
  });

  route('POST', '/webhooks/skribble', async ({ req, res, body }) => {
    if (config.skribbleWebhookSecret && req.headers['x-webhook-secret'] !== config.skribbleWebhookSecret) {
      return sendJson(res, { error: 'Unauthorized' }, 401);
    }
    const externalId = body.signature_request_id || body.signatureRequestId || body.id;
    const status = body.status_overall || body.status;
    let updated = false;
    if (externalId && status) {
      const doc = getSignatureDocumentByExternalId(db, String(externalId));
      if (doc) {
        updateSignatureDocumentStatus(db, doc.id, mapStatus(status));
        recomputeProcessStatus(db, doc.process_id);
        updated = true;
      }
    }
    sendJson(res, { ok: true, updated });
  });

  route('GET', '/outbox', async ({ res }) => sendHtml(res, views.outboxPage(listEmails(db))));

  route('GET', '/templates/:key.pdf', async ({ res, params }) => {
    if (!TEMPLATES.some((t) => t.key === params.key)) return sendHtml(res, views.errorPage(404, 'Unknown template'), 404);
    const pdf = renderTemplatePdf(params.key, null);
    send(res, 200, pdf, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${params.key}.pdf"` });
  });

  route('GET', '/healthz', async ({ res }) => sendJson(res, { ok: true }));

  route('GET', '/api/customers', async ({ res }) => {
    sendJson(res, { customers: listCustomers(db).map((c) => ({ ...c, missing: missingFields(c), complete: isComplete(c), signatures: signatureSummary(c.id) })) });
  });

  route('POST', '/api/customers', async ({ res, body }) => {
    const result = createCustomerFlow(body);
    if (result.error) return sendJson(res, { error: result.error }, result.status);
    sendJson(res, { customer: result.customer, emailed: result.emailed, missing: result.missing }, 201);
  });

  route('GET', '/api/customers/:id', async ({ res, params }) => {
    const c = getCustomer(db, params.id);
    if (!c) return sendJson(res, { error: 'Customer not found' }, 404);
    const processes = listSignatureProcesses(db, c.id).map((p) => ({ ...p, documents: listProcessDocuments(db, p.id) }));
    sendJson(res, { customer: { ...c, missing: missingFields(c), complete: isComplete(c) }, signature_processes: processes });
  });

  route('POST', '/api/customers/:id/email', async ({ res, params }) => {
    const c = getCustomer(db, params.id);
    if (!c) return sendJson(res, { error: 'Customer not found' }, 404);
    const mail = sendRegistrationEmail(c);
    sendJson(res, { ok: true, email: mail });
  });

  route('POST', '/api/customers/:id/signatures', async ({ res, params, body }) => {
    try {
      const result = await startSignatureFlow(params.id, body);
      if (result.error) return sendJson(res, { error: result.error }, result.status);
      sendJson(res, result, 201);
    } catch (err) {
      sendJson(res, { error: String(err.message || err) }, 502);
    }
  });

  route('GET', '/api/customers/:id/signatures', async ({ res, params }) => {
    const processes = listSignatureProcesses(db, params.id).map((p) => ({ ...p, documents: listProcessDocuments(db, p.id) }));
    sendJson(res, { signature_processes: processes });
  });

  route('GET', '/public/style.css', async ({ res }) => {
    send(res, 200, fs.readFileSync(path.join(publicDir, 'style.css')), { 'Content-Type': 'text/css; charset=utf-8' });
  });

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;
      let body = {};
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        try { body = await parseBody(req); } catch (err) {
          return sendJson(res, { error: `Invalid body: ${err.message}` }, 400);
        }
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.rx.exec(pathname);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return await r.handler({ req, res, params, query: url.searchParams, body, db, config, email, skribble });
      }
      sendHtml(res, views.errorPage(404, `No route for ${req.method} ${pathname}`), 404);
    } catch (err) {
      console.error(err);
      sendJson(res, { error: String(err.message || err) }, 500);
    }
  });
}
