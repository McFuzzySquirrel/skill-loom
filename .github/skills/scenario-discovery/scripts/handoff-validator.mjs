#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 2_000;
const MAX_PACKAGES = 100;
const MAX_JSON_BYTES = 30 * 1024 * 1024;
const excluded = /^(?:\.env(?:\..*)?|\.git|\.loom|\.ssh|node_modules|credentials(?:\..*)?)$/i;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, expected, label) {
  assert(isRecord(value), `${label} must be an object.`);
  const keys = Object.keys(value).sort();
  assert(keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]),
    `${label} has missing or unsupported fields.`);
}

function validatePath(path, allowRoot = false) {
  if (allowRoot && path === '.') return;
  assert(typeof path === 'string' && path.length > 0 && path.length <= 512,
    'A handoff package path is empty or too long.');
  const segments = path.split('/');
  assert(segments.length <= 32 && segments.every((part) =>
    part !== '' && part !== '.' && part !== '..' &&
    /^[^\\/:*?"<>|\x00-\x1f]+$/.test(part) &&
    !/[. ]$/.test(part) && !excluded.test(part) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)),
  `The handoff contains an unsafe or excluded path: ${path}`);
}

function validateRepositoryPath(path) {
  if (path === '.') return;
  assert(typeof path === 'string' && path.length > 0 && path.length <= 4_096 &&
    !path.startsWith('/') && !path.includes('\\') && !path.includes('\0'),
  'A candidate repository path is invalid.');
  const segments = path.split('/');
  assert(segments.every((part) =>
    part !== '' && part !== '.' && part !== '..' &&
    /^[^/:*?"<>|\x00-\x1f]+$/.test(part) &&
    !/[. ]$/.test(part) && !excluded.test(part) &&
    !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)),
  'A candidate repository path is unsafe or excluded.');
}

function decodeBase64(value) {
  assert(typeof value === 'string' && value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value),
  'Handoff file contents must be canonical base64.');
  const bytes = Buffer.from(value, 'base64');
  assert(bytes.toString('base64') === value, 'Handoff file contents are not canonical base64.');
  return bytes;
}

function digestPackage(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    hash.update(file.path).update('\0').update(file.executable ? 'x' : '-').update('\0')
      .update(decodeBase64(file.content));
  }
  return hash.digest('hex');
}

function extractSkillName(content) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert(frontmatter, 'A candidate SKILL.md has invalid frontmatter.');
  const line = frontmatter[1].split(/\r?\n/).find((entry) => /^name\s*:/.test(entry));
  assert(line, 'A candidate SKILL.md is missing its name field.');
  let name = line.slice(line.indexOf(':') + 1).trim();
  if (name.startsWith('"')) {
    const quoted = name.match(/^("(?:\\.|[^"\\])*")(?:\s+#.*)?$/);
    assert(quoted, 'A candidate SKILL.md has an invalid quoted name.');
    name = JSON.parse(quoted[1]);
  } else if (name.startsWith("'")) {
    const quoted = name.match(/^'((?:[^']|'')*)'(?:\s+#.*)?$/);
    assert(quoted, 'A candidate SKILL.md has an invalid quoted name.');
    name = quoted[1].replaceAll("''", "'");
  } else {
    name = name.replace(/\s+#.*$/, '').trim();
  }
  assert(typeof name === 'string' && name.length > 0 && name.length <= 255,
    'A candidate SKILL.md has an invalid name.');
  return name;
}

