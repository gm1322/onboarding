import { INSURANCES, JOB_TYPES, ORG_TYPES } from './catalog.js';

const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function normalizeInterests(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string' && v) return [v];
  return [];
}

export function safeJson(v, fallback) {
  if (v && typeof v === 'object') return v;
  if (typeof v === 'string' && v) {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return fallback;
}

export function baseRequiredFields(customerType) {
  if (customerType === 'organization') {
    return ['company_name', 'org_type', 'rep_first_name', 'rep_last_name', 'rep_email', 'rep_street', 'rep_zip', 'rep_city', 'rep_country'];
  }
  return ['first_name', 'last_name', 'email', 'street', 'zip', 'city', 'country', 'date_of_birth', 'job_type', 'job'];
}

export function missingFields(c) {
  const missing = [];
  for (const f of baseRequiredFields(c.customer_type)) {
    if (!str(c[f])) missing.push(f);
  }
  const interests = normalizeInterests(c.insurance_interests);
  if (!interests.length) {
    missing.push('insurance_interests');
  } else {
    const prelim = safeJson(c.prelim, {});
    for (const key of interests) {
      const ins = INSURANCES.find((i) => i.key === key);
      if (!ins) { missing.push(`unknown_insurance:${key}`); continue; }
      for (const q of ins.questions.filter((q) => q.required)) {
        const v = prelim?.[key]?.[q.key];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
          missing.push(`${key}.${q.key}`);
        }
      }
    }
  }
  return missing;
}

export const isComplete = (c) => missingFields(c).length === 0;

export function validateEnums(c) {
  const errors = [];
  if (c.customer_type === 'person') {
    if (c.job_type && !JOB_TYPES.some((j) => j.key === c.job_type)) errors.push('job_type');
  }
  if (c.customer_type === 'organization') {
    if (c.org_type && !ORG_TYPES.some((o) => o.key === c.org_type)) errors.push('org_type');
  }
  for (const key of normalizeInterests(c.insurance_interests)) {
    if (!INSURANCES.some((i) => i.key === key)) errors.push(`insurance:${key}`);
  }
  if (c.customer_type === 'person' && c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) errors.push('email');
  if (c.customer_type === 'organization' && c.rep_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.rep_email)) errors.push('rep_email');
  return errors;
}
