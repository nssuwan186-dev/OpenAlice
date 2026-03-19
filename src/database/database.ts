import Database from 'better-sqlite3';

export class DatabaseManager {
  private db: Database.Database;

  constructor(path: string = './data/db/hotel.sqlite') {
    this.db = new Database(path);
    console.log('✅ Database connected: ' + path);
  }

  query(sql: string) {
    return this.db.prepare(sql).all();
  }

  close() {
    this.db.close();
  }
}
