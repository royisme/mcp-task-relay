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
import { AnswerRunner } from './answer-runner/index.js';
import type { AskRecord, AnswerPayload } from './models/index.js';
import type { Logger } from 'pino';

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

/**
 * Process an Ask in the background using the Answer Runner
 */
async function processAsk(
  ask: AskRecord,
  runner: AnswerRunner,
  jobManager: JobManager,
  logger: Logger
): Promise<void> {
  logger.debug({ askId: ask.askId, jobId: ask.jobId }, 'Processing Ask with Answer Runner');

  try {
    const result = await runner.run(ask);

    const answerPayload: AnswerPayload = {
      type: 'Answer',
      ask_id: ask.askId,
      job_id: ask.jobId,
      step_id: ask.stepId,
      status: result.status,
      answer_text: result.answerText,
      answer_json: result.answerJson,
      attestation: result.attestation,
      ask_back: result.askBack,
      error: result.error,
      policy_trace: result.policyTrace,
      cacheable: result.cacheable,
    };

    const recordResult = jobManager.recordAnswer(answerPayload);
    if (!recordResult.ok) {
      logger.error(
        { askId: ask.askId, error: recordResult.error },
        'Failed to record Answer from runner'
      );
    } else {
      logger.info({ askId: ask.askId, status: result.status }, 'Answer recorded from runner');
    }
  } catch (error) {
    logger.error(
      { askId: ask.askId, error: error instanceof Error ? error.message : String(error) },
      'Answer Runner threw exception'
    );

    // Record an ERROR answer
    const errorPayload: AnswerPayload = {
      type: 'Answer',
      ask_id: ask.askId,
      job_id: ask.jobId,
      step_id: ask.stepId,
      status: 'ERROR',
      error: error instanceof Error ? error.message : String(error),
      cacheable: false,
    };

    const recordResult = jobManager.recordAnswer(errorPayload);
    if (!recordResult.ok) {
      logger.error(
        { askId: ask.askId, error: recordResult.error },
        'Failed to record ERROR answer'
      );
    }
  }
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
    let answerRunner: AnswerRunner | undefined;

    if (options.askAnswer !== false) {
      askAnswerServer = new AskAnswerServer(jobManager, logger, {
        port: config.askAnswer.port,
        longPollTimeoutMs: config.askAnswer.longPollTimeoutSec * 1000,
        sseHeartbeatMs: config.askAnswer.sseHeartbeatSec * 1000,
      });
      askAnswerServer.start();

      // Initialize Answer Runner if enabled
      if (config.askAnswer.runner.enabled) {
        const promptsDir = config.runtime.promptsDir ?? resolve('./prompts');

        try {
          answerRunner = new AnswerRunner(
            {
              promptsDir,
              model: config.askAnswer.runner.model,
              maxRetries: config.askAnswer.runner.maxRetries,
              defaultTimeout: config.askAnswer.runner.defaultTimeout,
            },
            logger
          );

          // Listen for Ask events and process them in the background
          jobManager.on('ask.created', ({ ask }) => {
            void processAsk(ask, answerRunner!, jobManager, logger).catch((error) => {
              logger.error({ askId: ask.askId, error }, 'Failed to process Ask in background');
            });
          });

          logger.info('Answer Runner initialized');
        } catch (error) {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error) },
            'Answer Runner initialization failed - Ask/Answer will require manual responses'
          );
        }
      }
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