export function validateHandoff(raw, byteLength = Buffer.byteLength(JSON.stringify(raw), 'utf8')) {
  assert(byteLength <= MAX_JSON_BYTES, `The handoff exceeds the ${MAX_JSON_BYTES}-byte JSON limit.`);
  exactKeys(raw, ['format', 'version', 'goal', 'harness', 'createdAt', 'candidates', 'fingerprint'], 'handoff');
  assert(raw.format === 'skill-loom-discovery-handoff' && raw.version === 1,
    'Unsupported Skill Loom discovery handoff format or version.');
  assert(typeof raw.goal === 'string' && raw.goal.trim() === raw.goal &&
    raw.goal.length > 0 && raw.goal.length <= 1_000,
  'The handoff goal is invalid.');
  assert(raw.harness === 'opencode' || raw.harness === 'copilot',
    'The handoff harness is unsupported.');
  assert(typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) &&
    new Date(raw.createdAt).toISOString() === raw.createdAt,
  'The handoff creation timestamp is invalid.');
  assert(Array.isArray(raw.candidates) && raw.candidates.length > 0 &&
    raw.candidates.length <= MAX_PACKAGES,
  `The handoff must contain between 1 and ${MAX_PACKAGES} candidates.`);
  assert(typeof raw.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(raw.fingerprint),
    'The handoff fingerprint is invalid.');

  const identities = new Set();
  let totalFiles = 0;
  let totalBytes = 0;
  const candidates = raw.candidates.map((candidate, index) => {
    exactKeys(candidate, ['sourceId', 'revision', 'repositoryPath', 'name', 'fingerprint', 'files'], `candidates[${index}]`);
    assert(typeof candidate.sourceId === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(candidate.sourceId),
      `Candidate ${index + 1} has an invalid source id.`);
    assert(typeof candidate.revision === 'string' && /^[a-f0-9]{40,64}$/.test(candidate.revision),
      `Candidate ${index + 1} has an invalid revision.`);
    validateRepositoryPath(candidate.repositoryPath);
    assert(typeof candidate.name === 'string' && candidate.name.trim() === candidate.name &&
      candidate.name.length > 0 && candidate.name.length <= 128 &&
      !/[\\/]/.test(candidate.name),
    `Candidate ${index + 1} has an invalid skill name.`);
    validatePath(candidate.name);
    assert(typeof candidate.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(candidate.fingerprint),
      `Candidate ${index + 1} has an invalid package fingerprint.`);
    const identity = JSON.stringify([
      candidate.sourceId,
      candidate.revision,
      candidate.repositoryPath,
      candidate.fingerprint,
    ]);
    assert(!identities.has(identity), 'The handoff contains a duplicate candidate identity.');
    identities.add(identity);
    assert(Array.isArray(candidate.files) && candidate.files.length > 0 &&
      candidate.files.length <= MAX_FILES,
    `Candidate ${index + 1} has an invalid file inventory.`);
    const paths = new Set();
    const files = candidate.files.map((file, fileIndex) => {
      exactKeys(file, ['path', 'content', 'executable'], `candidates[${index}].files[${fileIndex}]`);
      validatePath(file.path);
      const pathKey = file.path.toLowerCase();
      assert(!paths.has(pathKey), 'A candidate contains duplicate package file paths.');
      paths.add(pathKey);
      assert(typeof file.executable === 'boolean', 'A candidate file executable flag is invalid.');
      const content = decodeBase64(file.content);
      totalBytes += content.length;
      totalFiles += 1;
      assert(totalBytes <= MAX_BYTES && totalFiles <= MAX_FILES,
        `Handoff limits are ${MAX_PACKAGES} packages, ${MAX_FILES} files, and ${MAX_BYTES} decoded bytes.`);
      return { path: file.path, content: file.content, executable: file.executable };
    });
    for (const path of paths) {
      const segments = path.split('/');
      while (segments.length > 1) {
        segments.pop();
        assert(!paths.has(segments.join('/').toLowerCase()),
          `A candidate file conflicts with a directory: ${path}`);
      }
    }
    const skillFile = files.find((file) => file.path === 'SKILL.md');
    assert(skillFile, 'Every candidate must include SKILL.md.');
    assert(extractSkillName(decodeBase64(skillFile.content).toString('utf8')) === candidate.name,
      'A candidate name does not match its SKILL.md frontmatter.');
    assert(digestPackage(files) === candidate.fingerprint,
      `Candidate ${candidate.name} content fingerprint does not match.`);
    return {
      sourceId: candidate.sourceId,
      revision: candidate.revision,
      repositoryPath: candidate.repositoryPath,
      name: candidate.name,
      fingerprint: candidate.fingerprint,
      files,
    };
  });

  const body = {
    format: 'skill-loom-discovery-handoff',
    version: 1,
    goal: raw.goal,
    harness: raw.harness,
    createdAt: raw.createdAt,
    candidates,
  };
  const actual = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
  assert(actual === raw.fingerprint, 'The discovery handoff fingerprint does not match its contents.');
  return { ...body, fingerprint: raw.fingerprint };
}

export async function readHandoffFile(path) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink(), 'The handoff path must be a regular file, not a symlink.');
  assert(info.size <= MAX_JSON_BYTES, `The handoff exceeds the ${MAX_JSON_BYTES}-byte JSON limit.`);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    assert(opened.isFile() && opened.size <= MAX_JSON_BYTES,
      'The handoff changed or is not a supported regular file.');
    const text = await handle.readFile('utf8');
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      fail('The discovery handoff is not valid JSON.');
    }
    return validateHandoff(raw, Buffer.byteLength(text, 'utf8'));
  } finally {
    await handle.close();
  }
}
