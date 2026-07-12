'use strict';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function h(strings, ...values) {
  // Tiny tagged-template escaper: use `${esc(x)}` manually where needed instead.
  return strings.reduce((out, s, i) => out + s + (values[i] !== undefined ? values[i] : ''), '');
}

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return '--';
  const ms = new Date(endIso) - new Date(startIso);
  if (!isFinite(ms) || ms < 0) return '--';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const views = ['today', 'skills', 'automations', 'sessions', 'session-detail'];

function showView(name) {
  views.forEach((v) => {
    $(`#view-${v}`).classList.toggle('active', v === name);
  });
  $$('.rail-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  if (name === 'today') loadToday();
  if (name === 'skills') loadSkills();
  if (name === 'automations') loadAutomations();
  if (name === 'sessions') loadSessionsList(1);
}

$$('.rail-btn').forEach((btn) => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// ---------------------------------------------------------------------------
// Run console (shared SSE output panel for skills + automations)
// ---------------------------------------------------------------------------

const consoleEl = $('#console');
const consoleBody = $('#consoleBody');
const consoleStatusDot = $('#consoleStatusDot');

$('#consoleBar').addEventListener('click', (e) => {
  if (e.target.closest('#consoleClearBtn')) return;
  consoleEl.classList.toggle('open');
});

$('#consoleClearBtn').addEventListener('click', () => {
  consoleBody.innerHTML = '';
});

function consoleAppend(text, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  consoleBody.appendChild(line);
  consoleBody.scrollTop = consoleBody.scrollHeight;
}

function runViaSSE(url, label) {
  consoleEl.classList.add('open');
  consoleStatusDot.className = 'status-dot running';
  consoleAppend(`▸ ${label}  —  ${new Date().toLocaleTimeString()}`, 'console-line-run-header');

  const es = new EventSource(url);

  es.addEventListener('start', (e) => {
    try {
      const data = JSON.parse(e.data);
      consoleAppend(`$ claude -p "${data.prompt}"`, 'console-line-meta');
      consoleAppend(`cwd: ${data.cwd}`, 'console-line-meta');
    } catch {}
  });

  es.addEventListener('output', (e) => {
    consoleAppend(e.data);
  });

  es.addEventListener('stderr', (e) => {
    if (e.data.trim()) consoleAppend(e.data, 'console-line-stderr');
  });

  es.addEventListener('error', (e) => {
    let msg = 'connection error';
    try { msg = JSON.parse(e.data).message; } catch {}
    consoleAppend(`! ${msg}`, 'console-line-stderr');
  });

  es.addEventListener('done', (e) => {
    let code = '?';
    try { code = JSON.parse(e.data).exitCode; } catch {}
    consoleAppend(`▸ finished (exit ${code})`, 'console-line-meta');
    consoleStatusDot.className = 'status-dot ' + (code === 0 ? 'ok' : 'err');
    es.close();
  });

  es.onerror = () => {
    // EventSource fires a generic error on server close too; only treat as a
    // real failure if we never got a "done" (status dot still shows "running").
    if (consoleStatusDot.classList.contains('running')) {
      consoleStatusDot.className = 'status-dot err';
      consoleAppend('▸ stream closed unexpectedly', 'console-line-stderr');
    }
    es.close();
  };
}

// ---------------------------------------------------------------------------
// Today: daily digest (git + sessions)
// ---------------------------------------------------------------------------

const reportDateInput = $('#reportDate');
reportDateInput.value = todayISO();

reportDateInput.addEventListener('change', () => loadToday());
$('#reportTodayBtn').addEventListener('click', () => {
  reportDateInput.value = todayISO();
  loadToday();
});

async function loadToday() {
  const root = $('#reportRoot');
  root.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const date = reportDateInput.value || todayISO();
    const data = await api(`/api/daily-report?date=${encodeURIComponent(date)}`);
    renderReport(data);
  } catch (err) {
    root.innerHTML = `<div class="error-note">Couldn't load the daily report: ${esc(err.message)}</div>`;
  }
  loadPaths();
}

function renderReport(data) {
  const root = $('#reportRoot');
  const s = data.summary;

  let out = '';
  out += `<div class="summary-strip">
    <div class="stat-tile"><div class="num">${s.totalCommits}</div><div class="label">Commits</div></div>
    <div class="stat-tile"><div class="num">${s.totalSessions}</div><div class="label">Sessions</div></div>
    <div class="stat-tile"><div class="num">${s.totalTurns}</div><div class="label">Turns</div></div>
    <div class="stat-tile"><div class="num">${s.activeProjects}</div><div class="label">Active projects</div></div>
  </div>`;

  if (data.projects.length === 0) {
    out += `<div class="card card-pad"><div class="empty-note">Nothing happened on ${esc(data.date)} across your configured projects yet.</div></div>`;
    root.innerHTML = out;
    return;
  }

  for (const p of data.projects) {
    const commits = (p.git && p.git.commits) || [];
    const sessions = (p.sessions && p.sessions.sessions) || [];

    out += `<div class="project-block">
      <div class="project-block-header">
        <span class="name">${esc(p.name)}</span>
        <span class="path mono">${esc(p.path)}</span>
      </div>
      <div class="project-block-body">
        <div class="block-col">
          <div class="block-col-title">Git &middot; ${commits.length} commit${commits.length === 1 ? '' : 's'}</div>
          ${commits.length === 0
            ? '<div class="empty-note">No commits.</div>'
            : commits.map((c) => `
              <div class="commit-row">
                <span class="commit-hash mono">${esc(c.hash)}</span>
                <span class="commit-msg" title="${esc(c.message)}">${esc(c.message)}</span>
                <span class="commit-stat">${c.filesChanged}f <span class="diff-add">+${c.insertions}</span> <span class="diff-del">-${c.deletions}</span></span>
              </div>`).join('')
          }
          ${p.git && p.git.error ? `<div class="empty-note">git error: ${esc(p.git.error)}</div>` : ''}
        </div>
        <div class="block-col">
          <div class="block-col-title">Sessions &middot; ${sessions.length}, ${p.sessions.totalTurns} turns</div>
          ${sessions.length === 0
            ? '<div class="empty-note">No sessions.</div>'
            : sessions.map((sn) => `
              <div class="session-row">
                <div class="title">${esc(sn.title)}</div>
                <div class="meta">${fmtTime(sn.start)}&ndash;${fmtTime(sn.end)} &middot; ${sn.turnCount} turns</div>
              </div>`).join('')
          }
        </div>
      </div>
    </div>`;
  }

  root.innerHTML = out;
}

// ---------------------------------------------------------------------------
// Configured project paths (shared by Today / Skills / Automations)
// ---------------------------------------------------------------------------

async function loadPaths() {
  try {
    const config = await api('/api/config');
    renderPaths(config.projectPaths);
  } catch (err) {
    $('#pathList').innerHTML = `<div class="error-note">${esc(err.message)}</div>`;
  }
}

function renderPaths(paths) {
  const list = $('#pathList');
  if (!paths.length) {
    list.innerHTML = '<div class="empty-note">No project paths configured yet.</div>';
    return;
  }
  list.innerHTML = paths.map((p) => `
    <div class="path-row">
      <span class="p" title="${esc(p)}">${esc(p)}</span>
      <button class="btn btn-sm btn-ghost" data-remove-path="${esc(p)}">Remove</button>
    </div>`).join('');

  $$('[data-remove-path]', list).forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('/api/config/paths', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: btn.dataset.removePath })
        });
        loadPaths();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

