import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'app.db'),
  templateDir: process.env.TEMPLATE_DIR || path.join(root, 'data', 'templates'),
  skribbleMode: process.env.SKRIBBLE_MODE || 'auto',
  skribbleApiKey: process.env.SKRIBBLE_API_KEY || '',
  skribbleApiBase: (process.env.SKRIBBLE_API_BASE || 'https://api.skribble.com/v2').replace(/\/$/, ''),
  skribbleWebhookSecret: process.env.SKRIBBLE_WEBHOOK_SECRET || '',
};

export default config;
