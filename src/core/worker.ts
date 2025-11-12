/**
 * Worker - Executes jobs from the queue
 */

import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import { JobsRepository, ArtifactsRepository, EventsRepository } from '../db/index.js';
import { ArtifactsService } from '../services/artifacts.js';
import type { Executor } from '../executors/index.js';
import { asLeaseOwner, type JobId } from '../models/index.js';
import { execa } from 'execa';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { randomBytes } from 'crypto';

export interface WorkerConfig {
  leaseTtlMs: number;
  heartbeatIntervalMs: number;
  pollIntervalMs: number;
}

export class Worker {
  private readonly jobsRepo: JobsRepository;
  private readonly artifactsRepo: ArtifactsRepository;
  private readonly eventsRepo: EventsRepository;
  private readonly workerId: string;
  private running: boolean = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    db: Database,
    private readonly artifacts: ArtifactsService,
    private readonly executor: Executor,
    private readonly config: WorkerConfig,
    private readonly logger: Logger
  ) {
    this.jobsRepo = new JobsRepository(db);
    this.artifactsRepo = new ArtifactsRepository(db);
    this.eventsRepo = new EventsRepository(db);
    this.workerId = `worker-${randomBytes(4).toString('hex')}`;
  }

  async start(): Promise<void> {
    this.running = true;
    this.logger.info({ workerId: this.workerId }, 'Worker started');

    while (this.running) {
      try {
        await this.processNext();
      } catch (error) {
        this.logger.error({ error }, 'Worker error');
      }

      // Wait before polling again
      await this.sleep(this.config.pollIntervalMs);
    }
  }

  stop(): void {
    this.running = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.logger.info({ workerId: this.workerId }, 'Worker stopped');
  }

  private async processNext(): Promise<void> {
    // Try to acquire a job
    const leaseResult = this.jobsRepo.acquireLease({
      owner: asLeaseOwner(this.workerId),
      leaseTtlMs: this.config.leaseTtlMs,
    });

    if (!leaseResult.ok) {
      this.logger.error({ error: leaseResult.error }, 'Failed to acquire lease');
      return;
    }

    const jobId = leaseResult.value;
    if (!jobId) {
      // No jobs available
      return;
    }

    this.logger.info({ jobId, workerId: this.workerId }, 'Processing job');

    // Start heartbeat
    this.startHeartbeat(jobId);

    try {
      await this.executeJob(jobId);
    } finally {
      this.stopHeartbeat();

      // Release lease
      const releaseResult = this.jobsRepo.releaseLease(jobId, asLeaseOwner(this.workerId));
      if (!releaseResult.ok) {
        this.logger.warn({ jobId, error: releaseResult.error }, 'Failed to release lease');
      }
    }
  }

  private async executeJob(jobId: JobId): Promise<void> {
    // Get job details
    const jobResult = this.jobsRepo.getById(jobId);
    if (!jobResult.ok) {
      this.logger.error({ jobId, error: jobResult.error }, 'Failed to get job');
      return;
    }

    const job = jobResult.value;
    const spec = job.spec;

    // Create isolated work directory
    const workDir = join(tmpdir(), `jobhub-${jobId}`);
    await mkdir(workDir, { recursive: true });

    try {
      // Clone/prepare repository
      if (spec.repo.type === 'git' && spec.repo.url) {
        await this.prepareGitRepo(workDir, spec.repo.url, spec.repo.baselineCommit);
      } else if (spec.repo.type === 'local' && spec.repo.path) {
        // For local repos, we could copy or work in place
        // For now, log a warning
        this.logger.warn({ jobId }, 'Local repo execution not fully implemented');
      }

      // Execute with timeout
      const timeoutMs = spec.execution.timeoutS ? spec.execution.timeoutS * 1000 : 300000; // 5min default

      const execResult = await this.executor.execute(spec, { workDir, timeoutMs });

      if (!execResult.ok) {
        await this.handleFailure(jobId, 'EXECUTOR_ERROR', execResult.error);
        return;
      }

      const output = execResult.value;

      // Write artifacts
      await this.artifacts.ensureJobDirectory(jobId);

      const patchResult = await this.artifacts.write(jobId, 'patch.diff', output.diff);
      if (patchResult.ok) {
        this.artifactsRepo.create({
          jobId,
          kind: 'patch.diff',
          uri: this.artifacts.getURI(jobId, 'patch.diff'),
          digest: patchResult.value.digest,
          size: patchResult.value.size,
        });
      }

      const outResult = await this.artifacts.write(jobId, 'out.md',
        `# Test Plan\n\n${output.testPlan}\n\n# Notes\n\n${output.notes}`
      );
      if (outResult.ok) {
        this.artifactsRepo.create({
          jobId,
          kind: 'out.md',
          uri: this.artifacts.getURI(jobId, 'out.md'),
          digest: outResult.value.digest,
          size: outResult.value.size,
        });
      }

      const logsResult = await this.artifacts.write(jobId, 'logs.txt', output.rawOutput);
      if (logsResult.ok) {
        this.artifactsRepo.create({
          jobId,
          kind: 'logs.txt',
          uri: this.artifacts.getURI(jobId, 'logs.txt'),
          digest: logsResult.value.digest,
          size: logsResult.value.size,
        });
      }

      // Validate patch applies cleanly
      const validationResult = await this.validatePatch(workDir, output.diff, spec.repo.baselineCommit);

      if (!validationResult) {
        await this.handleFailure(jobId, 'CONFLICT', 'Patch does not apply cleanly');
        return;
      }

      // Mark as succeeded
      this.jobsRepo.updateState({
        id: jobId,
        state: 'SUCCEEDED',
        summary: `Completed successfully with ${output.diff.split('\n').length} line diff`,
      });

      this.eventsRepo.create({
        jobId,
        type: 'job.succeeded',
        payload: {
          executor: this.executor.name,
          artifactCount: 3,
          timestamp: Date.now(),
        },
      });

      this.logger.info({ jobId }, 'Job completed successfully');
    } catch (error) {
      await this.handleFailure(
        jobId,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      // Cleanup work directory
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private async prepareGitRepo(
    workDir: string,
    url: string,
    commit: string
  ): Promise<void> {
    // Clone repository
    await execa('git', ['clone', '--depth', '1', url, workDir]);

    // Checkout specific commit
    await execa('git', ['fetch', 'origin', commit], { cwd: workDir });
    await execa('git', ['checkout', commit], { cwd: workDir });
  }

  private async validatePatch(
    workDir: string,
    patch: string,
    _baselineCommit: string
  ): Promise<boolean> {
    try {
      // Write patch to file
      const patchPath = join(workDir, 'temp.patch');
      await writeFile(patchPath, patch, 'utf-8');

      // Try to apply with --check
      const result = await execa('git', ['apply', '--check', patchPath], {
        cwd: workDir,
        reject: false,
      });

      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private async handleFailure(
    jobId: JobId,
    reasonCode: 'BAD_ARTIFACTS' | 'CONFLICT' | 'POLICY' | 'EXECUTOR_ERROR' | 'INTERNAL_ERROR',
    message: string
  ): Promise<void> {
    this.jobsRepo.updateState({
      id: jobId,
      state: 'FAILED',
      reasonCode,
      summary: message,
    });

    this.eventsRepo.create({
      jobId,
      type: 'job.failed',
      payload: {
        reasonCode,
        message,
        timestamp: Date.now(),
      },
    });

    this.logger.warn({ jobId, reasonCode, message }, 'Job failed');
  }

  private startHeartbeat(jobId: JobId): void {
    this.heartbeatTimer = setInterval(() => {
      const result = this.jobsRepo.renewLease(
        jobId,
        asLeaseOwner(this.workerId),
        this.config.leaseTtlMs
      );

      if (!result.ok || !result.value) {
        this.logger.warn({ jobId }, 'Failed to renew lease');
        this.stop(); // Stop worker if can't renew
      }
    }, this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
