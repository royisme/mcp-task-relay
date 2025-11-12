/**
 * Ask/Answer HTTP server
 * Implements Phase 2 Ask/Answer protocol endpoints and SSE fan-out
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { URL } from 'url';
import type { Logger } from 'pino';
import { asJobId } from '../models/index.js';
import type { JobManager } from '../core/job-manager.js';
import type { AnswerRecord, AskPayload, AnswerPayload } from '../models/index.js';

interface AskAnswerServerConfig {
  port: number;
  longPollTimeoutMs: number;
  sseHeartbeatMs: number;
}

interface PendingAnswer {
  res: ServerResponse;
  timeout: NodeJS.Timeout;
}

interface JobClient {
  res: ServerResponse;
  heartbeat: NodeJS.Timeout;
}

export class AskAnswerServer {
  private readonly pendingAnswers = new Map<string, Set<PendingAnswer>>();

  private readonly jobClients = new Map<string, Set<JobClient>>();

  private readonly server = createServer((req, res) => this.handleRequest(req, res));

  constructor(
    private readonly jobManager: JobManager,
    private readonly logger: Logger,
    private readonly config: AskAnswerServerConfig
  ) {
    this.jobManager.on('answer.recorded', ({ answer }) => {
      this.resolvePending(answer.askId, answer);
      this.broadcastToJob(answer.jobId, 'answer', answer);
      this.broadcastToJob(answer.jobId, 'log', {
        type: 'answer.recorded',
        askId: answer.askId,
        stepId: answer.stepId,
        status: answer.status,
        recordedAt: answer.createdAt,
      });
    });

    this.jobManager.on('ask.created', ({ ask }) => {
      this.broadcastToJob(ask.jobId, 'log', {
        type: 'ask.created',
        askId: ask.askId,
        stepId: ask.stepId,
        askType: ask.askType,
        createdAt: ask.createdAt,
      });
    });

    this.jobManager.on('job.state', (event) => {
      this.broadcastToJob(event.jobId, 'status', event);
    });
  }

  start(): void {
    this.server.listen(this.config.port, () => {
      this.logger.info(
        { port: this.config.port },
        'Ask/Answer server listening'
      );
    });
  }

  stop(): void {
    for (const pending of this.pendingAnswers.values()) {
      for (const entry of pending) {
        clearTimeout(entry.timeout);
        entry.res.writeHead(503, { 'Content-Type': 'application/json' });
        entry.res.end(JSON.stringify({ error: 'Server shutting down' }));
      }
    }
    this.pendingAnswers.clear();

    for (const clients of this.jobClients.values()) {
      for (const client of clients) {
        clearInterval(client.heartbeat);
        client.res.end();
      }
    }
    this.jobClients.clear();

    this.server.close(() => {
      this.logger.info('Ask/Answer server stopped');
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (!req.url) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing URL' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'POST' && pathname === '/asks') {
      this.handleCreateAsk(req, res);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/asks/') && pathname.endsWith('/answer')) {
      const askId = pathname.split('/')[2];
      if (!askId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid ask ID' }));
        return;
      }
      this.handleAnswerLongPoll(askId, url, res, req);
      return;
    }

    if (req.method === 'POST' && pathname === '/answers') {
      this.handleRecordAnswer(req, res);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/jobs/') && pathname.endsWith('/asks')) {
      const jobId = pathname.split('/')[2];
      if (!jobId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid job ID' }));
        return;
      }
      this.handleListAsks(jobId, res);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/jobs/') && pathname.endsWith('/events')) {
      const jobId = pathname.split('/')[2];
      if (!jobId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid job ID' }));
        return;
      }
      this.handleJobSSE(jobId, req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }

  private async handleCreateAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) {
      return;
    }

    if (body === null || typeof body !== 'object') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Body must be an object' }));
      return;
    }

    const result = this.jobManager.createAsk(body as AskPayload);
    if (!result.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }

    res.writeHead(202, {
      'Content-Type': 'application/json',
      Location: `/asks/${result.value.askId}/answer`,
    });
    res.end(JSON.stringify(result.value));
  }

  private async handleRecordAnswer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readJson(req, res);
    if (body === undefined) {
      return;
    }

    if (body === null || typeof body !== 'object') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Body must be an object' }));
      return;
    }

    const result = this.jobManager.recordAnswer(body as AnswerPayload);
    if (!result.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.value));
  }

  private handleListAsks(jobId: string, res: ServerResponse): void {
    let jobBrand;
    try {
      jobBrand = asJobId(jobId);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      return;
    }

    const result = this.jobManager.listAskHistory(jobBrand);
    if (!result.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobId, asks: result.value }));
  }

  private handleAnswerLongPoll(
    askId: string,
    url: URL,
    res: ServerResponse,
    req: IncomingMessage
  ): void {
    const waitParam = url.searchParams.get('wait');
    const waitMs = this.parseWait(waitParam);

    const existing = this.jobManager.getAnswer(askId);
    if (!existing.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: existing.error }));
      return;
    }

    if (existing.value) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(existing.value));
      return;
    }

    const timeout = setTimeout(() => {
      this.removePending(askId, res);
      res.writeHead(204).end();
    }, waitMs);

    const waiters = this.pendingAnswers.get(askId) ?? new Set<PendingAnswer>();
    waiters.add({ res, timeout });
    this.pendingAnswers.set(askId, waiters);

    req.on('close', () => {
      clearTimeout(timeout);
      this.removePending(askId, res);
    });
  }

  private handleJobSSE(jobId: string, req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    res.write('event: connected\n');
    res.write('data: {}\n\n');

    const heartbeat = setInterval(() => {
      this.sendEvent(res, 'heartbeat', { ts: Date.now() });
    }, this.config.sseHeartbeatMs);

    const clients = this.jobClients.get(jobId) ?? new Set<JobClient>();
    clients.add({ res, heartbeat });
    this.jobClients.set(jobId, clients);

    req.on('close', () => {
      clearInterval(heartbeat);
      this.removeJobClient(jobId, res);
    });
  }

  private parseWait(waitParam: string | null): number {
    if (!waitParam) {
      return this.config.longPollTimeoutMs;
    }

    const trimmed = waitParam.trim();
    if (trimmed.endsWith('s')) {
      const seconds = Number.parseInt(trimmed.slice(0, -1), 10);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, this.config.longPollTimeoutMs);
      }
    }

    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(numeric) && numeric > 0) {
      return Math.min(numeric * 1000, this.config.longPollTimeoutMs);
    }

    return this.config.longPollTimeoutMs;
  }

  private async readJson(req: IncomingMessage, res: ServerResponse): Promise<unknown | undefined> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }

    try {
      const body = Buffer.concat(chunks).toString('utf-8');
      if (!body) {
        return {};
      }
      return JSON.parse(body) as unknown;
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      return undefined;
    }
  }

  private resolvePending(askId: string, answer: AnswerRecord): void {
    const waiters = this.pendingAnswers.get(askId);
    if (!waiters) {
      return;
    }

    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.res.writeHead(200, { 'Content-Type': 'application/json' });
      waiter.res.end(JSON.stringify(answer));
    }

    this.pendingAnswers.delete(askId);
  }

  private removePending(askId: string, res: ServerResponse): void {
    const waiters = this.pendingAnswers.get(askId);
    if (!waiters) {
      return;
    }

    for (const waiter of waiters) {
      if (waiter.res === res) {
        waiters.delete(waiter);
        break;
      }
    }

    if (waiters.size === 0) {
      this.pendingAnswers.delete(askId);
    }
  }

  private broadcastToJob(jobId: string, event: string, payload: unknown): void {
    const clients = this.jobClients.get(jobId);
    if (!clients) {
      return;
    }

    for (const client of clients) {
      this.sendEvent(client.res, event, payload);
    }
  }

  private sendEvent(res: ServerResponse, event: string, payload: unknown): void {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      this.logger.warn({ error }, 'Failed to send SSE event');
    }
  }

  private removeJobClient(jobId: string, res: ServerResponse): void {
    const clients = this.jobClients.get(jobId);
    if (!clients) {
      return;
    }

    for (const client of clients) {
      if (client.res === res) {
        clearInterval(client.heartbeat);
        clients.delete(client);
      }
    }

    if (clients.size === 0) {
      this.jobClients.delete(jobId);
    }
  }
}
