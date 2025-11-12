/**
 * SQLite database connection with WAL mode
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DbConnection {
  db: DatabaseType;
  close: () => void;
}

export function createConnection(dbPath: string): DbConnection {
  const db = new Database(dbPath, {
    verbose: process.env['NODE_ENV'] === 'development' ? console.log : undefined,
  });

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  // Other performance optimizations
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 30000000000'); // 30GB mmap

  // Foreign key constraints
  db.pragma('foreign_keys = ON');

  return {
    db,
    close: () => db.close(),
  };
}

export function runMigrations(db: DatabaseType): void {
  const migrationsDir = join(__dirname, '../../migrations');

  // Check current version
  let currentVersion = 0;
  try {
    const result = db.prepare('SELECT MAX(version) as version FROM schema_version').get() as { version: number | null };
    currentVersion = result.version ?? 0;
  } catch {
    // Table doesn't exist yet
  }

  // Migration files
  const migrations = [
    { version: 1, file: '001_initial_schema.sql' },
  ];

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      console.log(`Running migration ${migration.version}: ${migration.file}`);
      const sql = readFileSync(join(migrationsDir, migration.file), 'utf-8');
      db.exec(sql);
      console.log(`Migration ${migration.version} completed`);
    }
  }
}
