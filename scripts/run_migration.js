const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  connectionString: 'postgresql://postgres.rmxuwyxpoazsuqvdadlo:PrimeChamps7328!@aws-0-us-west-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const sqlFile = process.argv[2];

  try {
    await client.connect();
    console.log('Connected to database');

    if (sqlFile) {
      // Run specific SQL file
      const sqlPath = path.resolve(sqlFile);
      const sql = fs.readFileSync(sqlPath, 'utf8');

      // Split by semicolons and run each statement
      const statements = sql.split(';').filter(s => s.trim());
      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await client.query(statement);
            console.log('✓ Executed:', statement.trim().substring(0, 60) + '...');
          } catch (e) {
            if (e.message.includes('already exists')) {
              console.log('⊘ Already exists:', statement.trim().substring(0, 60) + '...');
            } else {
              console.error('✗ Error:', e.message);
            }
          }
        }
      }
    } else {
      console.log('Usage: node run_migration.js <sql_file>');
    }

    console.log('\nMigration completed!');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
