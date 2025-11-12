#!/usr/bin/env node
/**
 * JobHub - MCP Task Relay Main Entry Point
 */

import { createConnection, runMigrations } from './db/index.js';
import { ArtifactsService } from './services/artifacts.js';
import { Notifier } from './services/notifier.js';
import { WebUIServer } from './services/web-ui.js';
import { JobManager } from './core/job-manager.js';
import { Worker } from './core/worker.js';
import { JobHubMCPServer } from './mcp/server.js';
import { createExecutors, selectExecutor } from './executors/index.js';
import { loadConfig } from './config/index.js';
import { createLogger } from './utils/logger.js';
import { mkdir } from 'fs/promises';

async function main(): Promise<void> {
  // Load configuration
  const configResult = loadConfig();
  if (!configResult.ok) {
    console.error('Failed to load configuration:', configResult.error);
    process.exit(1);
  }

  const config = configResult.value;

  // Create logger
  const logger = createLogger(config.logging);

  logger.info('Starting JobHub...');

  // Ensure artifact directory exists
  await mkdir(config.server.artifactRoot, { recursive: true });

  // Initialize database
  const { db, close } = createConnection(config.storage.sqlitePath);

  try {
    runMigrations(db);
    logger.info('Database initialized');

    // Create services
    const artifacts = new ArtifactsService(config.server.artifactRoot);

    // Create executors
    const executors = createExecutors(config);
    if (executors.length === 0) {
      logger.error('No executors configured');
      process.exit(1);
    }
    logger.info(
      { executors: executors.map((e) => e.name) },
      'Executors initialized'
    );

    // Create core services
    const jobManager = new JobManager(db, artifacts, logger);

    // Create notifier (initially without MCP server)
    const notifier = new Notifier(null, logger);

    // Start Web UI
    if (process.env['ENABLE_WEB_UI'] !== 'false') {
      const webUI = new WebUIServer(
        jobManager,
        notifier,
        logger,
        parseInt(process.env['WEB_UI_PORT'] || '3000', 10)
      );
      webUI.start();
    }

    // Check if running in MCP mode or standalone mode
    const isMCPMode = process.env['MCP_MODE'] !== 'false';

    if (isMCPMode) {
      // MCP Server mode
      const mcpServer = new JobHubMCPServer(jobManager, artifacts, notifier, logger);

      await mcpServer.start();
      logger.info('MCP server mode');
    } else {
      // Standalone worker mode
      logger.info('Standalone worker mode');

      // Start workers
      const executor = selectExecutor(executors);
      if (!executor) {
        logger.error('No executor available');
        process.exit(1);
      }

      const workerConfig = {
        leaseTtlMs: config.server.leaseTtlSec * 1000,
        heartbeatIntervalMs: config.server.heartbeatIntervalSec * 1000,
        pollIntervalMs: config.server.workerPollIntervalMs,
      };

      // Start multiple workers based on concurrency config
      const workers = [];
      for (let i = 0; i < config.server.maxConcurrency; i++) {
        const worker = new Worker(db, artifacts, executor, workerConfig, logger);
        workers.push(worker);

        // Start worker in background (don't await)
        worker.start().catch((error) => {
          logger.error({ error }, 'Worker crashed');
        });
      }

      logger.info(
        { count: workers.length },
        'Workers started'
      );
    }

    // Graceful shutdown
    const shutdown = (): void => {
      logger.info('Shutting down...');
      close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error({ error }, 'Fatal error');
    close();
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
