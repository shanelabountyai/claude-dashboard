'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const EXAMPLE_PATH = path.join(ROOT, 'config.example.json');

function ensureConfigExists() {
  if (!fs.existsSync(CONFIG_PATH)) {
    const seed = fs.existsSync(EXAMPLE_PATH)
      ? fs.readFileSync(EXAMPLE_PATH, 'utf8')
      : JSON.stringify({ projectPaths: [], skills: [] }, null, 2) + '\n';
    fs.writeFileSync(CONFIG_PATH, seed);
  }
}

function readConfig() {
  ensureConfigExists();
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${err.message}`);
  }
  return {
    projectPaths: Array.isArray(parsed.projectPaths) ? parsed.projectPaths : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : []
  };
}

function writeConfig(config) {
  const toSave = {
    projectPaths: config.projectPaths || [],
    skills: config.skills || []
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2) + '\n');
  return toSave;
}

function addProjectPath(newPath) {
  const config = readConfig();
  const resolved = path.resolve(newPath.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    const err = new Error(`Path does not exist or is not a directory: ${resolved}`);
    err.statusCode = 400;
    throw err;
  }
  if (!config.projectPaths.includes(resolved)) {
    config.projectPaths.push(resolved);
    writeConfig(config);
  }
  return config;
}

function removeProjectPath(targetPath) {
  const config = readConfig();
  config.projectPaths = config.projectPaths.filter((p) => p !== targetPath);
  writeConfig(config);
  return config;
}

module.exports = {
  CONFIG_PATH,
  readConfig,
  writeConfig,
  addProjectPath,
  removeProjectPath
};
