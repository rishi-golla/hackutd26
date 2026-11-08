// The local API the ear and mouth use (voice/README.md "Local API"): POST /transcript, GET /state, GET /health,
// and the WebSocket /mouth. Loopback only; nothing here is reachable from other devices.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { CONFIG, llmConfigured } from './config';
import { step, type Conn } from './db';
import { modelInUse } from './llm';
import { conversationJson, readState, stateJson } from './state';
import { parseSeen } from './seen';
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
      if (req.method === 'GET' && url.pathname === '/conversation') return send(res, 200, conversationJson(conn));
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
      if (req.method === 'POST' && url.pathname === '/seen') {
        // One vision finding (voice/pipecat/vision.py): {"type": "id_card", "name", "birthDate"} or
        // {"type": "medication", "drug", "dose"?} or {"type": "aed_pads" | "airway_device" | "iv_io"}, plus
        // optional "confidence" and "detail" (where the evidence frame is).
        const finding = parseSeen(await readJson(req));
        if (!finding) return send(res, 400, { error: 'not a finding: type id_card (name, birthDate YYYY-MM-DD), medication (drug, dose?), aed_pads, airway_device or iv_io' });
        send(res, 202, { ok: true });
        brain.handleSeen(finding).catch(err => console.error('[voice] seen failed', err));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/trace') {
        // A trace row from the worker (the vision sampler's decisions): {"tool", "summary"} → agent_step, workflow voice.
        const body = await readJson(req);
        const summary = String(body.summary ?? '').trim();
        if (!summary) return send(res, 400, { error: 'summary required' });
        send(res, 202, { ok: true });
        void step(conn, String(body.tool ?? 'worker').slice(0, 40), summary);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/say') {
        // Fixed words from the worker (the answer to "Handoff, look"): {"text", "priority"?: 1-3, "kind"?: "ask"|"vision"}.
        const body = await readJson(req);
        const text = String(body.text ?? '').trim();
        if (!text) return send(res, 400, { error: 'text required' });
        const kind = body.kind === 'ask' ? 'ask' : 'vision';
        send(res, 202, { ok: true });
        brain.say(text, Number(body.priority ?? 2), kind).catch(err => console.error('[voice] say failed', err));
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
    console.log(`[voice] local API on http://127.0.0.1:${CONFIG.apiPort} (POST /transcript, POST /seen, POST /say, POST /trace, GET /state, GET /conversation, WS /mouth)`);
  });
  return server;
}
