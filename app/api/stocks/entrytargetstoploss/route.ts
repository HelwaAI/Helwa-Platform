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
  const symbol = searchParams.get('symbol');

  // Validate symbol parameter
  if (!symbol) {
    return NextResponse.json(
      { success: false, error: 'symbol parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Query to get entry, target, and stop loss for the given symbol
    const query = `
    SELECT
        za.entry_price,
        za.stop_loss,
        za.target_price, 
        za.zone_id
    FROM stocks.zone_alerts za
    JOIN stocks.zones z ON za.zone_id = z.zone_id
    JOIN stocks.symbols s ON s.id = za.symbol_id
    WHERE s.symbol = $1
    `;

    const result = await pool.query(query, [symbol]);

    // Check if any zone alerts were found
    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `No alert data found for symbol ${symbol}` },
        { status: 404 }
      );
    }

    // Return all alerts for this symbol (each with zone_id)
    // Convert to a lookup object keyed by zone_id for easy access
    const alertsByZone: Record<string, any> = {};
    result.rows.forEach((row) => {
      alertsByZone[row.zone_id] = {
        entry_price: row.entry_price,
        stop_loss: row.stop_loss,
        target_price: row.target_price,
      };
    });

    return NextResponse.json({
      success: true,
      data: alertsByZone,
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
