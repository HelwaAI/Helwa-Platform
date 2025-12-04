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
  const symbols = searchParams.get('symbols')?.split(',') || [];
  const limit = parseInt(searchParams.get('limit') || '50');
  const timeframe = searchParams.get('timeframe') || '5m';
  const hours = parseInt(searchParams.get('hours') || '720');

  try {
    // Query stock aggregates from stocks schema
    const query = `
      SELECT
        sc.symbol,
        ss.company_name as company_name,
        sc.bucket,
        sc.open,
        sc.high,
        sc.low,
        sc.close,
        sc.volume
      FROM stocks.candles_${timeframe} sc
      JOIN stocks.symbols ss ON sc.symbol_id = ss.id
      WHERE
        ${symbols.length > 0 ? 'ss.symbol = ANY($1) AND' : ''}
        AND sc.bucket >= NOW() - INTERVAL '${hours} hours'
      ORDER BY sc.bucket DESC
      LIMIT $2
    `;

    // Always pass symbols and limit in consistent order: $1 = symbols (or null), $2 = limit
    const params = [symbols.length > 0 ? symbols : null, limit];
    const result = await pool.query(query, params);

    // Group by symbol for easier frontend processing
    const groupedData: Record<string, any[]> = {};
    result.rows.forEach((row: any) => {
      if (!groupedData[row.symbol]) {
        groupedData[row.symbol] = [];
      }
      groupedData[row.symbol].push(row);
    });

    // Calculate summary stats for each symbol
    const summaries = Object.entries(groupedData).map(([symbol, data]) => {
      const latest = data[0];
      const earliest = data[data.length - 1];
      const change = latest.close - earliest.open;
      const changePercent = (change / earliest.open) * 100;

      return {
        symbol,
        company_name: latest.company_name,
        latest_price: latest.close,
        change,
        change_percent: changePercent,
        volume_24h: data.reduce((sum, d) => sum + d.volume, 0),
        dollar_volume_24h: data.reduce((sum, d) => sum + d.dollar_volume, 0),
        high_24h: Math.max(...data.map(d => d.high)),
        low_24h: Math.min(...data.map(d => d.low)),
        vwap: latest.vwap,
        bars: data.reverse(), // Chronological order for charts
        last_updated: latest.timestamp,
      };
    });

    return NextResponse.json({
      success: true,
      data: summaries,
      count: summaries.length,
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

// Endpoint for current universe symbols
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'get_universe') {
      // Get current universe from symbols table
      const query = `
        SELECT DISTINCT s.symbol, s.name
        FROM stocks.symbols s
        ORDER BY s.symbol
      `;

      const result = await pool.query(query);

      return NextResponse.json({
        success: true,
        symbols: result.rows,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
