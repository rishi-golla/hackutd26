// Agent configuration. Secrets come from agent/.env.local (gitignored), never from the repo.
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));
} catch {
  // no .env.local: fine, use the environment
}

const env = process.env;

export const CONFIG = {
  spacetimeHost: env.SPACETIMEDB_HOST ?? 'wss://maincloud.spacetimedb.com',
  dbName: env.SPACETIMEDB_DB_NAME ?? 'handoff-hackutd26',
  nvidiaApiKey: env.NVIDIA_API_KEY ?? '',
  nvidiaBaseUrl: env.NVIDIA_BASE_URL ?? 'https://integrate.api.nvidia.com/v1',
  model: env.NEMOTRON_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b',
  /**
   * Reasoning ("thinking") off by default: measured Sat evening on nemotron-3-ultra, a report-sized call took
   * 14.3 s with 782 reasoning tokens, 10.6 s with thinking off. Set NEMOTRON_THINKING=on to allow it.
   */
  thinking: (env.NEMOTRON_THINKING ?? 'off') === 'on',
  /** One model call may take at most this long; the workflow deadline is stricter. */
  llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 12000),
  /** W1 must post the alert within 20 s of the arrest (E1); W4 the report within 30 s (H7). */
  w1DeadlineMs: 14000,
  w4DeadlineMs: 27000,
  timeZone: env.DISPLAY_TZ ?? 'America/Chicago',
};

export const llmConfigured = () => CONFIG.nvidiaApiKey.length > 0;
