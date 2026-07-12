# Claude Dashboard

A personal command-center dashboard that sits on top of Claude Code. It runs
locally as a small Node/Express server with a plain HTML/CSS/JS frontend (no
build step, no framework) and gives you:

1. **Today** — a combined daily digest: git commits across your configured
   project directories, alongside that day's Claude Code sessions (which
   projects, how many, total turns, session titles), rendered as one "here's
   what happened today" view rather than two separate lists.
2. **Skills** — one-click buttons that run a configured Claude Code skill
   (`claude -p "/skill-name args"`) against a target project directory, with
   live streaming output.
3. **Automations** — one-click buttons for every subagent persona found at
   `.claude/agents/*.md` across your configured projects, grouped by project.
   Each has an editable task box so you decide what to ask it to do before
   running, with the same live streaming output.
4. **Sessions** — a searchable, paginated log of every Claude Code session on
   this machine (across every project, not just the configured ones), with a
   chat-style transcript view for each one.

## Starting it

Two equivalent ways — either works, no terminal needed after this:

```
./start.sh
```

or

```
npm start
```

Both install dependencies on first run (if `node_modules` is missing) and
start the server at **http://localhost:4173** (override with `PORT=xxxx`).
`start.sh` also tries to open that URL in your default browser automatically.

On macOS you can also just **double-click `start.command`** in Finder — it's
a thin wrapper around `start.sh` that Finder knows how to launch directly in
Terminal, which is the actually-reliable way to get double-click behavior out
of a shell script on macOS (Finder's default handler for a bare `.sh` file is
often a text editor, not the shell, depending on your settings).

Everything after that first launch happens in the browser tab — no CLI
interaction required.

To stop it, close the terminal window it's running in, or `Ctrl+C`.

## Config file

`config.json` (created automatically on first run, from `config.example.json`)
is the one file you're meant to hand-edit. It's gitignored because it holds
machine-specific paths.

```json
{
  "projectPaths": ["/absolute/path/to/a/project"],
  "skills": [
    {
      "name": "Code Review",
      "invocation": "/code-review",
      "args": "medium",
      "cwd": "/absolute/path/to/a/project"
    }
  ]
}
```

- **`projectPaths`** — directories scanned for git activity (Today), for
  `.claude/agents/*.md` (Automations), and unioned with whatever project
  directories your Claude Code sessions actually ran in (Today, Sessions).
  You can also add/remove paths from the **Today** tab's "Configured
  projects" panel in the browser — no file editing required for that part.
- **`skills`** — the buttons on the Skills tab. `name` is the button label,
  `invocation` is the slash-command string, `args` are the default arguments
  (editable per-run in the UI before clicking Run), `cwd` is which project
  directory the skill runs against. Shipped pre-populated with three
  examples (`/code-review`, `/security-review`, `/simplify`) targeting
  whatever project is first in `projectPaths` — edit or add more, then
  reload the Skills tab.

Automations need no config — they're auto-discovered by scanning
`.claude/agents/*.md` under every path in `projectPaths`.

## How the pieces work

- **Backend**: `server.js` + `lib/*.js`, Express, no ORM/database — reads
  git, the filesystem, and `~/.claude/projects/*/*.jsonl` directly.
- **Skills/Automations execution**: `child_process.spawn` (not `exec`), so
  output streams live rather than buffering until the process exits. Streamed
  to the browser over Server-Sent Events (`lib/runner.js`), rendered in the
  slide-up "Run console" panel at the bottom of the page.
- **Sessions**: session metadata (title, start/end, turn count) is scanned
  once per file and cached in memory keyed by file path + mtime/size, so
  reopening the Sessions list doesn't re-parse every transcript. A session's
  full transcript is only parsed when you open its detail view.
- **Project-path de-slugification**: `.claude/projects/<slug>` directory
  names are formed by replacing every `/` in the absolute path with `-`,
  which is lossy for paths whose components themselves contain hyphens. We
  resolve exactly for anything in your configured `projectPaths` (by
  re-slugifying and matching), and fall back to a naive reverse-replace for
  everything else — good enough to be readable, not guaranteed exact for
  hyphenated directory names outside your configured list.

## Known limitations / what's next

- **First run against a new project may print a trust-dialog warning.**
  `claude -p` run from a spawned (non-interactive) process won't have
  accepted a given project's trust dialog the way an interactive terminal
  session would. If a Skill/Automation run's console shows lines like
  `this workspace has not been trusted`, run Claude Code interactively in
  that project directory once and accept the dialog (or set
  `hasTrustDialogAccepted: true` for it in `~/.claude.json`), then re-run.
- **No run cancellation button.** Closing the browser tab kills the spawned
  process (via the SSE connection closing), but there's no in-UI "stop" button
  for a run still in progress. For a personal tool this seemed like the
  right scope cut; add one if long-running skills become common.
- **One global run console**, not one per button. Multiple runs append to the
  same scrollback with a header line per run rather than getting fully
  separate panels. Fine for "click one thing, watch it work"; would need
  rework for running several things at once and comparing output side by
  side.
- **Session-list de-slugification is best-effort** for any project directory
  outside your configured `projectPaths` list, as noted above — the path
  shown may not be byte-exact if that directory's name contains hyphens.
- **No auth/access control.** This binds to localhost only and assumes
  single-user, trusted-machine use — there's no login, and anyone with
  local network access to the port (if you tunnel or forward it) could hit
  the API. Don't expose this port publicly.
- **Daily report's git activity only covers configured `projectPaths`** that
  are actual git repos; the session-activity half of the digest includes
  *any* directory a Claude Code session ran in that day, configured or not
  (this is intentional — session data isn't limited to configured paths the
  way git scanning is).
- Tested against real data on this machine (see project handoff notes for
  what was verified live vs. wiring-only) rather than a seeded fixture/demo
  dataset — there's no synthetic "empty state" project to click through
  besides the genuine empty states.
