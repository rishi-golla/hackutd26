# Handoff: read this first

**The product spec is [`docs/context/SPEC.md`](docs/context/SPEC.md).** It is the single source of truth: decisions, lanes, contracts, rules and open questions. Read its section 0 first, then the sections for your lane.

- When a decision changes, update `SPEC.md` in the same commit and record it in its section 0. Don't keep project facts anywhere else.
- After every feature, run the `spec-checker` subagent (`.claude/agents/spec-checker.md`) on the files you changed. Tools without subagents (Codex, Cursor) follow its checklist by hand.
- Exact backend contract (reducer signatures, publishing): [`spacetime/README.md`](spacetime/README.md).
- Code comments that cite "AGENTS.md section 0 / Lanes / 4.3" now mean SPEC.md Part B (lanes, contracts) and SPEC.md section 0.
- Everything else in `docs/context/` is history only.
