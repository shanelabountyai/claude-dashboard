# Security backlog

## Security findings — saas-foundation audit (2026-09-23)

Source: `~/Projects/saas foundation/audit/claude-dashboard.md` (full scorecard K1–K14 and evidence). Read-only audit; line numbers are as of 2026-09-23 — **re-verify before fixing**. IDs are `SEC-nn` / `OPS-nn` so they cannot collide with this repo's numbering; convert to a native item when picked up.

### Gaps

| ID | Sev | Finding | Fix | Acceptance |
|---|---|---|---|---|
| SEC-01 | HIGH | `app.listen(PORT, ...)` (`server.js:259`) binds to all network interfaces, not localhost — contradicting the README's own "binds to localhost only" claim (`README.md:128`). Combined with unauthenticated `/api/skills/run` and `/api/agents/run` (`server.js:163-211`, `lib/runner.js:19-25`), which spawn the `claude` CLI with the full process environment and an attacker-controllable prompt/cwd, this is unauthenticated remote code execution for anyone who can reach the port on the LAN (no tunnel/forward required, contrary to the doc's hedge). | Bind explicitly to `127.0.0.1` (pass `'127.0.0.1'` as the second arg to `app.listen`) as the minimum fix; add a shared-secret/token check on the run and config-mutation routes as defense in depth if the tool is ever used on a shared network. | `app.listen(PORT, '127.0.0.1', ...)`; verified a connection attempt from another machine on the same LAN is refused. |
| SEC-02 | MED | `POST /api/config/paths` (`lib/config.js:39-51`) accepts any existing directory with no allowlist, and that path becomes a usable `cwd` for the RCE-capable run endpoints (SEC-01) — an attacker who can reach the API can point a subsequent agent run at any directory on disk. | Fold into the SEC-01 fix (binding + auth); no separate action needed once the port isn't network-reachable and/or routes are authenticated. | Covered by SEC-01's acceptance test. |
| OPS-01 | LOW | README's security note (`README.md:128-131`) states the tool "binds to localhost only," which is factually wrong per the code — this could lead a future reader to under-estimate the exposure when deciding whether to run it on a shared machine. | Correct the README wording to state the server binds to all interfaces and should only be run behind a firewall/on a trusted network, or fix the bind and then the claim becomes true. | README accurately describes the actual bind behavior after SEC-01 is fixed. |

### Notes
- This is a well-scoped personal tool for a single trusted user on one machine — the design intent (per its own README) is reasonable. The finding is that the implementation doesn't match the stated threat model: the doc assumes localhost-only, the code doesn't enforce it.
- `config.json` (not `config.example.json`) currently has 1 configured project path and 3 skills — not detailed here since the specific paths aren't security-relevant beyond what's already covered above.

### Status (2026-09-23)
- **SEC-01 fixed:** `app.listen(PORT, '127.0.0.1', ...)`. Verified with `lsof`, which shows `TCP 127.0.0.1:<port> (LISTEN)`. A request to the machine's LAN IP is refused (curl rc=7), and localhost returns 200.
- **SEC-02 covered** by SEC-01, since the API is no longer reachable from the network.
- **OPS-01 resolved:** the README's "binds to localhost only" claim is now accurate.
- Not done: a token check on the run routes (defense in depth). Add it only if the tool ever runs on a shared machine.
