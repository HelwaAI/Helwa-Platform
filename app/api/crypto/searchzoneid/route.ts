import { NextResponse } from 'next/server';
import pkg from 'pg';
const { Pool } = pkg;

// Load environment variables from .env.local
if (process.env.NODE_ENV === 'development') {
  require('dotenv').config({ path: '.env.local' });
}

// Create PostgreSQL connection pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  ssl: process.env.POSTGRES_SSL === 'require' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const zoneId = searchParams.get('zone_id');
  console.log("HERE")
  // Validate zone_id parameter
  if (!zoneId) {
    return NextResponse.json(
      { success: false, error: 'zone_id parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Query to get symbol and timeframe label for the given zone_id
    // Note: zone_id is stored as text in the database
    const query = `
      SELECT s.symbol, ct.label
      FROM crypto.zones cz
      JOIN crypto.symbols s ON s.id = cz.symbol_id
      JOIN crypto.timeframes ct ON ct.id = cz.timeframe_id
      WHERE cz.zone_id = $1
    `;

    const result = await pool.query(query, [zoneId]);

    // Check if zone was found
    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `Zone ${zoneId} not found` },
        { status: 404 }
      );
    }

    // Return the first (and should be only) result
    return NextResponse.json({
      success: true,
      data: {
        symbol: result.rows[0].symbol,
        timeframe: result.rows[0].label,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Database query error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
