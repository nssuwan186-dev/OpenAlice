import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface DatabaseConfig {
  path: string;
  verbose?: boolean;
}

export class DatabaseManager {
  private db: Database.Database | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = {
      path: config.path || './data/db/hotel.sqlite',
      verbose: config.verbose || false,
      ...config,
    };
  }

  async connect(): Promise<void> {
    const dir = join(this.config.path, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.config.path);
    this.db.pragma('foreign_keys = ON');
  }

  async initialize(schemaPath: string): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.exec(schema);
  }

  prepare(sql: string) {
    if (!this.db) throw new Error('Database not connected');
    return this.db.prepare(sql);
  }

  execute(sql: string, params?: Record<string, unknown>): any {
    if (!this.db) throw new Error('Database not connected');
    return this.db.prepare(sql).run(params || {});
  }

  query(sql: string, params?: Record<string, unknown>): any[] {
    if (!this.db) throw new Error('Database not connected');
    return this.db.prepare(sql).all(params || {});
  }

  queryOne(sql: string, params?: Record<string, unknown>): any {
    if (!this.db) throw new Error('Database not connected');
    return this.db.prepare(sql).get(params || {});
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
