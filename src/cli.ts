#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { startTaskRelayServer } from './server.js';

interface ServeOptions {
  profile?: string;
  configDir?: string;
  storage?: 'memory' | 'sqlite';
  sqlite?: string;
  transport?: string;
}

function applyConfigDir(dir: string): void {
  const absolute = resolve(dir);
  process.env['TASK_RELAY_CONFIG_DIR'] = absolute;

  const prompts = join(absolute, 'prompts');
  if (!process.env['TASK_RELAY_PROMPTS_DIR'] && existsSync(prompts) && statSync(prompts).isDirectory()) {
    process.env['TASK_RELAY_PROMPTS_DIR'] = prompts;
  }

  const schemata = join(absolute, 'schemata');
  if (!process.env['TASK_RELAY_SCHEMATA_DIR'] && existsSync(schemata) && statSync(schemata).isDirectory()) {
    process.env['TASK_RELAY_SCHEMATA_DIR'] = schemata;
  }

  const policy = join(absolute, 'policy.yaml');
  if (!process.env['TASK_RELAY_POLICY_FILE'] && existsSync(policy) && statSync(policy).isFile()) {
    process.env['TASK_RELAY_POLICY_FILE'] = policy;
  }
}

async function serve(opts: ServeOptions): Promise<void> {
  if (opts.profile) {
    process.env['TASK_RELAY_PROFILE'] = opts.profile;
  } else if (!process.env['TASK_RELAY_PROFILE']) {
    process.env['TASK_RELAY_PROFILE'] = 'dev';
  }

  if (opts.configDir) {
    applyConfigDir(opts.configDir);
  }

  const storage = opts.storage ?? (process.env['TASK_RELAY_STORAGE'] as 'memory' | 'sqlite' | undefined) ?? 'memory';
  if (storage !== 'memory' && storage !== 'sqlite') {
    throw new Error(`Unsupported storage mode: ${storage}`);
  }
  process.env['TASK_RELAY_STORAGE'] = storage;

  if (opts.sqlite) {
    process.env['TASK_RELAY_SQLITE_URL'] = resolve(opts.sqlite);
  } else if (!process.env['TASK_RELAY_SQLITE_URL'] && storage === 'sqlite') {
    process.env['TASK_RELAY_SQLITE_URL'] = resolve('./.tmp/dev.sqlite');
  }

  const transport = opts.transport ?? process.env['TASK_RELAY_TRANSPORT'] ?? 'stdio';
  process.env['TASK_RELAY_TRANSPORT'] = transport;

  if (transport !== 'stdio') {
    throw new Error(`Unsupported transport: ${transport}`);
  }

  await startTaskRelayServer({ askAnswer: true, webUi: process.env['TASK_RELAY_WEB_UI'] === 'true' });
}

const program = new Command();
program.name('mcp-task-relay').description('MCP Task Relay CLI').version('0.2.0');

program
  .command('serve')
  .description('Start the MCP Task Relay stdio server')
  .option('--profile <profile>', 'Profile (dev|staging|prod)')
  .option('--config-dir <dir>', 'Directory to load prompts/schemata/policy overrides')
  .option('--storage <mode>', 'Storage backend (memory|sqlite)')
  .option('--sqlite <path>', 'SQLite file path when using --storage sqlite')
  .option('--transport <transport>', 'Transport (stdio)')
  .action((opts: ServeOptions) => {
    serve(opts).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
