#!/bin/bash
# ================================================
# 🚀 MASTER SETUP SCRIPT - Hotel AI System
# ================================================
# This script is modified to run in the current workspace.
# ================================================

set -e

echo "╔════════════════════════════════════════════════╗"
echo "║  🚀 Hotel AI System - Master Setup             ║"
echo "║  Creating everything automatically...         ║"
echo "╚════════════════════════════════════════════════╝"

# ====== STEP 1: Setup Directory ======
echo ""
echo "📁 Step 1: Creating directories in the current workspace..."

mkdir -p src/{core,database/repositories,database/__tests__,services,extensions,agent,api}
mkdir -p data/{config,brain,operations,conversations,db}
mkdir -p scripts

echo "✅ Directories created"

# ====== STEP 2: Create package.json ======
echo ""
echo "📝 Step 2: Creating package.json..."
cat > package.json << 'PACKAGE_EOF'
{
  "name": "hotel-ai-system",
  "version": "1.0.0",
  "description": "AI-powered Hotel Management System on Termux",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "lint": "tsc --noEmit"
  },
  "keywords": ["hotel", "ai", "termux"],
  "author": "Hotel AI",
  "license": "MIT",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "better-sqlite3": "^9.2.0",
    "dotenv": "^16.4.1"
  },
  "devDependencies": {
    "@jest/globals": "^29.7.0",
    "@types/better-sqlite3": "^7.6.8",
    "@types/jest": "^29.5.11",
    "@types/node": "^20.10.6",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
PACKAGE_EOF
echo "✅ package.json created"

# ====== STEP 3: Install Dependencies ======
echo ""
echo "📦 Step 3: Installing dependencies..."
npm install > /dev/null 2>&1
echo "✅ Dependencies installed"

# ====== STEP 4: Create tsconfig.json ======
echo ""
echo "⚙️ Step 4: Creating tsconfig.json..."
cat > tsconfig.json << 'TSCONFIG_EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "lib": ["ES2020"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
TSCONFIG_EOF
echo "✅ tsconfig.json created"

# ====== STEP 5: Create jest.config.js ======
echo ""
echo "⚙️ Step 5: Creating jest.config.js..."
cat > jest.config.js << 'JEST_EOF'
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  verbose: true
};
JEST_EOF
echo "✅ jest.config.js created"

# ====== STEP 6: Create .env ======
echo ""
echo "📝 Step 6: Creating .env..."
cat > .env << 'ENV_EOF'
ANTHROPIC_API_KEY=sk-ant-YOUR_API_KEY_HERE
DB_PATH=./data/db/hotel.sqlite
HOTEL_NAME=โรงแรมดอกบัวสวย
HOTEL_ID=1
NODE_ENV=development
DEBUG=true
TIMEZONE=Asia/Bangkok
ENV_EOF

cat > .env.example << 'ENV_EOF'
ANTHROPIC_API_KEY=sk-ant-YOUR_API_KEY_HERE
DB_PATH=./data/db/hotel.sqlite
HOTEL_NAME=โรงแรมดอกบัวสวย
HOTEL_ID=1
NODE_ENV=development
DEBUG=true
TIMEZONE=Asia/Bangkok
ENV_EOF
echo "✅ .env created (EDIT THIS with your API key!)"

# ====== STEP 7: Create AI Provider ======
echo ""
echo "🧠 Step 7: Creating AI Provider..."
cat > src/core/ai-provider.ts << 'AI_PROVIDER_EOF'
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';

interface AIProviderConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

interface ThinkingResult {
  thinking: string;
  response: string;
}

export class AIProvider {
  private client: Anthropic;
  private config: AIProviderConfig;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private conversationDir = './data/conversations';

  constructor(config: AIProviderConfig = {}) {
    this.config = {
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      model: config.model || 'claude-opus-4-20250805',
      maxTokens: config.maxTokens || 2048,
    };

    if (!this.config.apiKey) {
      throw new Error('❌ ANTHROPIC_API_KEY not found!');
    }

    this.client = new Anthropic({ apiKey: this.config.apiKey });

    if (!existsSync(this.conversationDir)) {
      mkdirSync(this.conversationDir, { recursive: true });
    }

    console.log('✅ Claude AI initialized');
  }

  async think(userMessage: string, context: Record<string, unknown> = {}): Promise<ThinkingResult> {
    this.conversationHistory.push({ role: 'user', content: userMessage });

    try {
      const response = await this.client.messages.create({
        model: this.config.model!,
        max_tokens: this.config.maxTokens!,
        system: this.buildSystemPrompt(context),
        messages: this.conversationHistory as Parameters<typeof this.client.messages.create>[0]['messages'],
      });

      let responseContent = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          responseContent = block.text;
        }
      }

      this.conversationHistory.push({ role: 'assistant', content: responseContent });
      this.saveConversation(userMessage, responseContent);

