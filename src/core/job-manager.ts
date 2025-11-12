/**
 * Job Manager - Core business logic for job lifecycle
 */

import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import { JobsRepository, EventsRepository } from '../db/index.js';
import { ArtifactsService } from '../services/artifacts.js';
import type {
  JobSpec,

  JobState,
  FailReason,
  JobStatus,
  SubmitResponse,
  GetResponse,
  ListResponse,
  CancelResponse,
} from '../models/index.js';
import { asJobId, type JobId } from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';
import { isTerminalState } from '../models/index.js';
import { generateJobId } from '../utils/index.js';

export class JobManager {
  private readonly jobsRepo: JobsRepository;

  private readonly eventsRepo: EventsRepository;

  constructor(
    db: Database,
    _artifacts: ArtifactsService,
    private readonly logger: Logger
  ) {
    this.jobsRepo = new JobsRepository(db);
    
    this.eventsRepo = new EventsRepository(db);
  }

  async submit(spec: JobSpec): Promise<Result<SubmitResponse, string>> {
    try {
      // Check for existing job with same idempotency key
      const existingResult = this.jobsRepo.getByIdempotencyKey(spec.idempotencyKey);
      if (!existingResult.ok) {
        return existingResult;
      }

      if (existingResult.value) {
        const existing = existingResult.value;
        // If not in terminal state, return existing job
        if (!isTerminalState(existing.state)) {
          this.logger.info({ jobId: existing.id }, 'Returning existing job (idempotent)');
          return Ok({ jobId: existing.id });
        }
      }

      // Create new job
      const jobId = asJobId(generateJobId());
      const createResult = this.jobsRepo.create({
        id: jobId,
        spec,
        priority: spec.execution.priority,
        ttlS: spec.execution.ttlS,
      });

      if (!createResult.ok) {
        return createResult;
      }

      // Log event
      const eventResult = this.eventsRepo.create({
        jobId,
        type: 'job.submitted',
        payload: {
          idempotencyKey: spec.idempotencyKey,
          priority: spec.execution.priority,
        },
      });

      if (!eventResult.ok) {
        this.logger.warn({ jobId, error: eventResult.error }, 'Failed to log event');
      }

      this.logger.info({ jobId, priority: spec.execution.priority }, 'Job submitted');

      return Ok({ jobId });
    } catch (error) {
      return Err(
        `Failed to submit job: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  get(jobId: JobId): Result<GetResponse, string> {
    const result = this.jobsRepo.getById(jobId);
    if (!result.ok) {
      return result;
    }

    const job = result.value;

    return Ok({
      id: job.id,
      state: job.state,
      summary: job.summary,
      lastUpdate: job.finishedAt ?? job.startedAt ?? job.createdAt,
      attempt: 0, // TODO: track attempts
      pr: undefined, // TODO: add PR support
    });
  }

  list(
    state?: JobState,
    limit: number = 20,
    offset: number = 0
  ): Result<ListResponse, string> {
    const filters = state !== undefined ? { state, limit, offset } : { limit, offset };
    const listResult = this.jobsRepo.list(filters);
    if (!listResult.ok) {
      return listResult;
    }

    const jobs = listResult.value;
    const total = this.jobsRepo.count(state);

    const items = jobs.map((job) => ({
      id: job.id,
      state: job.state,
      summary: job.summary,
      lastUpdate: job.finishedAt ?? job.startedAt ?? job.createdAt,
      attempt: 0,
      pr: undefined,
    }));

    return Ok({
      items,
      total,
      hasMore: offset + limit < total,
    });
  }

  cancel(jobId: JobId): Result<CancelResponse, string> {
    const jobResult = this.jobsRepo.getById(jobId);
    if (!jobResult.ok) {
      return jobResult;
    }

    const job = jobResult.value;

    if (isTerminalState(job.state)) {
      return Ok({ ok: false, state: job.state });
    }

    const updateResult = this.jobsRepo.updateState({
      id: jobId,
      state: 'CANCELED',
      summary: 'Canceled by user',
    });

    if (!updateResult.ok) {
      return updateResult;
    }

    // Log event
    const eventResult = this.eventsRepo.create({
      jobId,
      type: 'job.canceled',
      payload: { canceledAt: Date.now() },
    });

    if (!eventResult.ok) {
      this.logger.warn({ jobId, error: eventResult.error }, 'Failed to log event');
    }

    this.logger.info({ jobId }, 'Job canceled');

    return Ok({ ok: true, state: 'CANCELED' });
  }

  getStatus(jobId: JobId): Result<JobStatus, string> {
    const result = this.jobsRepo.getById(jobId);
    if (!result.ok) {
      return result;
    }

    const job = result.value;

    const status: JobStatus = {
      state: job.state,
      stateVersion: job.stateVersion,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? undefined,
      finishedAt: job.finishedAt ?? undefined,
      durationMs:
        job.startedAt && job.finishedAt
          ? job.finishedAt - job.startedAt
          : undefined,
      attempt: 0,
      reasonCode: job.reasonCode ?? undefined,
    };

    return Ok(status);
  }

  updateState(
    jobId: JobId,
    state: JobState,
    options?: { reasonCode?: FailReason; summary?: string }
  ): Result<void, string> {
    const params: { id: JobId; state: JobState; reasonCode?: FailReason; summary?: string } = {
      id: jobId,
      state,
    };
    if (options?.reasonCode !== undefined) {
      params.reasonCode = options.reasonCode;
    }
    if (options?.summary !== undefined) {
      params.summary = options.summary;
    }
    const updateResult = this.jobsRepo.updateState(params);

    if (!updateResult.ok) {
      return updateResult;
    }

    // Log event
    const eventResult = this.eventsRepo.create({
      jobId,
      type: `job.state.${state.toLowerCase()}`,
      payload: {
        state,
        reasonCode: options?.reasonCode,
        timestamp: Date.now(),
      },
    });

    if (!eventResult.ok) {
      this.logger.warn({ jobId, error: eventResult.error }, 'Failed to log event');
    }

    this.logger.info({ jobId, state, reasonCode: options?.reasonCode }, 'Job state updated');

    return Ok(undefined);
  }
}
