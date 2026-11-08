// Terminal bodycam: direct reducers plus the brain's local ear and mouth (spec §22).
import readline from 'node:readline';
import { connect } from '../src/db';
import { Cpr, Mouth, state, transcript } from './lib';

const args = process.argv.slice(2);
const conn = await connect('mock-bodycam');
const cpr = new Cpr(conn);
const cprArg = args.indexOf('--cpr');
if (cprArg >= 0) cpr.set(Number(args[cprArg + 1]));
let pendingHeartbeat: Promise<void> = Promise.resolve();
const heartbeat = () => { pendingHeartbeat = conn.reducers.heartbeat({ device: 'bodycam', kind: 'bodycam' }).catch(error => console.error('heartbeat:', error)); };
heartbeat();
const heartbeatTimer = setInterval(heartbeat, 10000);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let mouth: Mouth;
let closed = false;
let frameNumber = 0;
function prompt() { if (closed) return; rl.setPrompt(`bodycam${mouth?.online ? '' : mouth?.replaced ? ' (mouth replaced)' : ' (brain offline)'}> `); if (process.stdin.isTTY) rl.prompt(true); }
mouth = new Mouth(args.includes('--say'), () => prompt(), prompt);
conn.db.callout.onInsert((_ctx, row) => { console.log(`(queued) [P${row.priority}] ${row.text}`); prompt(); });
const help = '/start [unit] | /arrest | /rosc | /enroute | /arrived | /close | /reset | /identify [id] | /cpr <rate|off|pause> | /seen <drug> [dose unit] | /mark [note] | /report | /seizure on|off | /state | /callouts | /help';
console.log(help); prompt();
async function command(line: string) {
  const [cmd, ...words] = line.trim().split(/\s+/);
  const action: Record<string, string> = { '/arrest': 'arrest', '/rosc': 'rosc', '/enroute': 'en_route', '/arrived': 'arrived', '/close': 'close', '/reset': 'reset' };
  if (action[cmd]) return void await conn.reducers.demoControl({ action: action[cmd], arg: '' });
  switch (cmd) {
    case '/start': await conn.reducers.startIncident({ unit: words.join(' ') || 'Medic 12' }); break;
    case '/identify': await conn.reducers.demoControl({ action: 'identify', arg: words[0] || 'pt-0001' }); break;
    case '/cpr': {
      const value = words[0];
      if (!value) throw new Error('Usage: /cpr <rate|off|pause>');
      cpr.set(value === 'off' || value === 'pause' ? value : Number(value));
      console.log(`CPR: ${value}`); break;
    }
    case '/seen': {
      const [drug, dose, ...unit] = words;
      if (!drug) throw new Error('Usage: /seen <drug> [dose unit]');
      const kind = `med_${drug.toLowerCase()}`;
      const name = drug[0].toUpperCase() + drug.slice(1).toLowerCase();
      const label = dose ? `${name} ${dose}${unit.length ? ` ${unit.join(' ')}` : ''}` : name;
      await conn.reducers.logEvent({ kind, label, sourceKind: 'seen', sourceDetail: `mock frame #${++frameNumber}` });
      break;
    }
    case '/mark': await conn.reducers.mark({ device: 'bodycam', json: JSON.stringify(words.length ? { note: words.join(' '), source: 'voice' } : {}) }); break;
    case '/report': await conn.reducers.requestReport({}); break;
    case '/seizure':
      if (!['on', 'off'].includes(words[0])) throw new Error('Usage: /seizure on|off');
      await conn.reducers.synthesizeSeizure({ active: words[0] === 'on' }); break;
    case '/state': console.log(JSON.stringify(await state(), null, 2)); break;
    case '/callouts': {
      const pending = [...conn.db.callout.iter()].filter(row => row.spokenAt === undefined);
      if (!pending.length) console.log('No unspoken callouts.');
      for (const row of pending) console.log(`[P${row.priority}] ${row.id}: ${row.text}`);
      break;
    }
    case '/help': console.log(help); break;
    default: console.error(`Unknown command: ${cmd}`);
  }
}
// Serialize input so reducer and transcript ordering follows the typed lines.
let queue = Promise.resolve();
rl.on('line', line => {
  queue = queue.then(async () => {
    if (line.trim().startsWith('/')) await command(line);
    else if (line.trim()) await transcript(line.trim());
  }).catch(error => console.error(error instanceof Error ? error.message : error)).finally(prompt);
});
rl.on('close', () => {
  closed = true; clearInterval(heartbeatTimer); cpr.close(); mouth.close();
  void queue.finally(async () => { await pendingHeartbeat; conn.disconnect(); });
});
