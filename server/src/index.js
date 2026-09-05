// Entrypoint.
import { buildApp } from './app.js';
import { config } from './config.js';

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
    await app.close();
    process.exit(0);
  });
}
