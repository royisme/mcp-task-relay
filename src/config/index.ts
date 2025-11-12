/**
 * Configuration loader
 * Loads from environment variables and .env file
 */

import { config as loadDotenv } from 'dotenv';
import { ConfigSchema, type Config } from './schema.js';
import { Result, Ok, Err } from '../models/index.js';

// Load .env file
loadDotenv();

function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] ?? defaultValue;
}

function getEnvNumber(key: string, defaultValue?: number): number | undefined {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(key: string, defaultValue?: boolean): boolean | undefined {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  return value === 'true' || value === '1';
}

const PROFILE_VALUES = new Set(['dev', 'staging', 'prod']);

function normalizeProfile(value: string | undefined): 'dev' | 'staging' | 'prod' {
  if (!value || !PROFILE_VALUES.has(value)) {
    return 'dev';
  }
  return value as 'dev' | 'staging' | 'prod';
}

function normalizeStorageMode(value: string | undefined): 'memory' | 'sqlite' {
  return value === 'sqlite' ? 'sqlite' : 'memory';
}

export function loadConfig(): Result<Config, string> {
  try {
    const profile = normalizeProfile(process.env['TASK_RELAY_PROFILE']);
    const transport = process.env['TASK_RELAY_TRANSPORT'] ?? 'stdio';
    if (transport !== 'stdio') {
      return Err(`Unsupported transport: ${transport}`);
    }

    const storageMode = normalizeStorageMode(process.env['TASK_RELAY_STORAGE']);
    const sqlitePath =
      storageMode === 'sqlite'
        ? getEnv('TASK_RELAY_SQLITE_URL', getEnv('DB_PATH', './.tmp/dev.sqlite'))
        : getEnv('TASK_RELAY_SQLITE_URL', 'file:mcp-task-relay?mode=memory&cache=shared');

    const config = {
      runtime: {
        profile,
        transport: 'stdio' as const,
        promptsDir: process.env['TASK_RELAY_PROMPTS_DIR'],
        schemataDir: process.env['TASK_RELAY_SCHEMATA_DIR'],
        policyFile: process.env['TASK_RELAY_POLICY_FILE'],
      },
      server: {
        artifactRoot: getEnv('ARTIFACT_ROOT', './artifacts'),
        maxConcurrency: getEnvNumber('MAX_CONCURRENCY', 3),
        heartbeatIntervalSec: getEnvNumber('HEARTBEAT_INTERVAL_SEC', 15),
        leaseTtlSec: getEnvNumber('LEASE_TTL_SEC', 60),
        workerPollIntervalMs: getEnvNumber('WORKER_POLL_INTERVAL_MS', 5000),
        jobTimeoutCheckIntervalMs: getEnvNumber('JOB_TIMEOUT_CHECK_INTERVAL_MS', 30000),
      },
      askAnswer: {
        port: getEnvNumber('ASK_ANSWER_PORT', 3415),
        longPollTimeoutSec: getEnvNumber('ASK_ANSWER_WAIT_SEC', 25),
        sseHeartbeatSec: getEnvNumber('ASK_ANSWER_SSE_HEARTBEAT_SEC', 10),
      },
      storage: {
        mode: storageMode,
        sqlitePath,
      },
      policies: {
        generation: {
          sandbox: 'read-only' as const,
          askPolicy: 'untrusted' as const,
          requireSections: ['DIFF', 'TEST_PLAN', 'NOTES'],
        },
      },
      executors: {
        codexCli: {
          enabled: getEnvBoolean('CODEX_ENABLED', true),
          binary: getEnv('CODEX_BINARY', 'codex'),
          defaultModel: getEnv('CODEX_DEFAULT_MODEL', 'gpt-4'),
          enableSearch: getEnvBoolean('CODEX_ENABLE_SEARCH', true),
        },
        claudeCode: {
          enabled: getEnvBoolean('CLAUDE_ENABLED', false),
          binary: getEnv('CLAUDE_BINARY', 'claude'),
          defaultModel: getEnv('CLAUDE_DEFAULT_MODEL', 'claude-sonnet-4'),
        },
      },
      notify: {
        useMcpResourceSubscriptions: getEnvBoolean('NOTIFY_MCP_SUBSCRIPTIONS', true),
        webhook: getEnv('NOTIFY_WEBHOOK'),
        enablePr: getEnvBoolean('NOTIFY_ENABLE_PR', false),
      },
      logging: {
        level: (getEnv('LOG_LEVEL', 'info') as Config['logging']['level']),
        pretty: getEnvBoolean('LOG_PRETTY', true),
      },
    };

    const parsed = ConfigSchema.safeParse(config);
    if (!parsed.success) {
      return Err(`Invalid configuration: ${parsed.error.message}`);
    }

    return Ok(parsed.data);
  } catch (error) {
    return Err(`Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type { Config } from './schema.js';
