// SpacetimeDB over plain HTTPS, for pages without the SDK (hub/phone.html). Maincloud allows browser calls from any
// origin. Reducer arguments are a JSON array in declaration order; an option is {"some": v} or {"none": []}.

export const some = (v: number | undefined | null) => (v === undefined || v === null ? { none: [] } : { some: v });

export class SpacetimeHttp {
  private token: string | null = null;
  private readonly key: string;

  constructor(
    readonly base: string,
    readonly db: string
  ) {
    this.base = base.replace(/\/$/, '');
    this.key = `handoff.stdb.token:${this.base}/${db}`;
    try {
      this.token = localStorage.getItem(this.key);
    } catch {
      // private mode: a new identity per page load
    }
  }

  /** Calls a reducer. Throws on a network error or a non-2xx answer (the module's error text is in the message). */
  async call(reducer: string, args: unknown[]): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`${this.base}/v1/database/${this.db}/call/${reducer}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await this.identity()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) return;
      if (r.status === 401 && attempt === 0) {
        this.forget(); // the token belongs to another server or expired: get a new one once
        continue;
      }
      throw new Error(`${reducer}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  }

  /** Runs one SQL query on public tables; returns its rows (each row is an array in column order). */
  async rows(query: string): Promise<unknown[][]> {
    const r = await fetch(`${this.base}/v1/database/${this.db}/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`sql: ${r.status}`);
    const out = (await r.json()) as { rows: unknown[][] }[];
    return out[0]?.rows ?? [];
  }

  private async identity(): Promise<string> {
    if (this.token) return this.token;
    const r = await fetch(`${this.base}/v1/identity`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`identity: ${r.status}`);
    this.token = ((await r.json()) as { token: string }).token;
    try {
      localStorage.setItem(this.key, this.token);
    } catch {
      // keep it in memory only
    }
    return this.token;
  }

  private forget(): void {
    this.token = null;
    try {
      localStorage.removeItem(this.key);
    } catch {
      // nothing stored
    }
  }
}
