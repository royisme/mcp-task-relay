/**
 * Job Manager - Core business logic for job lifecycle
 */

import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import {
  JobsRepository,
  EventsRepository,
  AsksRepository,
  AnswersRepository,
  DecisionCacheRepository,
  type CreateAskParams,
  type CreateAnswerParams,
} from '../db/index.js';
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
import {
  asJobId,
  type JobId,
  type AskPayload,
  type AskRecord,
  type AskStatus,
  type AnswerPayload,
  type AnswerRecord,
  AnswerStatusSchema,
  AskPayloadSchema,
  AnswerPayloadSchema,
  type DecisionCacheRecord,
} from '../models/index.js';
import { Result, Ok, Err } from '../models/index.js';
import { isTerminalState } from '../models/index.js';
import { generateJobId } from '../utils/index.js';
import { EventEmitter } from 'events';

type JobManagerEventMap = {
  'ask.created': { ask: AskRecord };
  'answer.recorded': { answer: AnswerRecord };
  'job.state': {
    jobId: JobId;
    state: JobState;
    stateVersion: number;
    summary?: string | null;
  };
};

export class JobManager {
  private readonly jobsRepo: JobsRepository;

  private readonly eventsRepo: EventsRepository;

  private readonly asksRepo: AsksRepository;

  private readonly answersRepo: AnswersRepository;

  private readonly decisionCacheRepo: DecisionCacheRepository;

  private readonly eventBus = new EventEmitter();

  constructor(
    db: Database,
    _artifacts: ArtifactsService,
    private readonly logger: Logger
  ) {
    this.jobsRepo = new JobsRepository(db);

    this.eventsRepo = new EventsRepository(db);

    this.asksRepo = new AsksRepository(db);

    this.answersRepo = new AnswersRepository(db);

    this.decisionCacheRepo = new DecisionCacheRepository(db);
  }

  on<K extends keyof JobManagerEventMap>(
    event: K,
    listener: (payload: JobManagerEventMap[K]) => void
  ): void {
    this.eventBus.on(event, listener);
  }

  off<K extends keyof JobManagerEventMap>(
    event: K,
    listener: (payload: JobManagerEventMap[K]) => void
  ): void {
    this.eventBus.off(event, listener);
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

  createAsk(payload: AskPayload): Result<AskRecord, string> {
    const parsed = AskPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return Err(`Invalid Ask payload: ${parsed.error.message}`);
    }

    const ask = parsed.data;
    const jobId = asJobId(ask.job_id);

    const jobResult = this.jobsRepo.getById(jobId);
    if (!jobResult.ok) {
      return jobResult;
    }

    if (jobResult.value.state !== 'RUNNING') {
      return Err(`Cannot create Ask while job is in state ${jobResult.value.state}`);
    }

    const askParams: CreateAskParams = {
      askId: ask.ask_id,
      jobId: ask.job_id,
      stepId: ask.step_id,
      askType: ask.ask_type,
      prompt: ask.prompt,
      contextHash: ask.context_hash,
      contextEnvelope: ask.context_envelope,
    };

    if (ask.constraints !== undefined) {
      askParams.constraints = ask.constraints;
    }
    if (ask.role_id !== undefined) {
      askParams.roleId = ask.role_id;
    }
    if (ask.meta !== undefined) {
      askParams.meta = ask.meta;
    }

    const createResult = this.asksRepo.create(askParams);

    if (!createResult.ok) {
      return createResult;
    }

    const stateResult = this.updateState(jobId, 'WAITING_ON_ANSWER');
    if (!stateResult.ok) {
      return stateResult;
    }

    const eventResult = this.eventsRepo.create({
      jobId,
      type: 'ask.created',
      payload: {
        askId: ask.ask_id,
        stepId: ask.step_id,
        askType: ask.ask_type,
        createdAt: Date.now(),
      },
    });

    if (!eventResult.ok) {
      this.logger.warn({ jobId, error: eventResult.error }, 'Failed to log ask.created event');
    }

    this.eventBus.emit('ask.created', { ask: createResult.value });

    return createResult;
  }

  getAsk(askId: string): Result<AskRecord, string> {
    return this.asksRepo.getById(askId);
  }

  listAsks(jobId: JobId): Result<AskRecord[], string> {
    return this.asksRepo.listByJob(jobId);
  }

  recordAnswer(payload: AnswerPayload): Result<AnswerRecord, string> {
    const parsed = AnswerPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return Err(`Invalid Answer payload: ${parsed.error.message}`);
    }

    const answerPayload = parsed.data;
    const jobId = asJobId(answerPayload.job_id);

    const askResult = this.asksRepo.getById(answerPayload.ask_id);
    if (!askResult.ok) {
      return askResult;
    }

    const answerParams: CreateAnswerParams = {
      askId: answerPayload.ask_id,
      jobId: answerPayload.job_id,
      stepId: answerPayload.step_id,
      status: answerPayload.status,
    };

