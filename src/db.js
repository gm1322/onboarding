import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { safeJson, normalizeInterests } from './validate.js';

export function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      created_by TEXT,
      customer_type TEXT NOT NULL CHECK (customer_type IN ('person','organization')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete')),
      first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
      street TEXT, zip TEXT, city TEXT, country TEXT,
      date_of_birth TEXT, job_type TEXT, job TEXT,
      company_name TEXT, org_type TEXT, firmenbuchnummer TEXT, gisa_number TEXT,
      rep_first_name TEXT, rep_last_name TEXT, rep_email TEXT, rep_phone TEXT,
      rep_street TEXT, rep_zip TEXT, rep_city TEXT, rep_country TEXT,
      rep_date_of_birth TEXT, rep_job_type TEXT, rep_job TEXT,
      insurance_interests TEXT NOT NULL DEFAULT '[]',
      prelim TEXT NOT NULL DEFAULT '{}',
      registration_token TEXT UNIQUE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
    );
    CREATE TABLE IF NOT EXISTS signature_processes (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('email','onsite')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','signed','cancelled')),
      created_at TEXT NOT NULL,
      created_by TEXT
    );
    CREATE TABLE IF NOT EXISTS signature_documents (
      id TEXT PRIMARY KEY,
      process_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      template_key TEXT NOT NULL,
      title TEXT NOT NULL,
      external_id TEXT,
      signing_url TEXT,
      signing_token TEXT,
      signer_email TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','signed','cancelled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
    CREATE INDEX IF NOT EXISTS idx_sigdocs_process ON signature_documents(process_id);
    CREATE INDEX IF NOT EXISTS idx_sigdocs_token ON signature_documents(signing_token);
  `);
  return db;
}

const now = () => new Date().toISOString();

export function rowToCustomer(row) {
  if (!row) return null;
  return {
    ...row,
    insurance_interests: normalizeInterests(safeJson(row.insurance_interests, [])),
    prelim: safeJson(row.prelim, {}),
  };
}

const CUSTOMER_COLUMNS = [
  'id', 'created_at', 'created_by', 'customer_type', 'status',
  'first_name', 'last_name', 'email', 'phone', 'street', 'zip', 'city', 'country',
  'date_of_birth', 'job_type', 'job',
  'company_name', 'org_type', 'firmenbuchnummer', 'gisa_number',
  'rep_first_name', 'rep_last_name', 'rep_email', 'rep_phone', 'rep_street', 'rep_zip', 'rep_city', 'rep_country',
  'rep_date_of_birth', 'rep_job_type', 'rep_job',
  'insurance_interests', 'prelim', 'registration_token', 'updated_at',
];

export function insertCustomer(db, c) {
  const id = crypto.randomUUID();
  const ts = now();
  const values = {
    ...Object.fromEntries(CUSTOMER_COLUMNS.map((k) => [k, null])),
    ...c,
    id,
    created_at: ts,
    updated_at: ts,
    insurance_interests: JSON.stringify(normalizeInterests(c.insurance_interests)),
    prelim: JSON.stringify(safeJson(c.prelim, {})),
  };
  const cols = CUSTOMER_COLUMNS.join(', ');
  const placeholders = CUSTOMER_COLUMNS.map(() => '?').join(', ');
  db.prepare(`INSERT INTO customers (${cols}) VALUES (${placeholders})`).run(...CUSTOMER_COLUMNS.map((k) => values[k]));
  return getCustomer(db, id);
}

export function getCustomer(db, id) {
  return rowToCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
}

export function getCustomerByToken(db, token) {
  return rowToCustomer(db.prepare('SELECT * FROM customers WHERE registration_token = ?').get(token));
}

export function listCustomers(db) {
  return db.prepare('SELECT * FROM customers ORDER BY created_at DESC').all().map(rowToCustomer);
}

export function updateCustomer(db, id, fields) {
  const allowed = new Set([...CUSTOMER_COLUMNS, 'status', 'registration_token']);
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.has(k)) continue;
    if (k === 'insurance_interests') { sets.push(`${k} = ?`); params.push(JSON.stringify(normalizeInterests(v))); continue; }
    if (k === 'prelim') { sets.push(`${k} = ?`); params.push(JSON.stringify(safeJson(v, {}))); continue; }
    sets.push(`${k} = ?`);
    params.push(v ?? null);
  }
  if (!sets.length) return getCustomer(db, id);
  sets.push('updated_at = ?');
  params.push(now(), id);
  db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getCustomer(db, id);
}

export function setRegistrationToken(db, id) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE customers SET registration_token = ?, updated_at = ? WHERE id = ?').run(token, now(), id);
  return token;
}

export function addEmail(db, { customerId, to, subject, body, link, status = 'queued' }) {
  const res = db.prepare('INSERT INTO emails (customer_id, to_email, subject, body, link, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(customerId ?? null, to, subject, body, link ?? null, now(), status);
  return { id: Number(res.lastInsertRowid), customerId, to, subject, body, link, status, created_at: now() };
}

export function listEmails(db) {
  return db.prepare('SELECT * FROM emails ORDER BY id DESC').all();
}

export function createSignatureProcess(db, { customerId, mode, createdBy }) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO signature_processes (id, customer_id, mode, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, customerId, mode, 'open', now(), createdBy ?? null);
  return { id, customerId, mode, status: 'open', created_at: now(), createdBy };
}

export function addSignatureDocument(db, doc) {
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(`INSERT INTO signature_documents (id, process_id, customer_id, template_key, title, external_id, signing_url, signing_token, signer_email, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, doc.processId, doc.customerId, doc.templateKey, doc.title, doc.externalId ?? null,
      doc.signingUrl ?? null, doc.signingToken ?? null, doc.signerEmail ?? null, doc.status ?? 'open', ts, ts);
  return getSignatureDocument(db, id);
}

export function getSignatureDocument(db, id) {
  return db.prepare('SELECT * FROM signature_documents WHERE id = ?').get(id);
}

export function getSignatureDocumentByToken(db, token) {
  return db.prepare('SELECT * FROM signature_documents WHERE signing_token = ?').get(token);
}

export function getSignatureDocumentByExternalId(db, externalId) {
  return db.prepare('SELECT * FROM signature_documents WHERE external_id = ?').get(externalId);
}

export function listSignatureDocuments(db, customerId) {
  return db.prepare('SELECT * FROM signature_documents WHERE customer_id = ? ORDER BY created_at ASC').all(customerId);
}

export function listProcessDocuments(db, processId) {
  return db.prepare('SELECT * FROM signature_documents WHERE process_id = ? ORDER BY created_at ASC').all(processId);
}

export function listSignatureProcesses(db, customerId) {
  return db.prepare('SELECT * FROM signature_processes WHERE customer_id = ? ORDER BY created_at DESC').all(customerId);
}

export function updateSignatureDocumentStatus(db, id, status) {
  db.prepare('UPDATE signature_documents SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  return getSignatureDocument(db, id);
}

export function updateSignatureProcessStatus(db, processId, status) {
  db.prepare('UPDATE signature_processes SET status = ? WHERE id = ?').run(status, processId);
}

export function recomputeProcessStatus(db, processId) {
  const docs = listProcessDocuments(db, processId);
  let status = 'open';
  if (docs.length && docs.every((d) => d.status === 'signed')) status = 'signed';
  else if (docs.length && docs.every((d) => d.status === 'cancelled')) status = 'cancelled';
  updateSignatureProcessStatus(db, processId, status);
  return status;
}
