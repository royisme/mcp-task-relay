import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createConnection, runMigrations, type StorageMode } from './db/connection.js';
import { loadConfig } from './config/index.js';
import { createLogger } from './utils/logger.js';
import { ArtifactsService } from './services/artifacts.js';
import { Notifier } from './services/notifier.js';
import { JobHubMCPServer } from './mcp/server.js';
import { createExecutors, selectExecutor } from './executors/index.js';
import { JobManager } from './core/job-manager.js';
import { Worker } from './core/worker.js';
import { AskAnswerServer } from './services/ask-answer.js';

export interface TaskRelayServerOptions {
  /**
   * Whether to start the Ask/Answer HTTP bridge. Defaults to true so Phase 2 flows operate.
   */
  askAnswer?: boolean;
  /**
   * Whether to start the legacy Web UI. Defaults to false in dev-focused CLI usage.
   */
  webUi?: boolean;
}

function resolveSqlitePath(mode: StorageMode, provided?: string): string {
  if (provided) {
    return provided;
  }
  if (mode === 'sqlite') {
    return resolve('./.tmp/dev.sqlite');
  }
  return 'file:mcp-task-relay?mode=memory&cache=shared';
}

export async function startTaskRelayServer(options: TaskRelayServerOptions = {}): Promise<void> {
  const configResult = loadConfig();
  if (!configResult.ok) {
    throw new Error(configResult.error);
  }

  const config = configResult.value;

  const logger = createLogger(config.logging);
  logger.info(
    {
      profile: config.runtime.profile,
      transport: config.runtime.transport,
      storage: config.storage.mode,
    },
    'Starting MCP Task Relay'
  );

  await mkdir(config.server.artifactRoot, { recursive: true });

  const sqlitePath = resolveSqlitePath(config.storage.mode, config.storage.sqlitePath);
  const { db, close } = createConnection(sqlitePath, { mode: config.storage.mode });

  try {
    runMigrations(db);
    logger.debug({ sqlitePath }, 'Storage ready');

    const artifacts = new ArtifactsService(config.server.artifactRoot);
    const executors = createExecutors(config);
    if (executors.length === 0) {
      throw new Error('No executors configured. Enable at least one CLI backend.');
    }

    const jobManager = new JobManager(db, artifacts, logger);
    const notifier = new Notifier(null, logger);

    let askAnswerServer: AskAnswerServer | undefined;
    if (options.askAnswer !== false) {
      askAnswerServer = new AskAnswerServer(jobManager, logger, {
        port: config.askAnswer.port,
        longPollTimeoutMs: config.askAnswer.longPollTimeoutSec * 1000,
        sseHeartbeatMs: config.askAnswer.sseHeartbeatSec * 1000,
      });
      askAnswerServer.start();
    }

    if (options.webUi) {
      const WebUIServerModule = await import('./services/web-ui.js');
      const webUiServer = new WebUIServerModule.WebUIServer(
        jobManager,
        notifier,
        logger,
        parseInt(process.env['WEB_UI_PORT'] ?? '3000', 10)
      );
      webUiServer.start();
    }

    const executor = selectExecutor(executors);
    if (!executor) {
      throw new Error('Unable to select executor');
    }

    const workerConfig = {
      leaseTtlMs: config.server.leaseTtlSec * 1000,
      heartbeatIntervalMs: config.server.heartbeatIntervalSec * 1000,
      pollIntervalMs: config.server.workerPollIntervalMs,
    };

    for (let i = 0; i < config.server.maxConcurrency; i++) {
      const worker = new Worker(db, artifacts, executor, workerConfig, logger);
      void worker.start().catch((error) => {
        logger.error({ error }, 'Worker crashed');
      });
    }

    const mcpServer = new JobHubMCPServer(jobManager, artifacts, notifier, logger);
    await mcpServer.start();

    logger.info('MCP stdio transport running');

    const shutdown = (): void => {
      logger.info('Shutting down Task Relay');
      askAnswerServer?.stop();
      close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    close();
    throw error instanceof Error ? error : new Error(String(error));
  }
}
