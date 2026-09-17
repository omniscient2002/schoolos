// Entrypoint.
import { buildApp } from './app.js';
import { config } from './config.js';
import { buildInfoLine } from './build-info.js';

if (process.env.WORKER_ROLE === '1') {
  console.error('WORKER_ROLE=1 on the HTTP entrypoint — the API would boot with prod guards disabled. Use scripts/outbox-worker.js for workers.');
  process.exit(1);
}

const app = await buildApp();
try {
  await app.listen({ port: config.port, host: config.host });
  // OPS-11: emitted AFTER listen succeeds, so the line is present in the logs of every container that actually
  // served traffic — a boot log written before listen would appear on a container that crashed on bind, which
  // is exactly the case where "which build tried to start?" is the wrong question to answer with a stale id.
  app.log.info(`SchoolOS API on :${config.port} [${config.env}]`);
  app.log.info(buildInfoLine());
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    app.log.info(`${sig} — shutting down`);
    app.schoolosDraining = true;
    setTimeout(() => { app.log.error('graceful close hung — forcing exit'); process.exit(1); }, 15000).unref();
    try { await app.close(); } catch (e) { app.log.error(e); }
    process.exit(0);
  });
}
process.on('unhandledRejection', (err) => app.log.error({ err }, 'unhandled rejection'));
process.on('uncaughtException', (err) => { app.log.error({ err }, 'uncaught exception — exiting'); process.exit(1); });
