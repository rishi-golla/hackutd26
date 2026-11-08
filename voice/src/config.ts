// Voice worker configuration. Secrets live in voice/.env.local (gitignored), never in the repo.
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));
} catch {
  // no .env.local: fine, use the environment
}

const env = process.env;
const host = env.SPACETIMEDB_HOST ?? 'wss://maincloud.spacetimedb.com';

export const CONFIG = {
  spacetimeHost: host,
  /** HTTP base for relay-style reducer calls (the mock relay). ws:// → http://, wss:// → https:// */
  spacetimeHttp: env.SPACETIMEDB_HTTP ?? host.replace(/^ws/, 'http'),
  dbName: env.SPACETIMEDB_DB_NAME ?? 'handoff-hackutd26',

  nvidiaApiKey: env.NVIDIA_API_KEY ?? '',
  nvidiaBaseUrl: env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
  /** A fast Nemotron with tool calling for voice turns. If the slug 404s the brain falls back to the verified ultra. */
  model: env.VOICE_MODEL ?? 'nvidia/nemotron-3.5-lightning-30b-a3b',
  fallbackModel: 'nvidia/nemotron-3-ultra-550b-a55b',
  thinking: (env.NEMOTRON_THINKING ?? 'off') === 'on',
  /** One voice turn may take at most this long; past it the brain stays silent (the rules are the safety net). */
  llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 6000),

  ehrBaseUrl: env.EHR_BASE_URL ?? 'http://localhost:4100/fhir',
  apiPort: Number(env.VOICE_API_PORT ?? 8787),
  /** This worker pulls the record when incident.patientRef is set (W6). Off if the bodycam lane does it. */
  w6: (env.VOICE_W6 ?? 'on') === 'on',
  /** Unprompted Nemotron advisories on state changes: 15 words or fewer, at most one per 15 s. */
  proactive: (env.VOICE_PROACTIVE ?? 'on') === 'on',
  timeZone: env.DISPLAY_TZ ?? 'America/Chicago',
};

export const llmConfigured = () => CONFIG.nvidiaApiKey.length > 0;
