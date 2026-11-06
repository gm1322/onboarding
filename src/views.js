import { INSURANCES, JOB_TYPES, ORG_TYPES, COUNTRIES, TEMPLATES, customerDisplayName, customerEmail, insuranceLabel } from './catalog.js';
import { normalizeInterests, safeJson } from './validate.js';

export const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const badge = (kind, label) => `<span class="badge ${kind}">${esc(label)}</span>`;

export const statusBadge = (status) => (status === 'complete' ? badge('ok', 'Complete') : badge('warn', 'Registration pending'));

const sigStatusBadge = (status) => {
  if (status === 'signed') return badge('ok', 'Signed');
  if (status === 'cancelled') return badge('bad', 'Cancelled');
  return badge('info', 'Open');
};

function layout(title, content, { notice = '', error = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Customer Onboarding</title>
<link rel="stylesheet" href="/public/style.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">Customer Onboarding</a>
  <nav>
    <a href="/">Dashboard</a>
    <a href="/customers/new">New customer</a>
    <a href="/outbox">Email outbox (dev)</a>
  </nav>
</header>
<main>
${notice ? `<div class="notice">${esc(notice)}</div>` : ''}
${error ? `<div class="alert">${esc(error)}</div>` : ''}
${content}
</main>
</body>
</html>`;
}

const field = (name, label, value, type = 'text', extra = '') =>
  `<label class="f"><span>${esc(label)}</span><input type="${type}" name="${esc(name)}" value="${esc(value ?? '')}" ${extra}></label>`;

const selectField = (name, label, options, value, { includeEmpty = true } = {}) => {
  const opts = options.map((o) => {
    const key = typeof o === 'string' ? o : o.key;
    const lbl = typeof o === 'string' ? o.replace(/_/g, ' ') : o.label;
    return `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(lbl)}</option>`;
  }).join('');
  const empty = includeEmpty ? `<option value="">-</option>` : '';
  return `<label class="f"><span>${esc(label)}</span><select name="${esc(name)}">${empty}${opts}</select></label>`;
};

function questionField(insKey, q, value) {
  const name = `prelim[${insKey}][${q.key}]`;
  if (q.type === 'select') {
    return selectField(name, q.label, q.options, value);
  }
  if (q.type === 'multiselect') {
    const arr = Array.isArray(value) ? value : value ? [value] : [];
    const boxes = q.options.map((o) => {
      const key = typeof o === 'string' ? o : o.key;
      const lbl = typeof o === 'string' ? o.replace(/_/g, ' ') : o.label;
      return `<label class="check"><input type="checkbox" name="${esc(name)}" value="${esc(key)}" ${arr.includes(key) ? 'checked' : ''}> ${esc(lbl)}</label>`;
    }).join('');
    return `<fieldset class="f"><legend>${esc(q.label)}</legend>${boxes}</fieldset>`;
  }
  return field(name, q.label, Array.isArray(value) ? value.join(', ') : value, q.type === 'number' ? 'number' : 'text');
}

export function insuranceSection(values) {
  const selected = normalizeInterests(values?.insurance_interests);
  const prelim = safeJson(values?.prelim, {});
  return `<fieldset class="ins-group">
  <legend>Insurance interests <small>(select all that apply; preliminary info is used for a first offer)</small></legend>
  ${INSURANCES.map((ins) => {
    const checked = selected.includes(ins.key);
    const qs = ins.questions.map((q) => questionField(ins.key, q, prelim[ins.key]?.[q.key])).join('');
    return `<div class="ins-block">
      <label class="check big"><input type="checkbox" name="insurance_interests" value="${esc(ins.key)}" data-ins="${esc(ins.key)}" ${checked ? 'checked' : ''}> <strong>${esc(ins.label)}</strong></label>
      <details class="ins-questions" id="ins-${esc(ins.key)}" ${checked ? 'open' : ''}>
        <summary>Preliminary information</summary>
        <div class="ins-q">${qs}</div>
      </details>
    </div>`;
  }).join('')}
  <script>
  document.querySelectorAll('input[name="insurance_interests"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      var d = document.getElementById('ins-' + cb.getAttribute('data-ins'));
      if (d) d.open = cb.checked;
    });
  });
  </script>
