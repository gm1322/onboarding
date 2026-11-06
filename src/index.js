import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';
import { openDb } from './db.js';
import { createEmailService } from './email.js';
import { createSkribbleClient } from './skribble.js';
import { ensureTemplateFiles } from './templates.js';
import { createServer } from './server.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
ensureTemplateFiles(config.templateDir);

const db = openDb(config.dbPath);
const email = createEmailService(db);
const skribble = createSkribbleClient({
  mode: config.skribbleMode,
  apiKey: config.skribbleApiKey,
  apiBase: config.skribbleApiBase,
  appBaseUrl: config.baseUrl,
  db,
});

console.log(`Skribble client mode: ${skribble.mode}${skribble.mode === 'real' ? ` (${config.skribbleApiBase})` : ' (local mock - set SKRIBBLE_API_KEY for the real API)'}`);

const server = createServer({ db, config, email, skribble });
server.listen(config.port, () => {
  console.log(`Customer onboarding app listening on ${config.baseUrl}`);
  console.log(`Dashboard: ${config.baseUrl}/   Dev outbox: ${config.baseUrl}/outbox`);
});
