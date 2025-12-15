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
  const limit = parseInt(searchParams.get('limit') || '5850');
  const timeframe = searchParams.get('timeframe') || '2m';
  const hours = parseInt(searchParams.get('hours') || '720');
  // Accept optional 'days' parameter for day-based timeframes (takes precedence over hours)
  const days = searchParams.get('days') ? parseInt(searchParams.get('days')!) : null;
  const validTimeframes = ['2m', '3m', '5m', '6m',
    '10m', '13m', '15m', '26m',
    '30m', '39m', '65m', '78m', '130m', '195m', '1d', '5d', '22d', '65d'];
  if (!validTimeframes.includes(timeframe)) {
    return NextResponse.json(
      { success: false, error: 'Invalid timeframe' },
      { status: 400 }
    );
  }


  // Map timeframe param to DB view suffix
  // All minute-based timeframes use 'm' suffix (2m, 5m, 65m, etc.)
  // Day-based use 'd' suffix (1d, 5d, 22d, 65d)
  const timeframeMap: Record<string, string> = {
    '2m': '2m', '3m': '3m', '5m': '5m', '6m': '6m',
    '10m': '10m', '13m': '13m', '15m': '15m', '26m': '26m',
    '30m': '30m', '39m': '39m',
    '65m': '65m', '78m': '78m', '130m': '130m', '195m': '195m',
    '1d': '1d', '5d': '5d', '22d': '22d', '65d': '65d'
  };

  const dbTimeframe = timeframeMap[timeframe] || timeframe;

  // Determine the appropriate interval clause
  // For day-based timeframes (1d, 5d, 22d, 65d), use days parameter if provided
  // Otherwise fall back to hours parameter with intelligent defaults
  const isDayBasedTimeframe = ['1d', '5d', '22d', '65d'].includes(timeframe);
  // Longer minute timeframes (65m+) need extended lookback periods (in days, not hours)
  const isLongMinuteTimeframe = ['65m', '78m', '130m', '195m'].includes(timeframe);
  let intervalClause: string;

  if (days !== null) {
    // Use days parameter directly for more precise control over lookback period
    intervalClause = `${days} days`;
  } else if (isDayBasedTimeframe) {
    // For day-based timeframes, use a large default to ensure we get all historical data
    // 9125 days = ~25 years - covers most stock histories
    const daysFromHours = Math.ceil(hours / 24);
    const defaultDays = 9125;
    intervalClause = `${Math.max(daysFromHours, defaultDays)} days`;
  } else if (isLongMinuteTimeframe) {
    // For longer minute timeframes (65min+), convert hours to days for better precision
    // These timeframes need ~3-5 years of data typically
    const daysFromHours = Math.ceil(hours / 24);
    const defaultDays = 1825; // ~5 years default for long minute timeframes
    intervalClause = `${Math.max(daysFromHours, defaultDays)} days`;
  } else {
    // For short minute-based timeframes, use hours directly
    intervalClause = `${hours} hours`;
  }

  try {
    // Query stock aggregates from stocks schema
    const query = `
      SELECT
        ss.symbol,
        ss.company_name as company_name,
        sc.bucket,
        sc.open,
        sc.high,
        sc.low,
        sc.close,
        sc.volume
      FROM stocks.candles_${dbTimeframe} sc
      JOIN stocks.symbols ss ON sc.symbol_id = ss.id
      WHERE
        ${symbols.length > 0 ? 'ss.symbol = ANY($1) AND' : ''}
         sc.bucket >= NOW() - INTERVAL '${intervalClause}'
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
        high_24h: Math.max(...data.map(d => d.high)),
        low_24h: Math.min(...data.map(d => d.low)),
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