$('#addPathForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#addPathInput');
  const value = input.value.trim();
  if (!value) return;
  try {
    await api('/api/config/paths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: value })
    });
    input.value = '';
    loadPaths();
  } catch (err) {
    alert(err.message);
  }
});

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

async function loadSkills() {
  const root = $('#skillsRoot');
  root.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const { skills } = await api('/api/skills');
    renderSkills(skills);
  } catch (err) {
    root.innerHTML = `<div class="error-note">${esc(err.message)}</div>`;
  }
}

function renderSkills(skills) {
  const root = $('#skillsRoot');
  if (!skills.length) {
    root.innerHTML = `<div class="card card-pad"><div class="empty-note">
      No skills configured. Add entries to the "skills" array in config.json (name, invocation, args, cwd), then reload.
    </div></div>`;
    return;
  }

  root.innerHTML = `<div class="action-grid">${skills.map((s, i) => `
    <div class="action-card">
      <div class="name">${esc(s.name)}</div>
      <div class="invocation">${esc(s.invocation)}</div>
      <div class="target" title="${esc(s.cwd)}">in ${esc(s.cwd)}</div>
      <input type="text" class="task-input" data-skill-args="${i}" placeholder="args (optional)" value="${esc(s.args || '')}">
      <div class="row-btns">
        <button class="btn btn-accent btn-sm" data-run-skill="${i}">Run</button>
      </div>
    </div>`).join('')}</div>`;

  $$('[data-run-skill]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = btn.dataset.runSkill;
      const args = $(`[data-skill-args="${i}"]`, root).value.trim();
      const url = `/api/skills/run?index=${encodeURIComponent(i)}&args=${encodeURIComponent(args)}`;
      runViaSSE(url, `Skill: ${skills[i].name}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Automations (subagent personas)
// ---------------------------------------------------------------------------

async function loadAutomations() {
  const root = $('#automationsRoot');
  root.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const { groups } = await api('/api/agents');
    renderAutomations(groups);
  } catch (err) {
    root.innerHTML = `<div class="error-note">${esc(err.message)}</div>`;
  }
}

function renderAutomations(groups) {
  const root = $('#automationsRoot');
  if (!groups.length) {
    root.innerHTML = `<div class="card card-pad"><div class="empty-note">
      No <code>.claude/agents/*.md</code> files found in any configured project.
    </div></div>`;
    return;
  }

  root.innerHTML = groups.map((g) => `
    <div class="group-heading">${esc(g.projectPath.split('/').pop())} <span class="mono" style="text-transform:none;font-weight:400;color:var(--text-faint)">${esc(g.projectPath)}</span></div>
    <div class="action-grid">
      ${g.agents.map((a) => `
        <div class="action-card">
          <div class="name" title="${esc(a.description)}">${esc(a.name)} <span class="badge">${esc(a.model)}</span></div>
          <div class="desc" title="${esc(a.description)}">${esc(a.description)}</div>
          <input type="text" class="task-input" data-agent-task placeholder="task, e.g. review the ADRs">
          <div class="row-btns">
            <button class="btn btn-accent btn-sm"
              data-run-agent
              data-project="${esc(g.projectPath)}"
              data-name="${esc(a.name)}">Run</button>
          </div>
        </div>`).join('')}
    </div>
  `).join('');

  $$('[data-run-agent]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.action-card');
      const task = $('[data-agent-task]', card).value.trim();
      const project = btn.dataset.project;
      const name = btn.dataset.name;
      const url = `/api/agents/run?projectPath=${encodeURIComponent(project)}&name=${encodeURIComponent(name)}&task=${encodeURIComponent(task)}`;
      runViaSSE(url, `Automation: ${name}`);
    });
  });
}

// ---------------------------------------------------------------------------
// Sessions list + detail
// ---------------------------------------------------------------------------

let sessionsState = { page: 1, pageSize: 25 };

async function loadSessionsList(page) {
  sessionsState.page = page || sessionsState.page;
  const root = $('#sessionsListRoot');
  root.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const data = await api(`/api/sessions?page=${sessionsState.page}&pageSize=${sessionsState.pageSize}`);
    renderSessionsList(data);
  } catch (err) {
    root.innerHTML = `<div class="error-note">${esc(err.message)}</div>`;
  }
}

function renderSessionsList(data) {
  const root = $('#sessionsListRoot');
  if (!data.sessions.length) {
    root.innerHTML = '<div class="card card-pad"><div class="empty-note">No sessions found.</div></div>';
    return;
  }

  const rows = data.sessions.map((s) => `
    <div class="session-list-row" data-slug="${esc(s.slug)}" data-session-id="${esc(s.sessionId)}">
      <span class="title" title="${esc(s.title)}">${esc(s.title)}</span>
      <span class="proj" title="${esc(s.projectPath)}">${esc(s.projectPath)}</span>
      <span class="turns">${s.turnCount} turns</span>
      <span class="when">${fmtDateTime(s.start)}</span>
    </div>`).join('');

  root.innerHTML = `
    <div class="card">
      <div class="list-head">
        <span>Title</span><span>Project</span><span>Turns</span><span>Started</span>
      </div>
      ${rows}
      <div class="pager">
        <button class="btn btn-sm" id="pagerPrev" ${data.page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
        <span>Page ${data.page} of ${data.totalPages} &middot; ${data.total} sessions</span>
        <button class="btn btn-sm" id="pagerNext" ${data.page >= data.totalPages ? 'disabled' : ''}>Next &rarr;</button>
      </div>
    </div>`;

  $$('.session-list-row', root).forEach((row) => {
    row.addEventListener('click', () => {
      openSessionDetail(row.dataset.slug, row.dataset.sessionId);
    });
  });

  const prevBtn = $('#pagerPrev');
  const nextBtn = $('#pagerNext');
  if (prevBtn) prevBtn.addEventListener('click', () => loadSessionsList(sessionsState.page - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => loadSessionsList(sessionsState.page + 1));
}

async function openSessionDetail(slug, sessionId) {
  showView('session-detail');
  const root = $('#sessionDetailRoot');
  root.innerHTML = '<div class="loading">Loading transcript...</div>';
  try {
    const data = await api(`/api/sessions/${encodeURIComponent(slug)}/${encodeURIComponent(sessionId)}`);
    renderSessionDetail(data, slug);
  } catch (err) {
    root.innerHTML = `<div class="error-note">${esc(err.message)}</div>`;
  }
}

function renderSessionDetail(data, slug) {
  const root = $('#sessionDetailRoot');
  const msgs = data.messages;
  const firstTs = msgs.find((m) => m.timestamp)?.timestamp;
  const lastTs = [...msgs].reverse().find((m) => m.timestamp)?.timestamp;

  let header = `
    <div class="detail-meta">
      <span class="mono">${esc(slug)}</span> &middot;
      ${fmtDateTime(firstTs)} &rarr; ${fmtDateTime(lastTs)} &middot;
      ${fmtDuration(firstTs, lastTs)} &middot;
      ${msgs.filter((m) => m.role === 'user').length} turns
    </div>`;

  let body = '<div class="transcript">';
  for (const m of msgs) {
    if (!m.text && (!m.tools || m.tools.length === 0)) continue; // internal-only, nothing to show

    if (m.isToolOnly) {
      const label = m.tools.includes('tool_result') ? 'tool result' : `used tool: ${m.tools.join(', ')}`;
      body += `<div class="tool-marker">${esc(label)}</div>`;
      continue;
    }

    const roleClass = m.role === 'user' ? 'bubble-user' : 'bubble-assistant';
    const toolNote = m.tools && m.tools.length ? ` <span class="tool-marker" style="margin-left:6px;">${esc(m.tools.join(', '))}</span>` : '';
    body += `
      <div>
        <div class="bubble-meta">${m.role === 'user' ? 'You' : 'Claude'} &middot; ${fmtDateTime(m.timestamp)}</div>
        <div class="bubble ${roleClass}">${esc(m.text)}${toolNote}</div>
      </div>`;
  }
  body += '</div>';

  root.innerHTML = header + body;
}

$('#backToSessions').addEventListener('click', () => showView('sessions'));

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

$('#portLabel').textContent = window.location.port || '80';
loadToday();
