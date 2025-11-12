#!/usr/bin/env node
/**
 * Migration runner script
 */

import { createConnection, runMigrations } from './connection.js';

const dbPath = process.env['DB_PATH'] || './jobhub.db';

console.log(`Running migrations on database: ${dbPath}`);

const { db, close } = createConnection(dbPath);

try {
  runMigrations(db);
  console.log('Migrations completed successfully');
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
} finally {
  close();
}
