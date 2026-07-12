'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const UNIT_SEP = '\x1f'; // ASCII unit separator, unlikely to appear in commit messages

function isGitRepo(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

/**
 * Returns commits made in [startOfDay, endOfDay) in the given repo, local time.
 * Each commit includes hash, short message, author, ISO date, and files-changed count.
 *
 * Parses git's output line-by-line rather than splitting on a record separator:
 * `--numstat` output is appended by git *after* our `--pretty=format` string on
 * its own lines, so a header-relative separator can't cleanly bound one commit's
 * block. Instead, header lines are recognized by containing the unit separator,
 * numstat lines by their `ins<TAB>del<TAB>path` shape, and blank lines are noise.
 */
function getCommitsForDay(repoPath, dateStr) {
  if (!isGitRepo(repoPath)) return null;

  const since = `${dateStr} 00:00:00`;
  const until = `${dateStr} 23:59:59`;

  const format = `%H${UNIT_SEP}%an${UNIT_SEP}%ad${UNIT_SEP}%s`;
  const result = spawnSync(
    'git',
    [
      'log',
      `--since=${since}`,
      `--until=${until}`,
      `--date=iso-strict`,
      `--pretty=format:${format}`,
      '--numstat'
    ],
    { cwd: repoPath, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 }
  );

  if (result.status !== 0) {
    return { error: result.stderr ? result.stderr.trim() : 'git log failed', commits: [] };
  }

  const output = result.stdout || '';
  if (!output.trim()) {
    return { commits: [] };
  }

  const commits = [];
  let current = null;

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (rawLine.includes(UNIT_SEP)) {
      const [hash, author, date, ...msgParts] = rawLine.split(UNIT_SEP);
      current = {
        hash: hash.slice(0, 10),
        author,
        date,
        message: msgParts.join(UNIT_SEP),
        filesChanged: 0,
        insertions: 0,
        deletions: 0
      };
      commits.push(current);
      continue;
    }

    // numstat line: "<insertions>\t<deletions>\t<path>" (binary files show "-").
    const parts = line.split('\t');
    if (parts.length === 3 && current) {
      current.filesChanged++;
      const [ins, del] = parts;
      if (ins !== '-') current.insertions += parseInt(ins, 10) || 0;
      if (del !== '-') current.deletions += parseInt(del, 10) || 0;
    }
  }

  return { commits };
}

module.exports = { isGitRepo, getCommitsForDay };
