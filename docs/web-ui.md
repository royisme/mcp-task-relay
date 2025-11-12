# Web UI

Real-time monitoring dashboard with Server-Sent Events.

## Features

- 📊 Live statistics (queued, running, succeeded, failed)
- 📋 Job list with real-time updates
- 🔄 Server-Sent Events (SSE) push notifications
- 🎨 Tailwind CSS responsive design

## Access

```bash
MCP_MODE=false bun run dev
```

Open http://localhost:3000

## Configuration

```env
WEB_UI_PORT=3000
ENABLE_WEB_UI=true
```

## Screenshots

Dashboard displays:
- Total jobs count
- Jobs by state (color-coded)
- Recent jobs list
- Last update timestamps
