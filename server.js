'use strict';

const express = require('express');
const path = require('path');

const configLib = require('./lib/config');
const git = require('./lib/git');
const sessionsLib = require('./lib/sessions');
const agentsLib = require('./lib/agents');
const { streamClaudeRun } = require('./lib/runner');

const PORT = process.env.PORT || 4173;
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Config: project paths + skills list
// ---------------------------------------------------------------------------

app.get('/api/config', (req, res) => {
  try {
    res.json(configLib.readConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/config/paths', (req, res) => {
  const { path: newPath } = req.body || {};
  if (!newPath || typeof newPath !== 'string') {
    return res.status(400).json({ error: 'Body must include a "path" string.' });
  }
  try {
    const config = configLib.addProjectPath(newPath);
    res.json(config);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/config/paths', (req, res) => {
  const { path: targetPath } = req.body || {};
  if (!targetPath) {
    return res.status(400).json({ error: 'Body must include a "path" string.' });
  }
  try {
    const config = configLib.removeProjectPath(targetPath);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Daily report: git activity + session activity combined
// ---------------------------------------------------------------------------

function toLocalDateStr(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLocalISODate() {
  return toLocalDateStr(new Date());
}

app.get('/api/daily-report', (req, res) => {
  const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
    ? req.query.date
    : todayLocalISODate();

  try {
    const config = configLib.readConfig();
    const allSessions = sessionsLib.listAllSessions(config.projectPaths);

    // Sessions active on this date, keyed by project path (falls back to cwd/slug string).
    // A session "touches" a day if any part of its [start, end] span falls on that
    // local date -- important for long-running sessions that cross midnight.
    const sessionsByProject = new Map();
    for (const s of allSessions) {
      if (!s.start && !s.end) continue;
      const startDay = toLocalDateStr(s.start || s.end);
      const endDay = toLocalDateStr(s.end || s.start);
      if (date < startDay || date > endDay) continue;
      const key = s.cwd || s.projectPath || s.slug;
      if (!sessionsByProject.has(key)) sessionsByProject.set(key, []);
      sessionsByProject.get(key).push(s);
    }

    const projectKeys = new Set([...config.projectPaths, ...sessionsByProject.keys()]);

    const projects = [];
    let totalCommits = 0;
    let totalSessions = 0;
    let totalTurns = 0;

    for (const projectPath of projectKeys) {
      const isConfigured = config.projectPaths.includes(projectPath);
      const gitResult = isConfigured ? git.getCommitsForDay(projectPath, date) : null;
      const sessionList = (sessionsByProject.get(projectPath) || []).map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        start: s.start,
        end: s.end,
        turnCount: s.turnCount,
        slug: s.slug
      }));

      const commitCount = gitResult && gitResult.commits ? gitResult.commits.length : 0;
      const sessionTurns = sessionList.reduce((sum, s) => sum + (s.turnCount || 0), 0);

      if (commitCount === 0 && sessionList.length === 0) continue;

      totalCommits += commitCount;
      totalSessions += sessionList.length;
      totalTurns += sessionTurns;

      projects.push({
        path: projectPath,
        name: path.basename(projectPath),
        git: gitResult
          ? { commitCount, commits: gitResult.commits, error: gitResult.error || null }
          : null,
        sessions: { count: sessionList.length, totalTurns: sessionTurns, sessions: sessionList }
      });
    }

    projects.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      date,
      summary: {
        totalCommits,
        totalSessions,
        totalTurns,
        activeProjects: projects.length
      },
      projects
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Skills: config-defined one-click buttons, run via `claude -p "/skill args"`
// ---------------------------------------------------------------------------

app.get('/api/skills', (req, res) => {
  try {
    const { skills } = configLib.readConfig();
    res.json({ skills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/skills/run', (req, res) => {
  const index = parseInt(req.query.index, 10);
  const { skills } = configLib.readConfig();
  const skill = skills[index];
  if (!skill) {
    return res.status(404).json({ error: 'Unknown skill index.' });
  }
  const overrideArgs = typeof req.query.args === 'string' ? req.query.args : skill.args || '';
  const prompt = `${skill.invocation}${overrideArgs ? ' ' + overrideArgs : ''}`.trim();
  streamClaudeRun(res, { prompt, cwd: skill.cwd });
});

// ---------------------------------------------------------------------------
// Automations: subagent personas discovered from .claude/agents/*.md
// ---------------------------------------------------------------------------

app.get('/api/agents', (req, res) => {
  try {
    const { projectPaths } = configLib.readConfig();
    const groups = agentsLib.discoverAllAgents(projectPaths);
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/agents/run', (req, res) => {
  const { projectPath, name } = req.query;
  const task = typeof req.query.task === 'string' && req.query.task.trim()
    ? req.query.task.trim()
    : 'Do a general review of this project within your area of responsibility.';

  if (!projectPath || !name) {
    return res.status(400).json({ error: 'projectPath and name query params are required.' });
  }

  const agents = agentsLib.discoverAgentsInProject(projectPath);
  const agent = agents.find((a) => a.name === name);
  if (!agent) {
    return res.status(404).json({ error: `Agent "${name}" not found in ${projectPath}.` });
  }

  const prompt =
    `Act as the "${agent.name}" subagent persona defined in ${agent.file} in this project. ` +
    `Read that file first to adopt its full role, expertise, and instructions, then, staying in that persona, ` +
    `complete the following task: ${task}`;

  streamClaudeRun(res, { prompt, cwd: projectPath });
});

// ---------------------------------------------------------------------------
// Sessions: cross-project log of every Claude Code session on this machine
// ---------------------------------------------------------------------------

app.get('/api/sessions', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize, 10) || 25));

    const { projectPaths } = configLib.readConfig();
    const all = sessionsLib.listAllSessions(projectPaths);

    const start = (page - 1) * pageSize;
    const pageItems = all.slice(start, start + pageSize).map((s) => ({
      sessionId: s.sessionId,
      slug: s.slug,
      projectPath: s.projectPath,
      title: s.title,
      start: s.start,
      end: s.end,
      turnCount: s.turnCount,
      gitBranch: s.gitBranch
    }));

    res.json({
      page,
      pageSize,
      total: all.length,
      totalPages: Math.max(1, Math.ceil(all.length / pageSize)),
      sessions: pageItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:slug/:sessionId', (req, res) => {
  try {
    const { slug, sessionId } = req.params;
    const transcript = sessionsLib.getSessionTranscript(slug, sessionId);
    res.json(transcript);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Claude Dashboard running at http://localhost:${PORT}`);
});