</fieldset>`;
}

function personSection(values, prefix = '') {
  const v = (k) => values?.[prefix + k];
  return `<div class="grid2">
    ${field(prefix + 'first_name', 'First name', v('first_name'))}
    ${field(prefix + 'last_name', 'Last name', v('last_name'))}
    ${field(prefix + 'email', 'Email', v('email'), 'email')}
    ${field(prefix + 'phone', 'Phone', v('phone'))}
    ${field(prefix + 'street', 'Street', v('street'))}
    ${field(prefix + 'zip', 'ZIP', v('zip'))}
    ${field(prefix + 'city', 'City', v('city'))}
    ${selectField(prefix + 'country', 'Country', COUNTRIES, v('country'))}
    ${field(prefix + 'date_of_birth', 'Date of birth', v('date_of_birth'), 'date')}
    ${selectField(prefix + 'job_type', 'Job type', JOB_TYPES, v('job_type'))}
    ${field(prefix + 'job', 'Job / occupation', v('job'))}
  </div>`;
}

function orgSection(values) {
  const v = (k) => values?.[k];
  return `<div class="grid2">
    ${field('company_name', 'Company name', v('company_name'))}
    ${selectField('org_type', 'Organization type', ORG_TYPES, v('org_type'))}
    ${field('firmenbuchnummer', 'Firmenbuchnummer (if available)', v('firmenbuchnummer'))}
    ${field('gisa_number', 'GISA number (if available)', v('gisa_number'))}
  </div>
  <h3>Representative</h3>
  ${personSection(values, 'rep_')}`;
}

export function dashboardPage(customers, sigByCustomer) {
  const rows = customers.map((c) => {
    const sigs = sigByCustomer.get(c.id) || [];
    let sigBadge = badge('muted', 'No signature');
    if (sigs.length) {
      if (sigs.every((d) => d.status === 'signed')) sigBadge = badge('ok', 'Signed');
      else if (sigs.some((d) => d.status === 'open')) sigBadge = badge('info', 'Signature open');
      else sigBadge = badge('bad', 'Signature cancelled');
    }
    return `<tr>
      <td><a href="/customers/${c.id}">${esc(customerDisplayName(c))}</a></td>
      <td>${esc(c.customer_type)}</td>
      <td>${esc(customerEmail(c) || '')}</td>
      <td>${statusBadge(c.status)}</td>
      <td>${sigBadge}</td>
      <td class="muted">${esc((c.created_at || '').slice(0, 16).replace('T', ' '))}</td>
    </tr>`;
  }).join('');
  return layout('Dashboard', `
  <div class="row between">
    <h1>Customers</h1>
    <a class="btn" href="/customers/new">+ New customer</a>
  </div>
  <table class="table">
    <thead><tr><th>Customer</th><th>Type</th><th>Email</th><th>Registration</th><th>Signature</th><th>Created</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" class="muted">No customers yet.</td></tr>'}</tbody>
  </table>`);
}

export function newCustomerPage({ values = {}, errors = [] } = {}) {
  const type = values.customer_type || 'person';
  const errorHtml = errors.length ? `<ul class="alert">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  return layout('New customer', `
  <h1>New customer</h1>
  <p class="muted">Enter the registration data already available. If anything required is missing, an email with a completion link is sent to the customer automatically; otherwise this step is skipped.</p>
  ${errorHtml}
  <form method="post" action="/customers" class="card">
    <fieldset><legend>Customer type</legend>
      <label class="check"><input type="radio" name="customer_type" value="person" ${type === 'person' ? 'checked' : ''}> Person</label>
      <label class="check"><input type="radio" name="customer_type" value="organization" ${type === 'organization' ? 'checked' : ''}> Organization (with representative)</label>
    </fieldset>
    <label class="f"><span>Created by (employee)</span><input type="text" name="created_by" value="${esc(values.created_by || '')}"></label>
    <div id="section-person" ${type === 'organization' ? 'hidden' : ''}>
      <h3>Person</h3>
      ${personSection(values)}
    </div>
    <div id="section-org" ${type === 'person' ? 'hidden' : ''}>
      <h3>Organization</h3>
      ${orgSection(values)}
    </div>
    ${insuranceSection(values)}
    <button class="btn primary" type="submit">Create customer</button>
  </form>
  <script>
  document.querySelectorAll('input[name="customer_type"]').forEach(function (r) {
    r.addEventListener('change', function () {
      var v = document.querySelector('input[name="customer_type"]:checked').value;
      document.getElementById('section-person').hidden = v !== 'person';
      document.getElementById('section-org').hidden = v !== 'organization';
    });
  });
  </script>`);
}

