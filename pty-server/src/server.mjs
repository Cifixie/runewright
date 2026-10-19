import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createSessionRegistry } from './sessions.mjs';

function authorizeUpgrade(req, socket, { allowedOrigin, token }) {
  let url;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
  } catch {
    socket.destroy();
    return null;
  }

  const sessionId = url.searchParams.get('session');
  const suppliedToken = url.searchParams.get('token') ?? '';
  const tokenMatches = suppliedToken.length === token.length &&
    timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(token));
  if (
    req.headers.origin !== allowedOrigin ||
    url.pathname !== '/pty' ||
    !tokenMatches ||
    !sessionId ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  return sessionId;
}

export function createPtyServer(config) {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const sessions = createSessionRegistry(config.workspaces, config);

  webSocketServer.on('connection', (client, _request, sessionId) => sessions.attach(client, sessionId));
  server.on('upgrade', (req, socket, head) => {
    const sessionId = authorizeUpgrade(req, socket, config);
    if (!sessionId) return;
    webSocketServer.handleUpgrade(req, socket, head, (client) => {
      webSocketServer.emit('connection', client, req, sessionId);
    });
  });

  server.on('listening', () => {
    console.log(`PTY sidecar listening on ws://127.0.0.1:${config.port}/pty`);
    console.log(`Allowed origin: ${config.allowedOrigin}`);
    console.log(`Available workspace sessions: ${[...config.workspaces.keys()].join(', ')}`);
    console.log(`Token file: ${config.tokenFile}`);
  });

  let closing;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      sessions.killAll();
      webSocketServer.close();
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    })();
    return closing;
  }

  return {
    listen() {
      server.listen(config.port, '127.0.0.1');
    },
    close,
  };
}
