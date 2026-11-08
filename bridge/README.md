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
re-send old MARK presses. The hub carries no pulse waveform or temperature, so neither is forwarded.

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

## Tested

Tested against kgand's real `hub.py` and a local SpacetimeDB, with the oximeter's stream replayed at 4 Hz:
- **Status sequence:** measuring → 3 `acquiring` rows with no HR; live 74/97 → 7 `pulse` rows; finger off → 5
  `no finger` rows. One a second, all `simulated: false`.
- **Hub quiet:** sending stopped after 3 s.
- **MARK:** two presses were forwarded, and the boot counter value wasn't.
- **Hub restart:** replayed values weren't forwarded and old presses weren't re-sent; a new press after the restart was.

Not tested yet: on the real Pi against Maincloud.
