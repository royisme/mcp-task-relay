/**
 * Web UI Server - Dashboard for job monitoring
 * Uses Server-Sent Events (SSE) for real-time updates
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { Logger } from 'pino';
import type { JobManager } from '../core/job-manager.js';
import type { Notifier } from './notifier.js';

export class WebUIServer {
  private sseClients: Set<ServerResponse> = new Set();

  constructor(
    private readonly jobManager: JobManager,
    private readonly notifier: Notifier,
    private readonly logger: Logger,
    private readonly port: number = 3000
  ) {
    // Listen to notifications
    this.notifier.addListener((notification) => {
      this.broadcastSSE(notification);
    });
  }

  start(): void {
    const server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    server.listen(this.port, () => {
      this.logger.info({ port: this.port }, 'Web UI server started');
      this.logger.info(`Open http://localhost:${this.port} in your browser`);
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    if (url === '/' || url === '/index.html') {
      this.serveHTML(res);
    } else if (url === '/api/jobs') {
      this.serveJobs(res);
    } else if (url.startsWith('/api/jobs/')) {
      const jobId = url.split('/')[3];
      if (jobId) {
        this.serveJob(jobId, res);
      }
    } else if (url === '/events') {
      this.serveSSE(req, res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  }

  private serveHTML(res: ServerResponse): void {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JobHub Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50">
  <div class="min-h-screen">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <h1 class="text-3xl font-bold text-gray-900">JobHub Dashboard</h1>
        <p class="text-sm text-gray-500 mt-1">Real-time job execution monitoring</p>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">
        <!-- Stats -->
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">Total Jobs</dt>
              <dd class="mt-1 text-3xl font-semibold text-gray-900" id="stat-total">0</dd>
            </div>
          </div>
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">Running</dt>
              <dd class="mt-1 text-3xl font-semibold text-blue-600" id="stat-running">0</dd>
            </div>
          </div>
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">Succeeded</dt>
              <dd class="mt-1 text-3xl font-semibold text-green-600" id="stat-succeeded">0</dd>
            </div>
          </div>
          <div class="bg-white overflow-hidden shadow rounded-lg">
            <div class="px-4 py-5 sm:p-6">
              <dt class="text-sm font-medium text-gray-500 truncate">Failed</dt>
              <dd class="mt-1 text-3xl font-semibold text-red-600" id="stat-failed">0</dd>
            </div>
          </div>
        </div>

        <!-- Job List -->
        <div class="bg-white shadow overflow-hidden sm:rounded-lg">
          <div class="px-4 py-5 sm:px-6 flex justify-between items-center">
            <h2 class="text-lg leading-6 font-medium text-gray-900">Recent Jobs</h2>
            <button onclick="refreshJobs()" class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
              Refresh
            </button>
          </div>
          <div class="border-t border-gray-200">
            <ul id="job-list" class="divide-y divide-gray-200">
              <!-- Jobs will be inserted here -->
            </ul>
          </div>
        </div>
      </div>
    </main>
  </div>

  <script>
    let eventSource;

    function formatDate(timestamp) {
      return new Date(timestamp).toLocaleString();
    }

    function getStateClass(state) {
      const classes = {
        'QUEUED': 'bg-gray-100 text-gray-800',
        'RUNNING': 'bg-blue-100 text-blue-800',
        'SUCCEEDED': 'bg-green-100 text-green-800',
        'FAILED': 'bg-red-100 text-red-800',
        'CANCELED': 'bg-yellow-100 text-yellow-800',
        'EXPIRED': 'bg-orange-100 text-orange-800',
      };
      return classes[state] || 'bg-gray-100 text-gray-800';
    }

    function renderJob(job) {
      return \`
        <li class="px-4 py-4 hover:bg-gray-50">
          <div class="flex items-center justify-between">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full \${getStateClass(job.state)}">
                  \${job.state}
                </span>
                <p class="text-sm font-medium text-gray-900 truncate">\${job.id}</p>
              </div>
              <p class="mt-1 text-sm text-gray-500">\${job.summary || 'No summary available'}</p>
              <p class="mt-1 text-xs text-gray-400">Last updated: \${formatDate(job.lastUpdate)}</p>
            </div>
          </div>
        </li>
      \`;
    }

    function updateStats(jobs) {
      const total = jobs.length;
      const running = jobs.filter(j => j.state === 'RUNNING').length;
      const succeeded = jobs.filter(j => j.state === 'SUCCEEDED').length;
      const failed = jobs.filter(j => j.state === 'FAILED').length;

      document.getElementById('stat-total').textContent = total;
      document.getElementById('stat-running').textContent = running;
      document.getElementById('stat-succeeded').textContent = succeeded;
      document.getElementById('stat-failed').textContent = failed;
    }

    async function refreshJobs() {
      try {
        const response = await fetch('/api/jobs');
        const data = await response.json();
        const jobList = document.getElementById('job-list');

        jobList.innerHTML = data.items.map(renderJob).join('');
        updateStats(data.items);
      } catch (error) {
        console.error('Failed to fetch jobs:', error);
      }
    }

    function connectSSE() {
      eventSource = new EventSource('/events');

      eventSource.onmessage = (event) => {
        console.log('SSE event:', event.data);
        refreshJobs();
      };

      eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        eventSource.close();
        setTimeout(connectSSE, 5000);
      };
    }

    // Initial load
    refreshJobs();
    connectSSE();

    // Auto refresh every 30 seconds
    setInterval(refreshJobs, 30000);
  </script>
</body>
</html>
`;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  private serveJobs(res: ServerResponse): void {
    const result = this.jobManager.list(undefined, 50, 0);
    if (!result.ok) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.value));
  }

  private serveJob(jobId: string, res: ServerResponse): void {
    try {
      const result = this.jobManager.get(jobId as never);
      if (!result.ok) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.value));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid job ID' }));
    }
  }

  private serveSSE(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    this.sseClients.add(res);

    // Send initial connection message
    res.write('data: {"type":"connected"}\n\n');

    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  private broadcastSSE(data: unknown): void {
    const message = `data: ${JSON.stringify(data)}\n\n`;

    for (const client of this.sseClients) {
      try {
        client.write(message);
      } catch (error) {
        this.logger.warn({ error }, 'Failed to send SSE message');
        this.sseClients.delete(client);
      }
    }
  }
}
