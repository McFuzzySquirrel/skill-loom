#!/usr/bin/env node
import { isAbsolute } from 'node:path';
import { readHandoffFile } from './handoff-validator.mjs';

function parseArgs(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node read-handoff.mjs --handoff <absolute-file-path>');
    process.exit(0);
  }
  if (args.length !== 2 || args[0] !== '--handoff' || !isAbsolute(args[1] ?? '')) {
    throw new Error('Expected --handoff <absolute-file-path>.');
  }
  return args[1];
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('Node.js 24 or newer is required.');
  }
  const handoff = await readHandoffFile(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(handoff, null, 2)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The handoff could not be validated.');
  process.exitCode = 1;
}
