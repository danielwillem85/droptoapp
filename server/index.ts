/**
 * DropToApp server: accounts (SQLite), the newsletter hook (Brevo) and the
 * built editor, which is only served to logged-in users.
 *
 *   npm run dev     development: this server + Vite with hot reload
 *   npm start       production: serves dist/ (run "npm run build" first)
 */
import { createServer } from 'node:http';
import { createApp } from './app';
import { purgeExpiredSessions } from './auth';
import { loadConfig, loadDotEnv } from './config';
import { openDb } from './db';

loadDotEnv();
const cfg = loadConfig();
const db = openDb(cfg.databasePath);
const app = createApp(cfg, db);

purgeExpiredSessions(db);
setInterval(() => purgeExpiredSessions(db), 60 * 60 * 1000).unref();

const server = createServer((req, res) => void app.handle(req, res));
server.listen(cfg.port, cfg.host, () => {
  console.log(`DropToApp server on http://${cfg.host}:${cfg.port}  (database: ${cfg.databasePath})`);
  if (!cfg.brevo.apiKey || !cfg.brevo.listId)
    console.warn('Newsletter sign-ups are not sent to Brevo: set BREVO_API_KEY and BREVO_LIST_ID in .env');
});

const shutdown = () => {
  server.close();
  void app.idle().finally(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
