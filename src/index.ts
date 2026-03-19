import 'dotenv/config';
import { AIProvider } from './core/ai-provider';
import { DatabaseManager } from './database/database';

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  🏨 Hotel AI Management System         ║');
  console.log('║  ✅ Ready to Deploy!                   ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    const db = new DatabaseManager();
    const ai = new AIProvider();
    
    console.log('\n✨ All systems initialized!');
    console.log('🚀 Application ready for use');
    
    db.close();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
