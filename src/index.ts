#!/usr/bin/env node
import { startTaskRelayServer } from './server.js';

const webUiFlag = process.env['ENABLE_WEB_UI'];
const shouldStartWebUi = webUiFlag ? webUiFlag !== 'false' : false;

startTaskRelayServer({ askAnswer: true, webUi: shouldStartWebUi }).catch((error) => {
  console.error('Unhandled error starting Task Relay:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
