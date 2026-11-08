// Shared by phone.html and dash.html.
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STALE_MS = 5000;                     // a value not refreshed for this long is shown as "—"

// What the sensor's state means for the person holding it.
const labels = {
  live: 'Reading', no_finger: 'Place finger', settling: 'Hold still…', moving: 'Hold still', weak: 'Press firmer',
  noisy: 'Hold still, press firmly', measuring: 'Measuring…', saturated: 'Press lighter', sensor_error: 'Check sensor',
};

// Long-polls the hub. Each answer is a normal complete response, which any https tunnel passes at once
// (Cloudflare holds back streams). onMsg(m, age) gets every message with its age in seconds; catch-up messages
// (the page just connected, or the hub restarted) have age Infinity. Returns when the hub last answered,
// which happens at least every 10 s while the link is up.
function poll(onMsg) {
  let answeredAt = 0;
  (async () => {
    let after = 0, e = '';
    for (;;) {
      try {
        const r = await fetch(`/poll?after=${after}&e=${e}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(r.status);
        const d = await r.json();
        after = d.seq; e = d.e; answeredAt = Date.now();
        for (const m of d.msgs) {
          try { onMsg(m, m.replay ? Infinity : d.now - m.t); } catch (err) { console.error(err); }
        }
      } catch (_) { await sleep(1000); }
    }
  })();
  return () => answeredAt;
}