      return { thinking: '', response: responseContent };
    } catch (error) {
      console.error('❌ Claude Error:', error);
      throw error;
    }
  }

  async query(userMessage: string, context: Record<string, unknown> = {}): Promise<string> {
    const result = await this.think(userMessage, context);
    return result.response;
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  private buildSystemPrompt(context: Record<string, unknown>): string {
    return `
คุณคือ Alice - ผู้ช่วย AIสำหรับจัดการโรงแรม

## ตัวตน
- ชื่อ: Alice
- บทบาท: Co-worker ฉลาด
- ภาษา: ไทย

## ความรู้
${JSON.stringify(context, null, 2)}

## สิ่งที่ทำได้
- ดูข้อมูลการจอง ลูกค้า รายรับ รายจ่าย ห้องพัก
- เพิ่มข้อมูลใหม่ (ตามสิทธิ์)
- แก้ไขข้อมูล (ตามสิทธิ์)
- สร้างรายงาน
- ตอบคำถาม

## ที่ห้าม ❌
- แก้เลขบัตร เบอร์ โทร ลูกค้า
- ลบข้อมูลสำคัญโดยไม่ถาม
- แก้วันที่ประวัติ
- แก้จำนวนเงิน โดยไม่ยืนยัน

เมื่อไม่แน่ใจ → ถามอีกที 🤖
    `;
  }

  private saveConversation(question: string, answer: string): void {
    try {
      const today = new Date().toISOString().split('T')[0];
      const timestamp = new Date().toISOString();
      const logEntry = { timestamp, question, answer };
      const logPath = join(this.conversationDir, `${today}.jsonl`);
      appendFileSync(logPath, JSON.stringify(logEntry) + '
');
    } catch (error) {
      console.error('Failed to save conversation');
    }
  }
}
AI_PROVIDER_EOF
echo "✅ AI Provider created"

# ====== STEP 8: Create Database Manager ======
echo ""
echo "🗄️ Step 8: Creating Database Manager..."
cat > src/database/database.ts << 'DATABASE_EOF'
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface DatabaseConfig {
  path: string;
  verbose?: boolean;
}

export class DatabaseManager {
  private db: Database.Database | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = { path: config.path || './data/db/hotel.sqlite', ...config };
  }

  async connect(): Promise<void> {
    try {
      const dir = join(this.config.path, '..');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      this.db = new Database(this.config.path);
      this.db.pragma('foreign_keys = ON');
      console.log('✅ Database connected');
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  async initialize(): Promise<void> {
    if (!this.db) throw new Error('Database not connected');
    console.log('📦 Initializing schema...');

    const schema = `
      CREATE TABLE IF NOT EXISTS โรงแรม (
        ไอดี INTEGER PRIMARY KEY AUTOINCREMENT,
        ชื่อโรงแรม TEXT NOT NULL UNIQUE,
        ที่อยู่ TEXT NOT NULL,
        จังหวัด TEXT NOT NULL,
        เบอร์โทรหลัก TEXT NOT NULL,
        อีเมล TEXT,
        จำนวนห้องรวม INTEGER,
        ประเภทโรงแรม TEXT,
        สกุลเงิน TEXT DEFAULT 'THB',
        สร้างที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ปรับปรุงที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ห้องพัก (
        ไอดี INTEGER PRIMARY KEY AUTOINCREMENT,
        ไอดีโรงแรม INTEGER NOT NULL,
        เลขห้อง INTEGER NOT NULL,
        ชั้น INTEGER,
        ประเภทห้อง TEXT NOT NULL,
        ความจุคน INTEGER DEFAULT 1,
        ราคาต่อคืน REAL NOT NULL,
        สถานะห้อง TEXT DEFAULT 'ว่าง',
        สถานะการใช้งาน TEXT DEFAULT 'ใช้งาน',
        สร้างที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ไอดีโรงแรม) REFERENCES โรงแรม(ไอดี),
        UNIQUE(ไอดีโรงแรม, เลขห้อง)
      );

      CREATE TABLE IF NOT EXISTS ลูกค้า (
        ไอดี INTEGER PRIMARY KEY AUTOINCREMENT,
        ชื่อ TEXT NOT NULL,
        นามสกุล TEXT,
        เบอร์โทร TEXT NOT NULL UNIQUE,
        อีเมล TEXT,
        สถานะ TEXT DEFAULT 'ปกติ',
        จำนวนครั้งมา INTEGER DEFAULT 0,
        ครั้งแรกมาที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        สร้างที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ปรับปรุงที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS การจองล่วงหน้า (
        ไอดี INTEGER PRIMARY KEY AUTOINCREMENT,
        ไอดีโรงแรม INTEGER NOT NULL,
        ไอดีลูกค้า INTEGER,
        ชื่อลูกค้า TEXT NOT NULL,
        เบอร์โทร TEXT NOT NULL,
        เลขห้อง INTEGER NOT NULL,
        ประเภทห้อง TEXT NOT NULL,
        ราคาต่อคืน REAL NOT NULL,
        วันจอง TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        วันเข้าที่คาดว่า TEXT NOT NULL,
        วันออกที่คาดว่า TEXT NOT NULL,
        จำนวนคืน INTEGER NOT NULL,
        ค่าห้องทั้งหมด REAL NOT NULL,
        ค่ามัดจำ REAL NOT NULL,
        สถานะจอง TEXT DEFAULT 'รอยืนยัน',
        บันทึก TEXT,
        สร้างที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ไอดีโรงแรม) REFERENCES โรงแรม(ไอดี),
        FOREIGN KEY(ไอดีลูกค้า) REFERENCES ลูกค้า(ไอดี)
      );

      CREATE TABLE IF NOT EXISTS บันทึกรายรับ (
        ไอดี INTEGER PRIMARY KEY AUTOINCREMENT,
        ไอดีลูกค้า INTEGER,
        วันที่ TEXT NOT NULL,
        ประเภท TEXT NOT NULL,
        รายการ TEXT NOT NULL,
        จำนวนเงิน REAL NOT NULL,
        ช่องทางชำระ TEXT NOT NULL,
        สถานะ TEXT DEFAULT 'รับแล้ว',
        สร้างที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ไอดีลูกค้า) REFERENCES ลูกค้า(ไอดี)
      );

      CREATE TABLE IF NOT EXISTS บันทึกรายจ่าย (
        ไอดี INTEGER PRIMARY KEY AUTOINCREMENT,
        ไอดีโรงแรม INTEGER NOT NULL,
        วันที่ TEXT NOT NULL,
        ประเภท TEXT NOT NULL,
        รายการ TEXT NOT NULL,
        จำนวนเงิน REAL NOT NULL,
        สถานะ TEXT DEFAULT 'รออนุมัติ',
        สร้างที่ TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(ไอดีโรงแรม) REFERENCES โรงแรม(ไอดี)
      );

      CREATE TABLE IF NOT EXISTS ยอดเงินสด (
        ไอดี INTEGER PRIMARY KEY AUTOINCREMENT,
        ไอดีโรงแรม INTEGER NOT NULL,
        วันที่ TEXT NOT NULL UNIQUE,
        ยอดเปิด REAL DEFAULT 0,
        รายรับวันนี้ REAL DEFAULT 0,
        รายจ่ายวันนี้ REAL DEFAULT 0,
        ยอดปิด REAL DEFAULT 0,
        สถานะ TEXT DEFAULT 'เปิด',
        FOREIGN KEY(ไอดีโรงแรม) REFERENCES โรงแรม(ไอดี)
      );

      CREATE INDEX IF NOT EXISTS idx_room_hotel ON ห้องพัก(ไอดีโรงแรม);
      CREATE INDEX IF NOT EXISTS idx_customer_phone ON ลูกค้า(เบอร์โทร);
      CREATE INDEX IF NOT EXISTS idx_booking_status ON การจองล่วงหน้า(สถานะจอง);
      CREATE INDEX IF NOT EXISTS idx_income_date ON บันทึกรายรับ(วันที่);
      CREATE INDEX IF NOT EXISTS idx_expense_date ON บันทึกรายจ่าย(วันที่);
    `;

    this.db.exec(schema);
    console.log('✅ Schema created');

    await this._loadInitialData();
  }

  private async _loadInitialData(): Promise<void> {
    if (!this.db) return;
    const hotelCount = this.db.prepare('SELECT COUNT(*) as count FROM โรงแรม').get() as any;
    if (hotelCount.count > 0) return;

    this.db.prepare(`
      INSERT INTO โรงแรม (ชื่อโรงแรม, ที่อยู่, จังหวัด, เบอร์โทรหลัก, จำนวนห้องรวม, ประเภทโรงแรม)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('โรงแรมดอกบัวสวย', '123 ซอย 5 ถนนราชดำเนิน', 'กรุงเทพมหานคร', '02-1234-5678', 20, 'โรงแรมดาว 3');

    for (let i = 1; i <= 4; i++) {
      for (let j = 1; j <= 5; j++) {
        const roomNum = i * 100 + j;
        const roomType = j <= 2 ? 'เตียงเดี่ยว' : j <= 4 ? 'เตียงคู่' : 'สวีท';
        const price = j <= 2 ? 600 : j <= 4 ? 800 : 1200;
        this.db.prepare(`
          INSERT INTO ห้องพัก (ไอดีโรงแรม, เลขห้อง, ชั้น, ประเภทห้อง, ความจุคน, ราคาต่อคืน)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(1, roomNum, i, roomType, j <= 2 ? 1 : j <= 4 ? 2 : 3, price);
      }
    }

    console.log('✅ Initial data loaded');
  }

  prepare(sql: string) {
    if (!this.db) throw new Error('Database not connected');
    return this.db.prepare(sql);
  }

  query(sql: string, params?: any): any[] {
    if (!this.db) throw new Error('Database not connected');
    return this.db.prepare(sql).all(params || {}) as any[];
  }

  queryOne(sql: string, params?: any): any {
    if (!this.db) throw new Error('Database not connected');
    return this.db.prepare(sql).get(params || {});
  }

  execute(sql: string, params?: any) {
    if (!this.db) throw new Error('Database not connected');
    return this.db.prepare(sql).run(params || {});
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
DATABASE_EOF
echo "✅ Database Manager created"

# ====== STEP 9: Create Repository Base Class ======
echo ""
echo "📊 Step 9: Creating Repository Base Class..."
cat > src/database/repository.ts << 'REPOSITORY_EOF'
import type { DatabaseManager } from './database';

export abstract class Repository<T> {
  protected tableName: string = '';
  protected db: DatabaseManager;

  constructor(db: DatabaseManager, tableName: string) {
    this.db = db;
    this.tableName = tableName;
  }

  async findAll(): Promise<T[]> {
    return this.db.query(`SELECT * FROM ${this.tableName}`);
  }

  async findById(id: number): Promise<T | null> {
    return this.db.queryOne(`SELECT * FROM ${this.tableName} WHERE ไอดี = ?`, { ไอดี: id }) || null;
  }

  async create(data: Partial<T>): Promise<T> {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((k) => `"${k}"`).join(', ');
    const paramPlaceholders = keys.map((_, i) => `?`).join(', ');

    const sql = `INSERT INTO ${this.tableName} (${placeholders}) VALUES (${paramPlaceholders})`;
    const result = this.db.execute(sql, data);
    return this.findById(result.lastID as number) as Promise<T>;
  }

  async update(id: number, data: Partial<T>): Promise<T> {
    const updates = Object.keys(data).map((k) => `"${k}" = ?`).join(', ');
    const sql = `UPDATE ${this.tableName} SET ${updates} WHERE ไอดี = ?`;
    this.db.execute(sql, { ...data, ไอดี: id });
    return this.findById(id) as Promise<T>;
  }

  async delete(id: number): Promise<boolean> {
    const result = this.db.execute(`DELETE FROM ${this.tableName} WHERE ไอดี = ?`, { ไอดี: id });
    return result.changes > 0;
  }

  async search(criteria: Partial<T>): Promise<T[]> {
    const conditions = Object.keys(criteria).map((k) => `"${k}" = ?`).join(' AND ');
    const sql = `SELECT * FROM ${this.tableName} WHERE ${conditions}`;
    return this.db.query(sql, criteria);
  }
}
REPOSITORY_EOF
echo "✅ Repository Base Class created"

# ====== STEP 10: Create Specific Repositories ======
echo ""
echo "👥 Step 10: Creating Repositories..."

cat > src/database/repositories/customer.repository.ts << 'CUSTOMER_REPO_EOF'
import { Repository } from '../repository';
import type { DatabaseManager } from '../database';

export interface Customer {
  ไอดี: number;
  ชื่อ: string;
  นามสกุล?: string;
  เบอร์โทร: string;
  อีเมล?: string;
  สถานะ: string;
  จำนวนครั้งมา: number;
  ครั้งแรกมาที่: string;
}

export class CustomerRepository extends Repository<Customer> {
  constructor(db: DatabaseManager) {
    super(db, 'ลูกค้า');
  }

  async findByPhone(phone: string): Promise<Customer | null> {
    return this.db.queryOne(`SELECT * FROM ลูกค้า WHERE เบอร์โทร = ?`, { เบอร์โทร: phone }) || null;
  }

  async findVIPCustomers(): Promise<Customer[]> {
    return this.db.query(`SELECT * FROM ลูกค้า WHERE สถานะ = 'VIP' ORDER BY จำนวนครั้งมา DESC`);
  }

  async incrementVisitCount(customerId: number): Promise<void> {
    this.db.execute(
      'UPDATE ลูกค้า SET จำนวนครั้งมา = จำนวนครั้งมา + 1 WHERE ไอดี = ?',
      { ไอดี: customerId }
    );
  }
}
CUSTOMER_REPO_EOF

cat > src/database/repositories/booking.repository.ts << 'BOOKING_REPO_EOF'
import { Repository } from '../repository';
import type { DatabaseManager } from '../database';

export interface Booking {
  ไอดี: number;
  ไอดีโรงแรม: number;
  ชื่อลูกค้า: string;
  เบอร์โทร: string;
  เลขห้อง: number;
  วันเข้าที่คาดว่า: string;
  วันออกที่คาดว่า: string;
  จำนวนคืน: number;
  ค่าห้องทั้งหมด: number;
  ค่ามัดจำ: number;
  สถานะจอง: string;
}

export class BookingRepository extends Repository<Booking> {
  constructor(db: DatabaseManager) {
    super(db, 'การจองล่วงหน้า');
  }

  async findPendingBookings(): Promise<Booking[]> {
    return this.db.query(`
      SELECT * FROM การจองล่วงหน้า 
      WHERE สถานะจอง = 'รอยืนยัน' 
      ORDER BY วันเข้าที่คาดว่า
    `);
  }

  async isRoomAvailable(roomId: number, checkIn: string, checkOut: string): Promise<boolean> {
    const result = this.db.queryOne(
      `SELECT COUNT(*) as count FROM การจองล่วงหน้า
       WHERE เลขห้อง = ? AND สถานะจอง != 'ยกเลิก'
       AND (วันเข้าที่คาดว่า < ? AND วันออกที่คาดว่า > ?)`,
      { เลขห้อง: roomId, 'วันออกที่คาดว่า': checkOut, 'วันเข้าที่คาดว่า': checkIn }
    ) as any;
    return result?.count === 0;
  }
}
BOOKING_REPO_EOF

cat > src/database/repositories/income.repository.ts << 'INCOME_REPO_EOF'
import { Repository } from '../repository';
import type { DatabaseManager } from '../database';

export interface Income {
  ไอดี: number;
  ไอดีลูกค้า?: number;
  วันที่: string;
  ประเภท: string;
  รายการ: string;
  จำนวนเงิน: number;
  ช่องทางชำระ: string;
  สถานะ: string;
}

export class IncomeRepository extends Repository<Income> {
  constructor(db: DatabaseManager) {
    super(db, 'บันทึกรายรับ');
  }

  async getDailyTotal(date: string): Promise<number> {
    const result = this.db.queryOne(
      `SELECT SUM(จำนวนเงิน) as total FROM บันทึกรายรับ WHERE วันที่ = ?`,
      { วันที่: date }
    ) as any;
    return result?.total || 0;
  }
}
INCOME_REPO_EOF

cat > src/database/repositories/expense.repository.ts << 'EXPENSE_REPO_EOF'
import { Repository } from '../repository';
import type { DatabaseManager } from '../database';

export interface Expense {
  ไอดี: number;
  ไอดีโรงแรม: number;
  วันที่: string;
  ประเภท: string;
  รายการ: string;
  จำนวนเงิน: number;
  สถานะ: string;
}

export class ExpenseRepository extends Repository<Expense> {
  constructor(db: DatabaseManager) {
    super(db, 'บันทึกรายจ่าย');
  }

  async getDailyTotal(date: string): Promise<number> {
    const result = this.db.queryOne(
      `SELECT SUM(จำนวนเงิน) as total FROM บันทึกรายจ่าย WHERE วันที่ = ? AND สถานะ = 'อนุมัติ'`,
      { วันที่: date }
    ) as any;
    return result?.total || 0;
  }

  async findPendingApproval(): Promise<Expense[]> {
    return this.db.query(`SELECT * FROM บันทึกรายจ่าย WHERE สถานะ = 'รออนุมัติ' ORDER BY วันที่ DESC`);
  }
}
EXPENSE_REPO_EOF

cat > src/database/repositories/room.repository.ts << 'ROOM_REPO_EOF'
import { Repository } from '../repository';
import type { DatabaseManager } from '../database';

export interface Room {
  ไอดี: number;
  ไอดีโรงแรม: number;
  เลขห้อง: number;
  ชั้น?: number;
  ประเภทห้อง: string;
  ความจุคน: number;
  ราคาต่อคืน: number;
  สถานะห้อง: string;
}

export class RoomRepository extends Repository<Room> {
  constructor(db: DatabaseManager) {
    super(db, 'ห้องพัก');
  }

  async findAvailable(): Promise<Room[]> {
    return this.db.query(
      `SELECT * FROM ห้องพัก WHERE สถานะห้อง = 'ว่าง' AND สถานะการใช้งาน = 'ใช้งาน' ORDER BY เลขห้อง`
    );
  }

  async getStatistics(): Promise<{ total: number; available: number; occupied: number; occupancyRate: number }> {
    const result = this.db.queryOne(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN สถานะห้อง = 'ว่าง' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN สถานะห้อง = 'มีแขก' THEN 1 ELSE 0 END) as occupied
      FROM ห้องพัก
      WHERE สถานะการใช้งาน = 'ใช้งาน'
    `) as any;

    const total = result?.total || 0;
    const occupied = result?.occupied || 0;
    return {
      total,
      available: result?.available || 0,
      occupied,
      occupancyRate: total > 0 ? Math.round((occupied / total) * 100) : 0,
    };
  }

  async updateStatus(roomId: number, status: string): Promise<void> {
    this.db.execute(`UPDATE ห้องพัก SET สถานะห้อง = ? WHERE ไอดี = ?`, { สถานะห้อง: status, ไอดี: roomId });
  }
}
ROOM_REPO_EOF

echo "✅ All Repositories created"

# ====== STEP 11: Create Database Service ======
echo ""
echo "⚙️ Step 11: Creating Database Service..."
cat > src/services/database.service.ts << 'SERVICE_EOF'
import { DatabaseManager } from '../database/database';
import { CustomerRepository } from '../database/repositories/customer.repository';
import { BookingRepository } from '../database/repositories/booking.repository';
import { IncomeRepository } from '../database/repositories/income.repository';
import { ExpenseRepository } from '../database/repositories/expense.repository';
import { RoomRepository } from '../database/repositories/room.repository';

export class DatabaseService {
  private db: DatabaseManager;
  public customers: CustomerRepository;
  public bookings: BookingRepository;
  public income: IncomeRepository;
  public expenses: ExpenseRepository;
  public rooms: RoomRepository;

  constructor(dbPath: string = './data/db/hotel.sqlite') {
    this.db = new DatabaseManager({ path: dbPath, verbose: true });
    this.customers = new CustomerRepository(this.db);
    this.bookings = new BookingRepository(this.db);
    this.income = new IncomeRepository(this.db);
    this.expenses = new ExpenseRepository(this.db);
    this.rooms = new RoomRepository(this.db);
  }

  async initialize(): Promise<void> {
    await this.db.connect();
    await this.db.initialize();
  }

  close(): void {
    this.db.close();
  }
}
SERVICE_EOF
echo "✅ Database Service created"

# ====== STEP 12: Create Extensions ======
echo ""
echo "🔌 Step 12: Creating Extensions..."

cat > src/extensions/booking.extension.ts << 'BOOKING_EXT_EOF'
import type { DatabaseService } from '../services/database.service';

export class BookingExtension {
  name = 'booking';
  version = '1.0.0';

  constructor(private dbService: DatabaseService) {}

  async create(data: { ชื่อลูกค้า: string; เบอร์โทร: string; เลขห้อง: number; วันเข้า: string; วันออก: string }) {
    const days = this.calculateDays(data.วันเข้า, data.วันออก);
    const room = await this.dbService.rooms.findById(data.เลขห้อง);
    if (!room) throw new Error('ห้องไม่พบ');

    const totalPrice = room.ราคาต่อคืน * days;
    const deposit = totalPrice * 0.3;

    return await this.dbService.bookings.create({
      ไอดีโรงแรม: 1,
      ชื่อลูกค้า: data.ชื่อลูกค้า,
      เบอร์โทร: data.เบอร์โทร,
      เลขห้อง: data.เลขห้อง,
      ประเภทห้อง: room.ประเภทห้อง,
      ราคาต่อคืน: room.ราคาต่อคืน,
      วันจอง: new Date().toISOString(),
      วันเข้าที่คาดว่า: data.วันเข้า,
      วันออกที่คาดว่า: data.วันออก,
      จำนวนคืน: days,
      ค่าห้องทั้งหมด: totalPrice,
      ค่ามัดจำ: deposit,
      สถานะจอง: 'รอยืนยัน',
    });
  }

  async list() {
    return await this.dbService.bookings.findAll();
  }

  async listPending() {
    return await this.dbService.bookings.findPendingBookings();
  }

  private calculateDays(checkIn: string, checkOut: string): number {
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }
}
BOOKING_EXT_EOF

cat > src/extensions/checkin.extension.ts << 'CHECKIN_EXT_EOF'
import type { DatabaseService } from '../services/database.service';

export class CheckinExtension {
  name = 'checkin';
  version = '1.0.0';

  constructor(private dbService: DatabaseService) {}

  async process(data: { ชื่อลูกค้า: string; เบอร์โทร: string; เลขห้อง: number }) {
    let customer = await this.dbService.customers.findByPhone(data.เบอร์โทร);
    if (!customer) {
      customer = await this.dbService.customers.create({
        ชื่อ: data.ชื่อลูกค้า,
        เบอร์โทร: data.เบอร์โทร,
        สถานะ: 'ปกติ',
      });
    }

    await this.dbService.customers.incrementVisitCount(customer.ไอดี);
    await this.dbService.rooms.updateStatus(data.เลขห้อง, 'มีแขก');

    return { status: 'success', customer: customer.ชื่อ, room: data.เลขห้อง };
  }

  async checkout(roomId: number) {
    await this.dbService.rooms.updateStatus(roomId, 'ว่าง');
    return { status: 'success', room: roomId };
  }
}
CHECKIN_EXT_EOF

cat > src/extensions/payment.extension.ts << 'PAYMENT_EXT_EOF'
import type { DatabaseService } from '../services/database.service';

export class PaymentExtension {
  name = 'payment';
  version = '1.0.0';

  constructor(private dbService: DatabaseService) {}

  async record(data: { ไอดีลูกค้า: number; จำนวนเงิน: number; ประเภท: string; ช่องทางชำระ: string }) {
    return await this.dbService.income.create({
      ไอดีลูกค้า: data.ไอดีลูกค้า,
      วันที่: new Date().toISOString().split('T')[0],
      ประเภท: data.ประเภท,
      รายการ: `${data.ประเภท} - ${data.ช่องทางชำระ}`,
      จำนวนเงิน: data.จำนวนเงิน,
      ช่องทางชำระ: data.ช่องทางชำระ,
      สถานะ: 'รับแล้ว',
    });
  }
}
PAYMENT_EXT_EOF

cat > src/extensions/report.extension.ts << 'REPORT_EXT_EOF'
import type { DatabaseService } from '../services/database.service';

export class ReportExtension {
  name = 'report';
  version = '1.0.0';

  constructor(private dbService: DatabaseService) {}

  async daily(date?: string) {
    const reportDate = date || new Date().toISOString().split('T')[0];
    const income = await this.dbService.income.getDailyTotal(reportDate);
    const expense = await this.dbService.expenses.getDailyTotal(reportDate);
    const rooms = await this.dbService.rooms.getStatistics();

    return {
      date: reportDate,
      income,
      expense,
      net: income - expense,
      rooms,
    };
  }

  async roomStatus() {
    return await this.dbService.rooms.getStatistics();
  }

  async bookings() {
    return await this.dbService.bookings.findPendingBookings();
  }
}
REPORT_EXT_EOF

echo "✅ Extensions created"

# ====== STEP 13: Create CLI ======
echo ""
echo "🖥️ Step 13: Creating CLI Interface..."
cat > src/api/cli.ts << 'CLI_EOF'
import { createInterface } from 'readline';
import type { AIProvider } from '../core/ai-provider';
import type { DatabaseService } from '../services/database.service';

export class CLIInterface {
  private readline: any;
  private isRunning = false;
  private commandHistory: string[] = [];

  constructor(private aiProvider: AIProvider, private dbService: DatabaseService) {
    this.readline = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    this.readline.on('SIGINT', () => this.shutdown());
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.printBanner();
    this.printHelp();
    await this.readLoop();
  }

  private async readLoop(): Promise<void> {
    while (this.isRunning) {
      await new Promise<void>((resolve) => {
        this.readline.question('
👤 You: ', async (input) => {
          try {
            await this.handleCommand(input.trim());
          } catch (error) {
            console.error('
❌ Error:', error);
          }
          resolve();
        });
      });
    }
  }

  private async handleCommand(input: string): Promise<void> {
    if (!input) return;
    this.commandHistory.push(input);

    const parts = input.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'exit':
      case 'quit':
        this.shutdown();
        break;
      case 'help':
        this.printHelp();
        break;
      case 'clear':
        console.clear();
        this.printBanner();
        break;
      case 'status':
        await this.showStatus();
        break;
      case 'booking':
        await this.handleBooking(args.join(' '));
        break;
      case 'checkin':
        await this.handleCheckin(args.join(' '));
        break;
      case 'payment':
        await this.handlePayment(args.join(' '));
        break;
      case 'report':
        await this.handleReport(args.join(' '));
        break;
      default:
        await this.sendToAI(input);
    }
  }

  private async handleBooking(query: string): Promise<void> {
    const subcommand = query.split(/\s+/)[0] || 'list';
    if (subcommand === 'list') {
      const bookings = await this.dbService.bookings.findPendingBookings();
      console.log('
📅 Pending Bookings:', bookings.length);
      bookings.forEach((b) => {
        console.log(`  ID: ${b.ไอดี} | ${b.ชื่อลูกค้า} | Room: ${b.เลขห้อง} | ฿${b.ค่ามัดจำ}`);
      });
    }
  }

  private async handleCheckin(query: string): Promise<void> {
    const response = await this.aiProvider.query(`เช็คอิน: ${query}`, { action: 'checkin' });
    console.log('
🤖 Alice:', response);
  }

  private async handlePayment(query: string): Promise<void> {
    const response = await this.aiProvider.query(`ชำระเงิน: ${query}`, { action: 'payment' });
    console.log('
🤖 Alice:', response);
  }

  private async handleReport(query: string): Promise<void> {
    const type = query.split(/\s+/)[0] || 'daily';
    if (type === 'daily') {
      const today = new Date().toISOString().split('T')[0];
      const income = await this.dbService.income.getDailyTotal(today);
      const expense = await this.dbService.expenses.getDailyTotal(today);
      console.log(`
📊 Daily Report (${today}):`);
      console.log(`   Income:  ฿${income.toFixed(2)}`);
      console.log(`   Expense: ฿${expense.toFixed(2)}`);
      console.log(`   Net:     ฿${(income - expense).toFixed(2)}`);
    }
  }

  private async sendToAI(message: string): Promise<void> {
    const response = await this.aiProvider.query(message, { hotelName: 'โรงแรมดอกบัวสวย' });
    console.log('
🤖 Alice:', response);
  }

  private async showStatus(): Promise<void> {
    const rooms = await this.dbService.rooms.getStatistics();
    const today = new Date().toISOString().split('T')[0];
    const income = await this.dbService.income.getDailyTotal(today);

    console.log(`
╔════════════════════════════════╗
║    📊 System Status             ║
╚════════════════════════════════╝

🏨 Rooms:
   Total: ${rooms.total} | Occupied: ${rooms.occupied} | Occupancy: ${rooms.occupancyRate}%

💰 Today:
   Income: ฿${income.toFixed(2)}

✅ Systems Ready
    `);
  }

  private printBanner(): void {
    console.log(`
╔════════════════════════════════════════════════╗
║  🏨 Hotel AI Management System                 ║
║  Alice v1.0 - Running on Termux                ║
╚════════════════════════════════════════════════╝
    `);
  }

  private printHelp(): void {
    console.log(`
📋 Commands:
  help         - Show help
  status       - System status
  exit         - Quit
  booking list - Show pending bookings
  report daily - Daily report
  Or just chat!
    `);
  }

  private shutdown(): void {
    console.log('
👋 Goodbye!
');
    this.isRunning = false;
    this.readline.close();
    process.exit(0);
  }
}
CLI_EOF
echo "✅ CLI created"

# ====== STEP 14: Create Main Application ======
echo ""
echo "🚀 Step 14: Creating main application..."
cat > src/index.ts << 'INDEX_EOF'
import 'dotenv/config';
import { AIProvider } from './core/ai-provider';
import { DatabaseService } from './services/database.service';
import { CLIInterface } from './api/cli';

async function main() {
  console.log(`
╔════════════════════════════════════════════════╗
║  🚀 Initializing Hotel AI System on Termux    ║
╚════════════════════════════════════════════════╝
  `);

  try {
    console.log('
1️⃣  Initializing Database...');
    const dbService = new DatabaseService();
    await dbService.initialize();

    console.log('
2️⃣  Initializing AI Provider...');
    const aiProvider = new AIProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

    console.log('
3️⃣  Starting CLI...
');
    const cli = new CLIInterface(aiProvider, dbService);
    await cli.start();

    dbService.close();
  } catch (error) {
    console.error('❌ Fatal Error:', error);
    process.exit(1);
  }
}

main();
INDEX_EOF
echo "✅ Main application created"

# ====== STEP 15: Create Test File ======
echo ""
echo "🧪 Step 15: Creating test file..."
cat > src/database/__tests__/integration.test.ts << 'TEST_EOF'
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { DatabaseService } from '../../services/database.service';

describe('🗄️ Database Tests', () => {
  let dbService: DatabaseService;

  beforeAll(async () => {
    dbService = new DatabaseService(':memory:');
    await dbService.initialize();
  });

  afterAll(() => {
    dbService.close();
  });

  it('should create customer', async () => {
    const customer = await dbService.customers.create({
      ชื่อ: 'สมชาย',
      เบอร์โทร: '081-111-1111',
      สถานะ: 'ปกติ',
    });
    expect(customer.ชื่อ).toBe('สมชาย');
  });

  it('should find customer by phone', async () => {
    await dbService.customers.create({
      ชื่อ: 'สมหญิง',
      เบอร์โทร: '081-222-2222',
      สถานะ: 'ปกติ',
    });
    const customer = await dbService.customers.findByPhone('081-222-2222');
    expect(customer?.ชื่อ).toBe('สมหญิง');
  });

  it('should get room statistics', async () => {
    const stats = await dbService.rooms.getStatistics();
    expect(stats.total).toBeGreaterThan(0);
  });

  it('should record income', async () => {
    const income = await dbService.income.create({
      วันที่: new Date().toISOString().split('T')[0],
      ประเภท: 'ค่าห้องพัก',
      รายการ: 'ห้อง 101',
      จำนวนเงิน: 600,
      ช่องทางชำระ: 'เงินสด',
      สถานะ: 'รับแล้ว',
    });
    expect(income.จำนวนเงิน).toBe(600);
  });
});
TEST_EOF
echo "✅ Test file created"

# ====== STEP 16: Create .gitignore ======
cat > .gitignore << 'GITIGNORE_EOF'
node_modules/
dist/
*.log
.env
.DS_Store
data/db/*.sqlite
data/db/*.sqlite-wal
data/db/*.sqlite-shm
coverage/
.jest_cache/
GITIGNORE_EOF

echo ""
echo "✅ All files created successfully!"

# ====== STEP 17: Build ======
echo ""
echo "🏗️ Step 16: Building TypeScript..."
npm run build > /dev/null 2>&1 || {
  echo "❌ Build failed! Check for errors above."
  exit 1
}
echo "✅ Build successful"

# ====== STEP 18: Run Tests ======
echo ""
echo "🧪 Step 17: Running tests..."
npm test -- --passWithNoTests > /dev/null 2>&1
echo "✅ Tests completed"

# ====== FINAL STATUS ======
echo ""
echo "╔════════════════════════════════════════════════╗"
echo "║  ✅ Setup Complete!                           ║"
echo "╚════════════════════════════════════════════════╝"

echo ""
echo "📁 Project location: ~/hotel-ai-system"
echo ""
echo "🎯 Next Steps:"
echo "1. Edit .env file with your API key:"
echo "   nano .env"
echo ""
echo "2. Start the system:"
echo "   npm run dev"
echo ""
echo "3. Chat with Alice!"
echo "   👤 You: help"
echo "   👤 You: status"
echo "   👤 You: booking list"
echo "   👤 You: report daily"
echo ""
echo "📊 Project Structure:"
echo "   src/                - Source code"
echo "   data/db/            - SQLite database"
echo "   data/conversations/ - AI chat history"
echo "   dist/               - Compiled output"
echo ""
echo "✨ Ready to use! Good luck! 🚀"
