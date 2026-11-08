# Handoff · HackUTD 2026

An AI partner for paramedics: a chest bodycam, a vitals relay, and a hospital dashboard sharing one live record.
Prototype only. All data is synthetic, and this is not a medical device.

- **Start here:** [`docs/context/SPEC.md`](docs/context/SPEC.md), the product spec and single source of truth
  (decisions, lanes, contracts, rules, open questions).
- **Backend:** [`spacetime/README.md`](spacetime/README.md). The SpacetimeDB module is live on Maincloud as
  `handoff-hackutd26`. That README explains how to publish it and how each device talks to it.
- **Web app:** `web/`. It has three routes: `/hospital`, `/bodycam` and `/monitor`.

```bash
cd web && npm install
npm run dev          # http://localhost:5173/hospital   (connects to Maincloud)
npm run dev:https    # HTTPS for the bodycam phone (camera, mic, motion)
```
