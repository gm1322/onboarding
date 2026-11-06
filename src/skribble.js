import crypto from 'node:crypto';
import { getSignatureDocumentByExternalId } from './db.js';

const STATUS_MAP = {
  open: 'open',
  signed: 'signed',
  cancelled: 'cancelled',
  declined: 'cancelled',
  expired: 'cancelled',
};

export const mapStatus = (s) => STATUS_MAP[String(s || '').toLowerCase()] || 'open';

function normalizeSignatureRequest(data) {
  return {
    id: data.id,
    documentId: data.document_id ?? null,
    title: data.title ?? null,
    quality: data.quality ?? null,
    status: mapStatus(data.status_overall ?? data.status),
    signingUrl: data.signing_url ?? null,
    signatures: (data.signatures || []).map((s) => ({
      sid: s.sid,
      email: s.account_email ?? s.signer_email_address,
      status: mapStatus(s.status_code ?? s.status),
    })),
  };
}

class RealSkribbleClient {
  constructor({ apiKey, apiBase, appBaseUrl, fetchImpl }) {
    this.apiKey = apiKey;
    this.apiBase = apiBase;
    this.appBaseUrl = appBaseUrl;
    this.fetch = fetchImpl || globalThis.fetch;
    this.mode = 'real';
  }

  async request(pathname, options = {}) {
    const res = await this.fetch(`${this.apiBase}${pathname}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Skribble API ${options.method || 'GET'} ${pathname} failed: HTTP ${res.status} ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : {};
  }

  async createSignatureRequest({ title, message, contentBase64, signer, mode, exitUrl }) {
    const body = {
      title,
      message,
      content: contentBase64,
      signatures: [{ account_email: signer.email, notify: true }],
    };
    const data = await this.request('/signature-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const normalized = normalizeSignatureRequest(data);
    let signingUrl = normalized.signingUrl;
    if (signingUrl && mode === 'onsite' && exitUrl) {
      const sep = signingUrl.includes('?') ? '&' : '?';
      signingUrl = `${signingUrl}${sep}exitURL=${encodeURIComponent(exitUrl)}&hidedownload=true`;
    }
    return { ...normalized, signingUrl };
  }

  async getSignatureRequest(id) {
    const data = await this.request(`/signature-requests/${encodeURIComponent(id)}`);
    return normalizeSignatureRequest(data);
  }
}

class MockSkribbleClient {
  constructor({ appBaseUrl, db }) {
    this.appBaseUrl = appBaseUrl;
    this.db = db;
    this.mode = 'mock';
  }

  async createSignatureRequest({ title, signer }) {
    const token = crypto.randomBytes(16).toString('hex');
    const id = `mock-${token}`;
    return {
      id,
      documentId: id,
      title,
      quality: 'DEMO',
      status: 'open',
      signingUrl: `${this.appBaseUrl}/sign/${token}`,
      signingToken: token,
      signatures: [{ sid: `mock-s-${token}`, email: signer.email, status: 'open' }],
    };
  }

  async getSignatureRequest(externalId) {
    const doc = getSignatureDocumentByExternalId(this.db, externalId);
    if (!doc) throw new Error(`Unknown mock signature request: ${externalId}`);
    return {
      id: doc.external_id,
      title: doc.title,
      quality: 'DEMO',
      status: doc.status,
      signingUrl: doc.signing_url,
      signatures: [{ sid: `mock-s-${doc.signing_token}`, email: doc.signer_email, status: doc.status }],
    };
  }
}

export function createSkribbleClient({ mode = 'auto', apiKey = '', apiBase = 'https://api.skribble.com/v2', appBaseUrl, db, fetchImpl } = {}) {
  const useReal = mode === 'real' || (mode === 'auto' && !!apiKey);
  if (useReal) {
    if (!apiKey) throw new Error('SKRIBBLE_MODE=real requires SKRIBBLE_API_KEY');
    return new RealSkribbleClient({ apiKey, apiBase, appBaseUrl, fetchImpl });
  }
  return new MockSkribbleClient({ appBaseUrl, db });
}
