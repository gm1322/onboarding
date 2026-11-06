# Customer Onboarding App

Full-stack onboarding flow for insurance customers, built with **Node.js 22+ and zero external
dependencies** (uses the built-in `node:http` server and `node:sqlite` database).

## The flow

1. **Employee creates the customer** in the dashboard (`/customers/new`) with whatever
   registration data is already available (person *or* organization with representative).
2. **Completeness check**: if all required fields are present, the entry is marked
   **Complete** immediately and the email step is skipped. Otherwise a registration token is
   created and an **email with a completion link** is queued to the customer
   (visible in the dev outbox at `/outbox`).
3. **Customer completes the registration** via the emailed link (`/register/<token>`):
   - Person: name, address, date of birth, job type (`school` / `student` / `self` /
     `employee`), job.
   - Organization: company name, type (private company, club/association, ...),
     Firmenbuchnummer **or** GISA number if available, plus the representative's personal data.
   - Both: multi-select list of insurance interests (home, contents, accident, liability,
     health, life, legal, motor) — each interest expands to the **preliminary information
     needed for a first offer** (e.g. square meters / building type / plan for home, sports
     activities for accident).
4. On successful submit the entry is marked **Complete** in the dashboard (green badge).
5. **Signature process via the Skribble v2 API**: the employee selects one or more of the
   three document templates and the delivery mode:
   - `authorization` – Authorization (Vollmacht)
   - `broker_contract` – Broker contract (Maklervertrag)
   - `health_gdpr` – Health-data consent under GDPR Art. 9 (DSGVO)
   - **email**: Skribble mails the signer a signing link (customer not present).
   - **onsite**: a signing link is shown in the app to be opened on the customer's tablet
     (touchpad) — in real mode the Skribble `signing_url` gets an `exitURL` back to the
     customer record.
   Status is tracked per document and per process, updated via the Skribble **webhook**
   (`POST /webhooks/skribble`) and/or manual refresh (`POST /signatures/:docId/refresh`).

## Run

```bash
cd onboarding-app
npm start          # http://localhost:3000
npm test           # integration tests (node:test, in-memory DB)
```

Dashboard: `http://localhost:3000/` · Dev email outbox: `http://localhost:3000/outbox`

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `APP_BASE_URL` | `http://localhost:$PORT` | Base URL used in email/signing links |
| `DB_PATH` | `data/app.db` | SQLite database file |
| `SKRIBBLE_MODE` | `auto` | `auto` / `real` / `mock` |
| `SKRIBBLE_API_KEY` | *(empty)* | Skribble v2 API key (demo key works; quality `DEMO`). If set, mode `auto` uses the real API; otherwise a local mock is used so the whole flow works offline |
| `SKRIBBLE_API_BASE` | `https://api.skribble.com/v2` | Skribble API v2 base URL |
| `SKRIBBLE_WEBHOOK_SECRET` | *(empty)* | If set, `POST /webhooks/skribble` requires header `x-webhook-secret` to match |

## Skribble v2 integration (`src/skribble.js`)

- Auth: `Authorization: Bearer <SKRIBBLE_API_KEY>`.
- One signature request per document:
  `POST {SKRIBBLE_API_BASE}/signature-requests` with JSON
  `{ title, message, content: <base64 PDF>, signatures: [{ account_email, notify: true }] }`
  (v2 field name `account_email`, formerly `signer_email_address`).
- Response fields used: `id`, `signing_url`, `status_overall`, `quality`, `signatures[].status_code`.
- Status polling: `GET {SKRIBBLE_API_BASE}/signature-requests/{id}`.
- Onsite mode appends `?exitURL=<APP_BASE_URL>/customers/<id>&hidedownload=true` to the
  `signing_url` so the tablet returns to the customer record after signing.
- Webhook: register `POST {APP_BASE_URL}/webhooks/skribble` in the Skribble account;
  payloads with `signature_request_id` / `status_overall` update the local status
  (`OPEN` → open, `SIGNED` → signed, `CANCELLED`/`DECLINED`/`EXPIRED` → cancelled).
- The three PDF templates are generated at startup into `data/templates/` and personalized
  per customer (name, date) at signature time; generic copies can be downloaded at
  `/templates/<key>.pdf`.
- With no API key, a **mock client** simulates Skribble locally: signing links point to
  `/sign/<token>`, where the demo signing page marks the document signed.

## HTTP API

| Method & path | Description |
|---|---|
| `GET /api/customers` | List customers incl. `complete`, `missing`, signatures |
| `POST /api/customers` | Create customer (JSON body). Returns `{ customer, emailed, missing }`; sends the completion email iff `emailed` |
| `GET /api/customers/:id` | Customer detail incl. signature processes/documents |
| `POST /api/customers/:id/email` | (Re)send the registration email |
| `POST /api/customers/:id/signatures` | Start signature process: `{ templates: [...], mode: "email"\|"onsite", signer_email? }` (requires complete registration) |
| `GET /api/customers/:id/signatures` | Signature processes with per-document status |
| `POST /signatures/:docId/refresh` | Refresh one document's status from Skribble (real mode) |
| `POST /webhooks/skribble` | Skribble webhook (`signature_request_id`, `status_overall`) |
| `GET /templates/:key.pdf` | Download a document template |
| `GET /healthz` | Health check |

HTML routes mirror the API: `/` (dashboard), `/customers/new`, `/customers/:id`,
`/customers/:id/signatures/:processId`, `/register/:token`, `/sign/:token`, `/outbox`.

## Data model (SQLite)

- `customers` – type (`person`/`organization`), status (`pending`/`complete`), person fields,
  organization fields (incl. `firmenbuchnummer`, `gisa_number`) and representative fields,
  `insurance_interests` (JSON), `prelim` (JSON), `registration_token`.
- `emails` – dev outbox of all queued emails with their links.
- `signature_processes` – one row per started signature process (`mode`, `status`).
- `signature_documents` – one row per template sent: `external_id` (Skribble id),
  `signing_url`, `signing_token`, `signer_email`, `status`.

## Production notes

- The dev email service writes to the `emails` outbox table (`src/email.js`); swap
  `createEmailService` for an SMTP/SendGrid/etc. implementation — the interface is a single
  `send({ to, subject, body, link, customerId })`.
- Add employee authentication in front of the dashboard/API routes (currently open, demo only).
- Serve behind TLS and set `SKRIBBLE_WEBHOOK_SECRET`; restrict `/webhooks/skribble` accordingly.
- `node:sqlite` is experimental in Node 22 — pin Node ≥ 22.5 or migrate `src/db.js` to your
  preferred database (the module is the only DB touchpoint).