const kv = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v ?? '') || '<span class="muted">-</span>'}</td></tr>`;

function detailTable(c) {
  if (c.customer_type === 'organization') {
    return `<table class="kv">
      ${kv('Company', c.company_name)}
      ${kv('Organization type', ORG_TYPES.find((o) => o.key === c.org_type)?.label || c.org_type)}
      ${kv('Firmenbuchnummer', c.firmenbuchnummer)}
      ${kv('GISA number', c.gisa_number)}
    </table>
    <h3>Representative</h3>
    <table class="kv">
      ${kv('Name', `${c.rep_first_name || ''} ${c.rep_last_name || ''}`)}
      ${kv('Email', c.rep_email)}
      ${kv('Phone', c.rep_phone)}
      ${kv('Address', [c.rep_street, c.rep_zip, c.rep_city, c.rep_country].filter(Boolean).join(', '))}
      ${kv('Date of birth', c.rep_date_of_birth)}
      ${kv('Job type', JOB_TYPES.find((j) => j.key === c.rep_job_type)?.label || c.rep_job_type)}
      ${kv('Job', c.rep_job)}
    </table>`;
  }
  return `<table class="kv">
    ${kv('Name', `${c.first_name || ''} ${c.last_name || ''}`)}
    ${kv('Email', c.email)}
    ${kv('Phone', c.phone)}
    ${kv('Address', [c.street, c.zip, c.city, c.country].filter(Boolean).join(', '))}
    ${kv('Date of birth', c.date_of_birth)}
    ${kv('Job type', JOB_TYPES.find((j) => j.key === c.job_type)?.label || c.job_type)}
    ${kv('Job', c.job)}
  </table>`;
}

function interestsTable(c) {
  const interests = normalizeInterests(c.insurance_interests);
  if (!interests.length) return '<p class="muted">No insurance interests selected.</p>';
  const prelim = safeJson(c.prelim, {});
  const items = interests.map((key) => {
    const ins = INSURANCES.find((i) => i.key === key);
    const answers = ins ? ins.questions.map((q) => {
      const v = prelim[key]?.[q.key];
      const shown = Array.isArray(v) ? v.map((x) => x.replace(/_/g, ' ')).join(', ') : (v ?? '');
      return v === undefined || v === '' ? '' : `<li><strong>${esc(q.label)}:</strong> ${esc(shown)}</li>`;
    }).filter(Boolean).join('') : '';
    return `<li><strong>${esc(insuranceLabel(key))}</strong>${answers ? `<ul>${answers}</ul>` : ''}</li>`;
  }).join('');
  return `<ul class="interests">${items}</ul>`;
}

export function customerDetailPage({ customer: c, processes, docsByProcess, templates, notice = '', error = '' }) {
  const canSign = c.status === 'complete';
  const sigHtml = processes.map((p) => {
    const docs = docsByProcess.get(p.id) || [];
    const rows = docs.map((d) => `<tr>
      <td>${esc(d.title)}</td>
      <td>${esc(d.signer_email || '')}</td>
      <td>${sigStatusBadge(d.status)}</td>
      <td>${d.signing_url ? `<a href="${esc(d.signing_url)}" target="_blank" rel="noopener">open signing link</a>` : '<span class="muted">-</span>'}</td>
      <td><form method="post" action="/signatures/${d.id}/refresh" class="inline"><button class="btn small" type="submit">refresh</button></form></td>
    </tr>`).join('');
    return `<div class="card">
      <div class="row between"><strong>Process ${esc(p.id.slice(0, 8))}</strong> ${sigStatusBadge(p.status)} <span class="muted">mode: ${esc(p.mode)} - ${esc((p.created_at || '').slice(0, 16).replace('T', ' '))}</span></div>
      <table class="table"><thead><tr><th>Document</th><th>Signer</th><th>Status</th><th>Link</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  }).join('') || '<p class="muted">No signature process started yet.</p>';

  const tplBoxes = templates.map((t) => `<label class="check"><input type="checkbox" name="templates" value="${esc(t.key)}" checked> ${esc(t.title)}</label>`).join('');
  const email = customerEmail(c) || '';

  return layout(customerDisplayName(c), `
  <div class="row between">
    <h1>${esc(customerDisplayName(c))}</h1>
    <div>${statusBadge(c.status)} <span class="muted">${esc(c.customer_type)}</span></div>
  </div>
  <div class="card">
    <h2>Registration data</h2>
    ${detailTable(c)}
    <h3>Insurance interests &amp; preliminary information</h3>
    ${interestsTable(c)}
    <div class="row">
      <form method="post" action="/customers/${c.id}/email" class="inline">
        <button class="btn" type="submit" ${c.status === 'complete' ? 'disabled' : ''}>Send / resend registration email</button>
      </form>
    </div>
  </div>
  <div class="card">
    <h2>Signature process (Skribble)</h2>
    ${canSign ? `<form method="post" action="/customers/${c.id}/signatures">
      <fieldset><legend>Documents</legend>${tplBoxes}</fieldset>
      <fieldset><legend>Delivery</legend>
        <label class="check"><input type="radio" name="mode" value="email" checked> Send by email (customer not present)</label>
        <label class="check"><input type="radio" name="mode" value="onsite"> Sign on site (touchpad - signing link shown here)</label>
      </fieldset>
      ${field('signer_email', 'Signer email', email, 'email')}
      ${field('created_by', 'Started by (employee)', '')}
      <button class="btn primary" type="submit">Start signature process</button>
    </form>` : '<p class="muted">Complete the registration first to start a signature process.</p>'}
    ${sigHtml}
  </div>`, { notice, error });
}

