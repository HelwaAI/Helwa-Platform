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
  // Default to 100k candles - enough for most historical data
  const limit = parseInt(searchParams.get('limit') || '100000');
  const timeframe = searchParams.get('timeframe') || '5m';
  const hours = parseInt(searchParams.get('hours') || '720');
  // Accept optional 'days' parameter for day-based timeframes (takes precedence over hours)
  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!) : null;
  // 'all' parameter fetches all available data from the first candle (no time filter)
  const fetchAll = searchParams.get('all') === 'true';

  // Validate timeframe to prevent SQL injection
  const validTimeframes = ['5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '7d', '31d', '93d', '65m', '130m', '195m', '390m'];
  if (!validTimeframes.includes(timeframe)) {
    return NextResponse.json(
      { success: false, error: 'Invalid timeframe' },
      { status: 400 }
    );
  }

  // Determine the appropriate interval clause
  // For day-based timeframes (1d, 7d, 31d, 93d), use days parameter if provided
  const isDayBasedTimeframe = ['1d', '7d', '31d', '93d'].includes(timeframe);
  let intervalClause: string | null = null;

  // If fetchAll is true, don't apply any time filter - get all available data
  if (!fetchAll) {
    if (days !== null) {
      intervalClause = `${days} days`;
    } else if (isDayBasedTimeframe) {
      // For day-based timeframes, use a large default (3650 days = 10 years for crypto)
      const daysFromHours = Math.ceil(hours / 24);
      const defaultDays = 3650;
      intervalClause = `${Math.max(daysFromHours, defaultDays)} days`;
    } else {
      intervalClause = `${hours} hours`;
    }
  }

  try {
    // Query crypto aggregates from crypto schema
    // When fetchAll is true, we don't apply a time filter - just get all data up to limit
    const timeFilter = intervalClause ? `mv.bucket >= NOW() - INTERVAL '${intervalClause}'` : 'TRUE';
    const query = `
      SELECT
        s.symbol,
        s.name as company_name,
        mv.bucket,
        mv.open,
        mv.high,
        mv.low,
        mv.close,
        mv.volume
      FROM crypto.candles_${timeframe} mv
      JOIN crypto.symbols s ON mv.symbol_id = s.id
      WHERE
        ${symbols.length > 0 ? 's.symbol = ANY($1) AND' : ''}
        ${timeFilter}
      ORDER BY mv.bucket DESC
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
        high_24h: Math.max(...data.map(d => d.high)),
        low_24h: Math.min(...data.map(d => d.low)),
        bars: data.reverse(), // Chronological order for charts
        last_updated: latest.bucket,
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

// Endpoint for current crypto universe symbols
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'get_universe') {
      // Get current crypto universe from symbols table
      const query = `
        SELECT DISTINCT s.symbol, s.name
        FROM crypto.symbols s
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
