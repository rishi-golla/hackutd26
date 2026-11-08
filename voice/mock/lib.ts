// Shared terminal mouth and synthetic CPR producer (spec §22.4, §22.6).
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { CONFIG } from '../src/config';
import type { Conn } from '../src/db';

export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const api = `http://127.0.0.1:${CONFIG.apiPort}`;

export async function transcript(text: string) {
  const response = await fetch(`${api}/transcript`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source: 'repl' }),
  });
  if (!response.ok) throw new Error(`transcript: ${response.status} ${await response.text()}`);
}

export async function state() {
  const response = await fetch(`${api}/state`);
  if (!response.ok) throw new Error(`state: ${response.status} ${await response.text()}`);
  return response.json();
}

type Speak = { type: 'speak'; id: string; text: string; priority: number };
export class Mouth {
  private socket?: WebSocket;
  private retry?: NodeJS.Timeout;
  private stopped = false;
  online = false;
  replaced = false;
  constructor(private say: boolean, private heard: (message: Speak) => void = () => {}, private changed: () => void = () => {}) {
    this.open();
  }
  private open() {
    if (this.stopped) return;
    const ws = new WebSocket(`ws://127.0.0.1:${CONFIG.apiPort}/mouth`);
    this.socket = ws;
    ws.on('open', () => { this.online = true; this.changed(); });
    ws.on('message', async data => {
      try {
        const message = JSON.parse(data.toString()) as Speak;
        if (message.type !== 'speak' || typeof message.id !== 'string' || typeof message.text !== 'string') return;
        console.log(`🔊 [P${message.priority}] ${message.text}`);
        this.heard(message);
        if (this.say) await new Promise<void>(resolve => {
          const child = spawn('say', [message.text]);
          child.once('error', error => { console.error('say:', error.message); resolve(); });
          child.once('exit', () => resolve());
        });
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'spoken', id: message.id }));
      } catch (error) { console.error('mouth:', error); }
    });
    ws.on('error', () => {}); // close schedules the reconnect
    ws.on('close', (code, reason) => {
      const wasOnline = this.online;
      this.online = false;
      if (!this.stopped && code === 1000 && reason.toString() === 'replaced by a new mouth') {
        this.stopped = true; this.replaced = true;
        console.log('(another mouth took over)');
      }
      if (wasOnline) this.changed();
      if (!this.stopped) this.retry = setTimeout(() => this.open(), 2000);
    });
  }
  close() { this.stopped = true; clearTimeout(this.retry); this.socket?.close(); }
}

export class Cpr {
  private rate?: number;
  private paused = false;
  private count = 0;
  private started = Date.now();
  private lastCompression?: number;
  private timer: NodeJS.Timeout;
  constructor(private conn: Conn) { this.timer = setInterval(() => void this.push(), 500); }
  set(value: number | 'off' | 'pause') {
    if (value === 'off') { this.rate = undefined; this.paused = false; return; }
    if (value === 'pause') { this.paused = true; this.rate ??= 110; return; }
    if (!Number.isFinite(value) || value <= 0) throw new Error('CPR rate must be a positive number');
    this.rate = value; this.paused = false;
  }
  private async push() {
    if (this.rate === undefined) return;
    const now = Date.now();
    // Before the first compression report elapsed time since this producer started.
    if (!this.paused) {
      const previous = Math.floor(this.count);
      this.count += this.rate / 120;
      if (Math.floor(this.count) > previous) this.lastCompression = now;
    }
    const sinceLastS = (now - (this.lastCompression ?? this.started)) / 1000;
    try {
      await this.conn.reducers.pushCpr({
        rate: this.paused ? undefined : Math.max(1, this.rate + (Math.random() * 6 - 3)),
        count: Math.floor(this.count), sinceLastS,
        paused: this.paused, compressing: !this.paused,
      });
    } catch (error) { console.error('push_cpr:', error); }
  }
  close() { clearInterval(this.timer); }
}
