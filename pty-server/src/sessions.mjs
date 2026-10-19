import pty from 'node-pty';
import { WebSocket } from 'ws';

const scrollbackLimit = 200_000;
const maxInputLength = 8192;
const maxCols = 500;
const maxRows = 300;

function send(client, message) {
  if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
}

function broadcast(session, message) {
  const payload = JSON.stringify(message);
  for (const client of session.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function createSession(sessionId, cwd, shell, command, sessions) {
  const terminal = pty.spawn(shell, [], {
    cwd,
    cols: 120,
    rows: 30,
    env: process.env,
    ...(process.platform === 'win32' ? { useConpty: true } : {}),
  });
  const session = { terminal, buffer: '', clients: new Set() };
  sessions.set(sessionId, session);

  terminal.onData((data) => {
    session.buffer = (session.buffer + data).slice(-scrollbackLimit);
    broadcast(session, { type: 'output', data });
  });
  terminal.onExit(({ exitCode, signal }) => {
    if (sessions.get(sessionId) === session) sessions.delete(sessionId);
    broadcast(session, { type: 'exit', exitCode, signal });
    for (const client of session.clients) client.close(1000, 'PTY exited');
    session.clients.clear();
  });
  if (command) terminal.write(`${command}\r`);
  return session;
}

function handleMessage(client, session, raw, isBinary) {
  if (isBinary) {
    client.close(1003, 'JSON text messages required');
    return;
  }

  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    client.close(1007, 'Invalid JSON');
    return;
  }

  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    client.close(1007, 'Invalid message');
  } else if (message.type === 'input' && typeof message.data === 'string' && message.data.length <= maxInputLength) {
    session.terminal.write(message.data);
  } else if (
    message.type === 'resize' &&
    Number.isInteger(message.cols) && Number.isInteger(message.rows) &&
    message.cols >= 2 && message.cols <= maxCols && message.rows >= 1 && message.rows <= maxRows
  ) {
    session.terminal.resize(message.cols, message.rows);
  } else if (message.type === 'kill') {
    session.terminal.kill();
  } else {
    client.close(1008, 'Unsupported or invalid message');
  }
}

export function createSessionRegistry(workspaces, { shell, command }) {
  const sessions = new Map();
  const defaultCwd = workspaces.values().next().value;

  function attach(client, sessionId) {
    let session = sessions.get(sessionId);
    if (!session) {
      const cwd = workspaces.get(sessionId) ?? defaultCwd;
      try {
        session = createSession(sessionId, cwd, shell, command, sessions);
      } catch (error) {
        send(client, { type: 'error', message: `Could not start PTY: ${error.message}` });
        client.close(1011, 'PTY could not start');
        return;
      }
    }

    send(client, { type: 'output', data: session.buffer });
    session.clients.add(client);
    client.on('message', (raw, isBinary) => handleMessage(client, session, raw, isBinary));
    client.on('close', () => session.clients.delete(client));
    client.on('error', () => session.clients.delete(client));
  }

  function killAll() {
    for (const session of sessions.values()) session.terminal.kill();
  }

  return { attach, killAll };
}
