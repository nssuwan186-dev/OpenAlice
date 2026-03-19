"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
class DatabaseManager {
    constructor(path = './data/db/hotel.sqlite') {
        this.db = new better_sqlite3_1.default(path);
        console.log('✅ Database connected: ' + path);
    }
    query(sql) {
        return this.db.prepare(sql).all();
    }
    close() {
        this.db.close();
    }
}
exports.DatabaseManager = DatabaseManager;
