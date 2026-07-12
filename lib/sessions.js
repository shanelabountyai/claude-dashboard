'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CLAUDE_PROJECTS_DIR = path.join(require('os').homedir(), '.claude', 'projects');

// In-memory cache of lightweight session metadata, keyed by absolute file path.
// Invalidated automatically when a file's mtime/size changes.
const metaCache = new Map();

function listProjectSlugDirs() {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return [];
  return fs
    .readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function listSessionFiles(slug) {
  const dir = path.join(CLAUDE_PROJECTS_DIR, slug);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.jsonl'))
    .map((f) => path.join(dir, f.name));
}

/**
 * Best-effort de-slugification of a `.claude/projects` directory name back into
 * an absolute path. Slugs are formed by replacing every "/" with "-", which is
 * lossy for path components that themselves contain hyphens. We first check the
 * configured project paths (exact match, since we know their real slugs), then
 * fall back to a naive replace.
 */
function deslugify(slug, knownPaths) {
  for (const p of knownPaths || []) {
    if (slugify(p) === slug) return p;
  }
  const naive = slug.replace(/-/g, '/');
  return naive;
}

function slugify(absPath) {
  return absPath.replace(/\//g, '-');
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n');
}

function extractToolNames(content) {
  if (!Array.isArray(content)) return [];
  const names = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'tool_use' && block.name) names.push(block.name);
    if (block.type === 'tool_result') names.push('tool_result');
  }
  return names;
}

/**
 * Cheap pass over a session file: title, start/end timestamp, turn count, cwd.
 * Does NOT retain message content in memory.
 */
function getSessionMeta(filePath) {
  const stat = fs.statSync(filePath);
  const cacheKey = filePath;
  const cached = metaCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.meta;
  }

  const sessionId = path.basename(filePath, '.jsonl');
  let aiTitle = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let turnCount = 0;
  let firstUserText = null;
  let cwd = null;
  let gitBranch = null;

  const contents = fs.readFileSync(filePath, 'utf8');
  const lines = contents.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type === 'ai-title' && d.aiTitle) {
      aiTitle = d.aiTitle;
    }
    if (d.timestamp) {
      if (!firstTimestamp || d.timestamp < firstTimestamp) firstTimestamp = d.timestamp;
      if (!lastTimestamp || d.timestamp > lastTimestamp) lastTimestamp = d.timestamp;
    }
    if (d.type === 'user' && d.message) {
      turnCount++;
      if (!cwd && d.cwd) cwd = d.cwd;
      if (!gitBranch && d.gitBranch) gitBranch = d.gitBranch;
      if (!firstUserText) {
        const text = extractText(d.message.content).trim();
        if (text) firstUserText = text;
      }
    }
    if (d.type === 'assistant' && !cwd && d.cwd) {
      cwd = d.cwd;
    }
  }

  const title = aiTitle || (firstUserText ? truncate(firstUserText, 80) : 'Untitled session');

  const meta = {
    sessionId,
    title,
    cwd,
    gitBranch,
    start: firstTimestamp,
    end: lastTimestamp,
    turnCount,
    filePath
  };

  metaCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, meta });
  return meta;
}

function truncate(str, len) {
  if (str.length <= len) return str;
  return str.slice(0, len).trim() + '...';
}

/**
 * Lists sessions across every project under ~/.claude/projects, newest first.
 * Cheap per-file metadata scan only (cached); does not load full transcripts.
 */
function listAllSessions(knownPaths) {
  const slugs = listProjectSlugDirs();
  const sessions = [];
  for (const slug of slugs) {
    const files = listSessionFiles(slug);
    for (const file of files) {
      try {
        const meta = getSessionMeta(file);
        sessions.push({
          ...meta,
          slug,
          projectPath: deslugify(slug, knownPaths)
        });
      } catch (err) {
        // Skip unreadable/corrupt session files rather than failing the whole list.
        continue;
      }
    }
  }
  sessions.sort((a, b) => {
    const ta = a.end || a.start || '';
    const tb = b.end || b.start || '';
    return tb.localeCompare(ta);
  });
  return sessions;
}

/**
 * Full transcript for one session, parsed on demand only.
 */
function getSessionTranscript(slug, sessionId) {
  const filePath = path.join(CLAUDE_PROJECTS_DIR, slug, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }

  const messages = [];
  const contents = fs.readFileSync(filePath, 'utf8');
  const lines = contents.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    if (!d.message) continue;

    const text = extractText(d.message.content);
    const tools = extractToolNames(d.message.content);

    // Skip pure tool-result bookkeeping messages with no human-readable text;
    // still surface that a tool ran via a compact marker instead of a full bubble.
    messages.push({
      role: d.message.role || d.type,
      timestamp: d.timestamp || null,
      text,
      tools,
      isToolOnly: !text && tools.length > 0
    });
  }

  return { sessionId, messages };
}

module.exports = {
  CLAUDE_PROJECTS_DIR,
  listProjectSlugDirs,
  listAllSessions,
  getSessionMeta,
  getSessionTranscript,
  deslugify,
  slugify
};
