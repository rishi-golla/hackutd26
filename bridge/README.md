# Pi hub → SpacetimeDB bridge

The finger sensor's readings live on kgand's hub (`hub/hub.py` on the Pi), which has its own message bus.
`hub_bridge.py` forwards them to SpacetimeDB. That way the hospital dashboard, the callout rules (`tick_rules`) and
the agent all see the real vitals. Standard library only; the hub and sensor code are unchanged.

| Hub message | SpacetimeDB | When |
| --- | --- | --- |
| `state`, `hr`, `spo2` | `push_vitals(device, json)` | Once a second, only while the hub data is fresh (≤ 3 s old) |
| `mark` (press counter) | `mark(device, {"source":"MARK"})` | Once per new press |

**Hub state → relay status** (`hr`/`spo2` are only kept when the status is `pulse`; `spacetime/README.md`):

| Hub state | Relay status |
| --- | --- |
| `live` | `pulse` |
| `no_finger` | `no finger` |
| `saturated` | `saturated` |
| `sensor_error` | `sensor error` |
| `measuring`, `settling`, `moving`, `weak`, `noisy` | `acquiring` |

Every message is sent with `"simulated": false`; the raw hub state is included as `hub_state`, which the module ignores.

**Never a stale number:** if the hub goes quiet for 3 s, the bridge stops sending, and the dashboard shows
"no data" by itself. It doesn't forward the hub's catch-up replays (old values after a restart), and it doesn't
re-send old MARK presses. The sensor publishes `mark` only on a press, so every live `mark` message is forwarded
as at least one press, including the first one ever and the first one after the sensor service restarts (its counter
goes back to 1).

**Not forwarded:** the pulse waveform and temperature (the hub doesn't carry them), and the 2 s hold that should call
`toggle_incident` (spec R5): `pi_oximeter.py` detects presses, not holds. That needs a hub `hold` message from the
chromatic lane first. Also note the module ignores `mark` while no incident is active, so `"mark", "forwarded": true`
in the log means the call was accepted, not that a timeline event exists.

## Run

On the Pi, as a service next to the hub (the usual setup):

```bash
cd bridge && ./deploy.sh          # copies hub_bridge.py + handoff-bridge.service over the USB cable, starts it
```

Or from the laptop, pointing at the Pi's hub:

```bash
HUB_URL=http://<pi>:8000 python3 bridge/hub_bridge.py
```

| Setting | Default |
| --- | --- |
| `HUB_URL` | `http://127.0.0.1:8000` |
| `SPACETIMEDB_URL` | `https://maincloud.spacetimedb.com` |
| `SPACETIMEDB_DB` | `handoff-hackutd26` |
| `DEVICE` | `relay-1` |
| `TOKEN_FILE` | `~/.handoff-bridge-token` (one SpacetimeDB identity, kept across restarts) |
| `STALE_S` | `3` |

**Run one bridge per hub.** Two bridges would double every vitals row and every MARK.

The log is one JSON line per change (`hub_up` / `hub_down`, `vitals` when the status changes, `mark`,
`vitals_paused`, `stdb_error`). On the Pi: `journalctl -u handoff-bridge -f -o cat`.

## Test

**Is the feed live and real?** One command, from the laptop or the Pi, the same in PowerShell and bash (`python3`
on the Pi, macOS and Linux):

```bash
python bridge/check_vitals.py          # --rows N prints the N newest rows (default 5)
```

It reads the `vitals` table back from SpacetimeDB (same `SPACETIMEDB_URL`, `SPACETIMEDB_DB`, `DEVICE`, `STALE_S`
settings as the bridge). **LIVE** means the newest `relay-1` row is at most 3 s old. **REAL** means every vitals row
is from `relay-1` with `simulated: false`. Anything else is printed as **NOT REAL**: rows marked simulated, rows from
another device (for example `voice/`'s `npm run mock:relay`), or the synthetic scenario being on. It exits 0 only
when the feed is both.

**On the Pi.** These need SSH. Get the Pi's address (Wi-Fi or Tailscale) with `hostname -I` on the Pi, then define
`pi` from the repo root:

```powershell
function pi { ssh -i chromatic/captures/private/pi_key -o UserKnownHostsFile=chromatic/captures/private/pi_known_hosts -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR cmx@<pi> @args }
```

```bash
pi() { ssh -i chromatic/captures/private/pi_key -o UserKnownHostsFile=chromatic/captures/private/pi_known_hosts -o StrictHostKeyChecking=accept-new -o LogLevel=ERROR cmx@<pi> "$@"; }
```

1. **Vitals:** `pi journalctl -u handoff-bridge -f -o cat`, then rest a fingertip on the sensor, lightly and still,
   for 10–15 s. The log shows `acquiring`, then `pulse` with `hr`, all `"ok": true`. It logs status changes only,
   and SpO2 is rarely ready at that moment (the sensor waits for 3 readings that agree within 2 points), so
   `check_vitals.py`'s "pulse rows with SpO2" count is the place to see it.
2. **Never stale:** `pi sudo systemctl stop cmx-oximeter`. Within 3 s the log shows `vitals_paused` and
   `check_vitals.py` says NOT LIVE. Then `pi sudo systemctl start cmx-oximeter`. While it's stopped the Chromatic
   loses its Bluetooth heart rate too.
3. **MARK:** the module ignores `mark` without an active incident, so start one first (`start_incident`,
   `spacetime/README.md`; this changes the shared database). A press logs `"ev": "mark", "forwarded": true`.

## Tested

Tested against kgand's real `hub.py` and a local SpacetimeDB, with the oximeter's stream replayed at 4 Hz:
- **Status sequence:** measuring → 3 `acquiring` rows with no HR; live 74/97 → 7 `pulse` rows; finger off → 5
  `no finger` rows. One a second, all `simulated: false`.
- **Hub quiet:** sending stopped after 3 s.
- **MARK:** the first press ever, a press after the sensor service restarted (counter back to 1), and a counter jump
  of two (two presses forwarded) all reached `mark`.
- **Hub restart:** replayed values weren't forwarded and old presses weren't re-sent; a new press after the restart was.
- **Sensor not answering (`sensor_error`):** `sensor error` rows with no numbers; nothing in `tick_rules` depends on that word.

On the real Pi against Maincloud (Sun Nov 8, ~01:00, the service installed with the same steps as `deploy.sh`, over
Tailscale from Windows):
- **Service:** `hub_up` at start; all four Pi services active (`cmx-oximeter`, `handoff-hub`, `handoff-link`,
  `handoff-bridge`).
- **Status sequence:** finger on → `acquiring` → `pulse` with HR 75–102; finger off → `no finger`. One row a second,
  every call `"ok": true`, every row `simulated: false`.
- **SpO2:** 35 of 54 `pulse` rows carried it (98–100); the rest were pulse stretches of 2–6 s, too short for the
  sensor to publish a steady SpO2.
- **`check_vitals.py`:** LIVE (newest row under 1.5 s old). It also caught 3 `sim-seizure` rows marked simulated,
  from a short synthetic-scenario run in the shared database, and said NOT REAL for them.

Not tested on the Pi yet: MARK during an incident, the stale pause (sensor service stopped), and a reboot.
