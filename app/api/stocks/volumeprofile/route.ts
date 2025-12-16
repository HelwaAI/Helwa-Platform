import { NextResponse } from 'next/server';
import pkg from 'pg';
const { Pool } = pkg;


const timeframeMap = {
    "2m": 2,
    "3m": 3,
    "5m": 4,
    "6m": 5,
    "10m": 6,
    "13m": 7,
    "15m": 8,
    "26m": 9,
    "30m": 10,
    "39m": 11,
    "65m": 12,
    "78m": 13,
    "130m": 14,
    "195m": 15,
    "1d": 16,
    "5d": 18,
    "22d": 19,
    "65d": 20,
};

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
  const timeframe = searchParams.get('timeframe') || '5m';

  const timeframeId = timeframeMap[timeframe as keyof typeof timeframeMap] || 1;



  // Validate symbol parameter
  if (!symbol) {
    return NextResponse.json(
      { success: false, error: 'symbol parameter is required' },
      { status: 400 }
    );
  }

  try {
    // Query to get volume profile data for the given symbol and timeframe
    const query = `
        SELECT vp.price_level,
	           vp.volume
        FROM stocks.volume_profile vp
        JOIN stocks.timeframes tm ON tm.id = vp.timeframe_id
        JOIN stocks.symbols s ON s.id = vp.symbol_id
        WHERE tm.id = $1 AND s.symbol = $2
        ORDER BY vp.price_level DESC
    `;

    const result = await pool.query(query, [timeframeId, symbol]);

    // Check if any volume profile data was found
    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `No volume profile data found for symbol ${symbol} with timeframe ${timeframe}` },
        { status: 404 }
      );
    }

    // Return volume profile as array of price levels with volumes
    const volumeProfile = result.rows.map((row) => ({
      price_level: parseFloat(row.price_level),
      volume: parseFloat(row.volume),
    }));

    return NextResponse.json({
      success: true,
      symbol: symbol,
      timeframe: timeframe,
      data: volumeProfile,
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
