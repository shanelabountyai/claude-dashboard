'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Minimal YAML frontmatter parser for `.claude/agents/*.md` files.
 * Only handles the flat `key: value` shape these files use — not a general
 * YAML parser, deliberately, since the format is simple and fixed.
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const body = match[1];
  const fields = {};
  let currentKey = null;
  for (const line of body.split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      let value = kv[2].trim();
      // Strip matching quotes if present.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      fields[currentKey] = value;
    } else if (currentKey && /^\s+\S/.test(line)) {
      // Continuation of a multi-line scalar (rare, but be tolerant).
      fields[currentKey] += ' ' + line.trim();
    }
  }
  return fields;
}

function discoverAgentsInProject(projectPath) {
  const agentsDir = path.join(projectPath, '.claude', 'agents');
  if (!fs.existsSync(agentsDir) || !fs.statSync(agentsDir).isDirectory()) {
    return [];
  }
  const files = fs
    .readdirSync(agentsDir, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith('.md'));

  const agents = [];
  for (const file of files) {
    const filePath = path.join(agentsDir, file.name);
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const fm = parseFrontmatter(raw);
    if (!fm) continue;
    agents.push({
      name: fm.name || path.basename(file.name, '.md'),
      description: fm.description || '',
      model: fm.model || 'inherit',
      file: path.relative(projectPath, filePath),
      projectPath
    });
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discovers agents across every configured project path, grouped by project.
 * Projects with no .claude/agents directory are silently skipped.
 */
function discoverAllAgents(projectPaths) {
  const groups = [];
  for (const projectPath of projectPaths) {
    const agents = discoverAgentsInProject(projectPath);
    if (agents.length > 0) {
      groups.push({ projectPath, agents });
    }
  }
  return groups;
}

module.exports = { discoverAgentsInProject, discoverAllAgents, parseFrontmatter };
