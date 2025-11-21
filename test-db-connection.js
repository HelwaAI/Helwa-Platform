require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  ssl: process.env.POSTGRES_SSL === 'require' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
});

async function testConnection() {
  try {
    console.log('\n🔍 Testing PostgreSQL Connection...\n');
    console.log('Connection Details:');
    console.log(`  Host: ${process.env.POSTGRES_HOST}`);
    console.log(`  Port: ${process.env.POSTGRES_PORT}`);
    console.log(`  User: ${process.env.POSTGRES_USER}`);
    console.log(`  Database: ${process.env.POSTGRES_DB}`);
    console.log('\n⏳ Connecting...\n');

    // Test connection
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Connection successful!');
    console.log(`   Current database time: ${result.rows[0].now}\n`);

    // List all schemas
    console.log('📋 Available Schemas:\n');
    const schemasResult = await pool.query(
      'SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;'
    );
    schemasResult.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.schema_name}`);
    });

    // Check for crypto schema specifically
    const cryptoExists = schemasResult.rows.some(
      row => row.schema_name === 'crypto'
    );

    console.log('\n' + (cryptoExists ? '✅ crypto schema FOUND!' : '❌ crypto schema NOT found'));

    // If crypto schema exists, list its tables
    if (cryptoExists) {
      console.log('\n📊 Tables in crypto schema:\n');
      const tablesResult = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'crypto' ORDER BY table_name;`
      );
      tablesResult.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. ${row.table_name}`);
      });
    }

    console.log('\n');
  } catch (error) {
    console.error('\n❌ Connection Error:', error.message);
    console.error('\nTroubleshooting tips:');
    console.error('  1. Check your .env.local file exists and has correct credentials');
    console.error('  2. Verify the database host is accessible from your network');
    console.error('  3. Ensure the credentials are correct');
    console.error('  4. Check if your IP is whitelisted in the database firewall');
    console.error('\n');
  } finally {
    await pool.end();
  }
}

testConnection();
