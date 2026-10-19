import { unlink } from 'node:fs/promises';
import { loadConfig } from './src/config.mjs';
import { createPtyServer } from './src/server.mjs';

const config = await loadConfig();
const server = createPtyServer(config);
server.listen();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await server.close();
  } finally {
    await unlink(config.tokenFile).catch(() => {});
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
