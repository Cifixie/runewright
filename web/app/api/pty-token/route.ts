import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';


export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const allowedOrigin = process.env.PTY_ALLOWED_ORIGIN ?? 'http://localhost:3000';
  const fetchSite = request.headers.get('sec-fetch-site');
  if ((origin && origin !== allowedOrigin) || fetchSite === 'cross-site') {
    return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const tokenFile = process.env.PTY_TOKEN_FILE ?? resolve(process.cwd(), '../pty-server/.runtime/token');
    const token = (await readFile(tokenFile, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid PTY token');
    return Response.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'PTY sidecar is not running' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
