import { randomBytes } from 'node:crypto';
import { chmod, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

function readWorkspacePaths(value, baseDir) {
  let configured;
  try {
    configured = JSON.parse(value ?? JSON.stringify({ project: resolve(baseDir, '..') }));
  } catch {
    throw new Error('PTY_WORKSPACES must be a JSON object mapping workspace IDs to directory paths');
  }
  if (!configured || Array.isArray(configured) || typeof configured !== 'object') {
    throw new Error('PTY_WORKSPACES must be a JSON object mapping workspace IDs to directory paths');
  }
  return configured;
}

async function resolveWorkspaces(configured, baseDir) {
  const workspaces = new Map();
  for (const [id, path] of Object.entries(configured)) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || typeof path !== 'string') {
      throw new Error(`Invalid PTY_WORKSPACES entry: ${id}`);
    }
    workspaces.set(id, await realpath(resolve(baseDir, path)));
  }
  if (workspaces.size === 0) throw new Error('Configure at least one entry in PTY_WORKSPACES');
  return workspaces;
}

async function createTokenFile(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const token = randomBytes(32).toString('hex');
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}

export async function loadConfig(env = process.env) {
  const port = Number(env.PTY_PORT ?? 4001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PTY_PORT must be a valid TCP port');
  }
  const tokenFile = resolve(env.PTY_TOKEN_FILE ?? resolve(packageDir, '.runtime/token'));
  const workspaces = await resolveWorkspaces(readWorkspacePaths(env.PTY_WORKSPACES, packageDir), packageDir);
  const token = await createTokenFile(tokenFile);
  const shell = env.PTY_SHELL || (process.platform === 'win32' ? 'powershell.exe' : env.SHELL || '/bin/sh');

  return {
    allowedOrigin: env.PTY_ALLOWED_ORIGIN ?? 'http://localhost:3000',
    command: env.PTY_COMMAND ?? 'claude',
    port,
    shell,
    token,
    tokenFile,
    workspaces,
  };
}
