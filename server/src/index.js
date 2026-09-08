// Entrypoint.
import { buildApp } from './app.js';
import { config } from './config.js';

if (process.env.WORKER_ROLE === '1') {
  console.error('WORKER_ROLE=1 on the HTTP entrypoint — the API would boot with prod guards disabled. Use scripts/outbox-worker.js for workers.');
  process.exit(1);
}

const app = await buildApp();
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`SchoolOS API on :${config.port} [${config.env}]`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    app.log.info(`${sig} — shutting down`);
    setTimeout(() => { app.log.error('graceful close hung — forcing exit'); process.exit(1); }, 15000).unref();
    try { await app.close(); } catch (e) { app.log.error(e); }
    process.exit(0);
  });
}
process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandled rejection'));
process.on('uncaughtException', (err) => { app.log.error({ err }, 'uncaught exception — exiting'); process.exit(1); });