    if (answerPayload.answer_text !== undefined) {
      answerParams.answerText = answerPayload.answer_text;
    }
    if (answerPayload.answer_json !== undefined) {
      answerParams.answerJson = answerPayload.answer_json;
    }
    if (answerPayload.attestation !== undefined) {
      answerParams.attestation = answerPayload.attestation;
    }
    if (answerPayload.artifacts !== undefined) {
      answerParams.artifacts = answerPayload.artifacts;
    }
    if (answerPayload.policy_trace !== undefined) {
      answerParams.policyTrace = answerPayload.policy_trace;
    }
    if (answerPayload.cacheable !== undefined) {
      answerParams.cacheable = answerPayload.cacheable;
    }
    if (answerPayload.ask_back !== undefined) {
      answerParams.askBack = answerPayload.ask_back;
    }
    if (answerPayload.error !== undefined) {
      answerParams.error = answerPayload.error;
    }

    const createResult = this.answersRepo.create(answerParams);

    if (!createResult.ok) {
      return createResult;
    }

    const answerStatus = AnswerStatusSchema.parse(answerPayload.status);

    const askStatus: AskStatus = answerStatus === 'ANSWERED' ? 'ANSWERED' : answerStatus;

    const updateStatusResult = this.asksRepo.updateStatus(answerPayload.ask_id, askStatus);
    if (!updateStatusResult.ok) {
      return updateStatusResult;
    }

    const eventResult = this.eventsRepo.create({
      jobId,
      type: 'answer.recorded',
      payload: {
        askId: answerPayload.ask_id,
        stepId: answerPayload.step_id,
        status: answerPayload.status,
        recordedAt: Date.now(),
      },
    });

    if (!eventResult.ok) {
      this.logger.warn({ jobId, error: eventResult.error }, 'Failed to log answer.recorded event');
    }

    this.eventBus.emit('answer.recorded', { answer: createResult.value });

    switch (answerStatus) {
      case 'ANSWERED': {
        const stateResult = this.updateState(jobId, 'RUNNING');
        if (!stateResult.ok) {
          return stateResult;
        }
        break;
      }
      case 'REJECTED': {
        const stateResult = this.updateState(jobId, 'FAILED', {
          reasonCode: 'POLICY',
          summary: answerPayload.answer_text ?? answerPayload.error ?? 'Ask rejected by scheduler',
        });
        if (!stateResult.ok) {
          return stateResult;
        }
        break;
      }
      case 'TIMEOUT': {
        const stateResult = this.updateState(jobId, 'FAILED', {
          reasonCode: 'TIMEOUT',
          summary: answerPayload.error ?? 'Ask timed out waiting for response',
        });
        if (!stateResult.ok) {
          return stateResult;
        }
        break;
      }
      case 'ERROR': {
        const stateResult = this.updateState(jobId, 'FAILED', {
          reasonCode: 'EXECUTOR_ERROR',
          summary: answerPayload.error ?? 'Ask execution failed',
        });
        if (!stateResult.ok) {
          return stateResult;
        }
        break;
      }
      default:
        break;
    }

    return createResult;
  }

  getAnswer(askId: string): Result<AnswerRecord | null, string> {
    return this.answersRepo.getByAskId(askId);
  }

  listAskHistory(
    jobId: JobId
  ): Result<Array<{ ask: AskRecord; answer?: AnswerRecord | null }>, string> {
    const asksResult = this.asksRepo.listByJob(jobId);
    if (!asksResult.ok) {
      return asksResult;
    }

    const history: Array<{ ask: AskRecord; answer?: AnswerRecord | null }> = [];
    for (const ask of asksResult.value) {
      const answerResult = this.answersRepo.getByAskId(ask.askId);
      if (!answerResult.ok) {
        return answerResult;
      }
      const entry: { ask: AskRecord; answer?: AnswerRecord | null } = { ask };
      if (answerResult.value === null) {
        entry.answer = null;
      } else if (answerResult.value !== undefined) {
        entry.answer = answerResult.value;
      }
      history.push(entry);
    }

    return Ok(history);
  }

  getDecisionCache(decisionKey: string): Result<DecisionCacheRecord | null, string> {
    return this.decisionCacheRepo.get(decisionKey);
  }

  putDecisionCache(
    params: {
      decisionKey: string;
      answerJson?: unknown;
      answerText?: string;
      policyTrace?: unknown;
      ttlSeconds: number;
    }
  ): Result<DecisionCacheRecord, string> {
    return this.decisionCacheRepo.upsert(params);
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

    const jobResult = this.jobsRepo.getById(jobId);
    if (jobResult.ok) {
      this.eventBus.emit('job.state', {
        jobId,
        state: jobResult.value.state,
        stateVersion: jobResult.value.stateVersion,
        summary: jobResult.value.summary,
      });
    } else {
      this.logger.warn({ jobId, error: jobResult.error }, 'Failed to fetch job after state update');
    }

    return Ok(undefined);
  }
}
