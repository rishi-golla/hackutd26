// The local API the ear and mouth use (voice/README.md "Local API"): POST /transcript, GET /state, GET /health,
// and the WebSocket /mouth. Loopback only; nothing here is reachable from other devices.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { CONFIG, llmConfigured } from './config';
import type { Conn } from './db';
import { modelInUse } from './llm';
import { readState, stateJson } from './state';
import type { Brain } from './brain';
import type { Speaker } from './speaker';

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

export function startApi(conn: Conn, brain: Brain, speaker: Speaker) {
  let nextId = 1;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, {
          ok: true,
          db: `${CONFIG.dbName} @ ${CONFIG.spacetimeHost}`,
          mouth: speaker.connected,
          model: llmConfigured() ? modelInUse() : null,
        });
      }
      if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, stateJson(readState(conn)));
      if (req.method === 'POST' && url.pathname === '/transcript') {
        const body = await readJson(req);
        const text = String(body.text ?? '').trim();
        if (!text) return send(res, 400, { error: 'text required' });
        const id = String(nextId++);
        send(res, 202, { id });
        // Processing continues after the response; the result arrives as speech (callouts), not in the reply.
        brain.handleUtterance(text, String(body.source ?? 'api')).catch(err => console.error('[voice] utterance failed', err));
        return;
      }
      send(res, 404, { error: 'not found' });
    } catch (err) {
      send(res, 500, { error: String((err as Error).message) });
    }
  });

  const wss = new WebSocketServer({ server, path: '/mouth' });
  wss.on('connection', ws => speaker.attach(ws));

  server.listen(CONFIG.apiPort, '127.0.0.1', () => {
    console.log(`[voice] local API on http://127.0.0.1:${CONFIG.apiPort} (POST /transcript, GET /state, WS /mouth)`);
  });
  return server;
}
