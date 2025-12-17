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
  try {
    // Query for top performing stocks based on demand zone bounces
    const query = `
      SELECT * FROM (
        SELECT DISTINCT ON (c.symbol)
            c.symbol,
            c.zone_id,
            c.zone_type,
            c.bounce_day,
            c.bounce_close,
            c.penetration_pct,
            c.return_1d,
            c.return_2d,
            c.return_3d,
            c.return_5d,
            c.zone_low,
            c.zone_high
        FROM stocks.zone_percent_returns c
        WHERE c.bounce_day >= CURRENT_DATE - INTERVAL '22 days'
            AND c.return_5d IS NOT NULL
            AND c.zone_type = 'demand'
        ORDER BY c.symbol, c.return_5d DESC
      ) best_per_symbol
      ORDER BY return_5d DESC
      LIMIT 3
    `;

    const result = await pool.query(query);

    return NextResponse.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
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