export function processPage({ customer: c, process, docs }) {
  const rows = docs.map((d) => `<tr>
    <td>${esc(d.title)}</td>
    <td>${sigStatusBadge(d.status)}</td>
    <td>${d.signing_url ? `<a class="btn small" href="${esc(d.signing_url)}" target="_blank" rel="noopener">Open signing link (touchpad)</a> <code>${esc(d.signing_url)}</code>` : '<span class="muted">-</span>'}</td>
  </tr>`).join('');
  return layout('Signature process', `
  <p><a href="/customers/${c.id}">&larr; back to ${esc(customerDisplayName(c))}</a></p>
  <h1>Signature process ${esc(process.id.slice(0, 8))}</h1>
  <p>Mode: <strong>${esc(process.mode)}</strong> ${sigStatusBadge(process.status)}</p>
  ${process.mode === 'onsite' ? '<p class="notice">Open the signing link on the customer\'s tablet (touchpad) and let the customer sign directly.</p>' : ''}
  <table class="table"><thead><tr><th>Document</th><th>Status</th><th>Signing link</th></tr></thead><tbody>${rows}</tbody></table>`);
}

export function registerPage({ token, customer: c, values, errors = [] }) {
  const v = (k) => values?.[k] ?? c[k] ?? '';
  const errorHtml = errors.length ? `<ul class="alert">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '';
  const body = c.customer_type === 'organization' ? orgSection(values || c) : personSection(values || c);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Complete your registration</title>
<link rel="stylesheet" href="/public/style.css">
</head>
<body>
<main class="narrow">
<h1>Complete your registration</h1>
<p class="muted">You are registering as <strong>${esc(c.customer_type)}</strong>. Please fill in the missing information.</p>
${errorHtml}
<form method="post" action="/register/${esc(token)}" class="card">
  <input type="hidden" name="customer_type" value="${esc(c.customer_type)}">
  ${body}
  ${insuranceSection(values || c)}
  <button class="btn primary" type="submit">Submit registration</button>
</form>
</main>
</body>
</html>`;
}

export function registerDonePage(c) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Registration complete</title>
<link rel="stylesheet" href="/public/style.css"></head>
<body><main class="narrow">
<div class="card center">
  <h1>Thank you, ${esc(customerDisplayName(c))}!</h1>
  <p>Your registration is complete. Our team will get in touch with you regarding the next steps (offers and signature).</p>
</div>
</main></body></html>`;
}

export function outboxPage(emails) {
  const rows = emails.map((e) => `<tr>
    <td>${esc(String(e.id))}</td>
    <td>${esc(e.to_email)}</td>
    <td>${esc(e.subject)}</td>
    <td>${e.link ? `<a href="${esc(e.link)}">${esc(e.link)}</a>` : '<span class="muted">-</span>'}</td>
    <td class="muted">${esc((e.created_at || '').slice(0, 19).replace('T', ' '))}</td>
  </tr>`).join('');
  return layout('Email outbox (dev)', `
  <h1>Email outbox (dev)</h1>
  <p class="muted">In this demo, outgoing emails are stored here instead of being sent via SMTP.</p>
  <table class="table"><thead><tr><th>#</th><th>To</th><th>Subject</th><th>Link</th><th>Queued at</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="muted">No emails yet.</td></tr>'}</tbody></table>`);
}

export function signPage(doc, c) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign: ${esc(doc.title)}</title>
<link rel="stylesheet" href="/public/style.css"></head>
<body><main class="narrow">
<div class="card center">
  <h1>${esc(doc.title)}</h1>
  <p>Customer: <strong>${esc(customerDisplayName(c))}</strong></p>
  <p class="muted">Demo signing page (mock Skribble). In production this link opens the Skribble signing view (${esc(doc.external_id ? 'external' : '')} id ${esc(doc.external_id || '')}).</p>
  ${doc.status === 'signed' ? '<p class="badge ok">Already signed</p>' : `<form method="post" action="/sign/${esc(doc.signing_token)}"><button class="btn primary big" type="submit">Sign now</button></form>`}
</div>
</main></body></html>`;
}

export function signDonePage(doc, c) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signed</title>
<link rel="stylesheet" href="/public/style.css"></head>
<body><main class="narrow">
<div class="card center">
  <h1>Document signed</h1>
  <p><strong>${esc(doc.title)}</strong> for ${esc(customerDisplayName(c))} has been signed. You can close this window.</p>
</div>
</main></body></html>`;
}

export function errorPage(status, message) {
  return layout(`Error ${status}`, `<div class="card"><h1>Error ${status}</h1><p>${esc(message)}</p><p><a href="/">Back to dashboard</a></p></div>`);
}
