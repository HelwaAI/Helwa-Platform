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
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');
  const status = searchParams.get('status'); // 'open', 'closed', 'all'

  try {
    // Query to get trades from zone_alerts with retest outcomes
    let query = `
    SELECT
        za.id as alert_id,
        s.symbol,
        z.zone_type,
        za.entry_price,
        za.stop_loss,
        za.target_price,
        za.alert_time,
        za.alerted_at,
        z.zone_id,
        z.top_price as zone_top,
        z.bottom_price as zone_bottom,
        z.start_time as zone_start,
        zfr.bounce_day as retest_date,
        zfr.bounce_close as retest_price,
        zfr.close_5d,
        zfr.return_5d,
        CASE
            WHEN z.zone_type = 'demand' THEN
                CASE
                    WHEN zfr.return_5d > 0 THEN 'WIN'
                    WHEN zfr.return_5d < 0 THEN 'LOSS'
                    ELSE 'PENDING'
                END
            ELSE
                CASE
                    WHEN zfr.return_5d < 0 THEN 'WIN'
                    WHEN zfr.return_5d > 0 THEN 'LOSS'
                    ELSE 'PENDING'
                END
        END as outcome,
        CASE
            WHEN z.zone_type = 'demand' THEN zfr.return_5d
            ELSE -zfr.return_5d
        END as adjusted_return
    FROM stocks.zone_alerts za
    JOIN stocks.zones z ON za.zone_id = z.zone_id
    JOIN stocks.symbols s ON s.id = za.symbol_id
    LEFT JOIN stocks.zone_first_retests_cache zfr ON z.zone_id = zfr.zone_id
    WHERE za.alerted_at IS NOT NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Filter by symbol if provided
    if (symbol) {
      query += ` AND s.symbol = $${paramIndex}`;
      params.push(symbol);
      paramIndex++;
    }

    // Filter by status if provided
    if (status === 'open') {
      query += ` AND zfr.close_5d IS NULL`;
    } else if (status === 'closed') {
      query += ` AND zfr.close_5d IS NOT NULL`;
    }

    // Order by most recent first
    query += ` ORDER BY za.alerted_at DESC`;

    // Add pagination
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Calculate summary statistics
    const trades = result.rows;
    const closedTrades = trades.filter((t: any) => t.outcome !== 'PENDING');
    const wins = closedTrades.filter((t: any) => t.outcome === 'WIN').length;
    const losses = closedTrades.filter((t: any) => t.outcome === 'LOSS').length;
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

    const totalReturn = closedTrades.reduce((sum: number, t: any) => {
      return sum + (parseFloat(t.adjusted_return) || 0);
    }, 0);

    const avgReturn = closedTrades.length > 0 ? totalReturn / closedTrades.length : 0;

    return NextResponse.json({
      success: true,
      data: {
        trades: trades.map((row: any) => ({
          alertId: row.alert_id,
          symbol: row.symbol,
          zoneType: row.zone_type,
          zoneId: row.zone_id,
          entryPrice: parseFloat(row.entry_price),
          stopLoss: parseFloat(row.stop_loss),
          targetPrice: parseFloat(row.target_price),
          alertTime: row.alert_time,
          alertedAt: row.alerted_at,
          zoneTop: parseFloat(row.zone_top),
          zoneBottom: parseFloat(row.zone_bottom),
          retestDate: row.retest_date,
          retestPrice: row.retest_price ? parseFloat(row.retest_price) : null,
          close5d: row.close_5d ? parseFloat(row.close_5d) : null,
          return5d: row.return_5d ? parseFloat(row.return_5d) : null,
          adjustedReturn: row.adjusted_return ? parseFloat(row.adjusted_return) : null,
          outcome: row.outcome,
        })),
        summary: {
          totalTrades: trades.length,
          closedTrades: closedTrades.length,
          openTrades: trades.length - closedTrades.length,
          wins,
          losses,
          winRate: winRate.toFixed(1),
          totalReturn: totalReturn.toFixed(2),
          avgReturn: avgReturn.toFixed(2),
        },
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
