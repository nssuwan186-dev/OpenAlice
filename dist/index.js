"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const ai_provider_1 = require("./core/ai-provider");
const database_1 = require("./database/database");
async function main() {
    console.log('╔════════════════════════════════════════╗');
    console.log('║  🏨 Hotel AI Management System         ║');
    console.log('║  ✅ Ready to Deploy!                   ║');
    console.log('╚════════════════════════════════════════╝');
    try {
        const db = new database_1.DatabaseManager();
        const ai = new ai_provider_1.AIProvider();
        console.log('\n✨ All systems initialized!');
        console.log('🚀 Application ready for use');
        db.close();
    }
    catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}
main();
