import { NextResponse } from 'next/server';
import pkg from 'pg';
const { Pool } = pkg;

// Load environment variables from .env.local
if (process.env.NODE_ENV === 'development') {
  require('dotenv').config({ path: '.env.local' });
}


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
  const status = searchParams.get('status'); // 'open', 'closed', 'all'
  const timeframe = searchParams.get('timeframe') || '5m';
  const timeframeId = timeframeMap[timeframe as keyof typeof timeframeMap] || 1;

  try {
    // Query to get trades from historical_trades table
    let query = `
    SELECT
        ht.trade_id,
        ht.symbol,
        ht.zone_type,
        ht.zone_id,
        ht.zone_bottom,
        ht.zone_top,
        ht.zone_height,
        ht.entry_time,
        ht.entry_price,
        ht.entry_candle_open,
        ht.stop_price,
        ht.target_price,
        ht.target_type,
        ht.target_hvn_percentile,
        ht.risk_amount,
        ht.reward_amount,
        ht.risk_reward_ratio,
        ht.outcome,
        ht.exit_time,
        ht.exit_price,
        ht.exit_reason,
        ht.minutes_to_exit,
        ht.trading_days_to_exit,
        ht.candles_to_exit,
        ht.pnl_points,
        ht.pnl_percent,
        ht.r_multiple,
        ht.discord_alerted,
        tf.label as timeframe
    FROM stocks.historical_trades ht
    LEFT JOIN stocks.timeframes tf ON ht.timeframe_id = tf.id
    WHERE ht.timeframe_id = ${timeframeId}
    `;

    const params: any[] = [];
    let paramIndex = 1;

    // Filter by symbol if provided
    if (symbol) {
      query += ` AND ht.symbol = $${paramIndex}`;
      params.push(symbol);
      paramIndex++;
    }

    // Filter by status if provided
    if (status === 'open') {
      query += ` AND ht.outcome IS NULL`;
    } else if (status === 'closed') {
      query += ` AND ht.outcome IS NOT NULL`;
    }

    // Order by most recent first
    query += ` ORDER BY ht.entry_time DESC`;

    const result = await pool.query(query, params);

    // Calculate summary statistics
    const trades = result.rows;
    const closedTrades = trades.filter((t: any) => t.outcome !== null);
    const wins = closedTrades.filter((t: any) => t.outcome === 'WIN').length;
    const losses = closedTrades.filter((t: any) => t.outcome === 'LOSS').length;
    const breakevens = closedTrades.filter((t: any) => t.outcome === 'BREAKEVEN').length;
    const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

    const totalPnlPercent = closedTrades.reduce((sum: number, t: any) => {
      return sum + (parseFloat(t.pnl_percent) || 0);
    }, 0);

    const totalRMultiple = closedTrades.reduce((sum: number, t: any) => {
      return sum + (parseFloat(t.r_multiple) || 0);
    }, 0);

    const avgPnlPercent = closedTrades.length > 0 ? totalPnlPercent / closedTrades.length : 0;
    const avgRMultiple = closedTrades.length > 0 ? totalRMultiple / closedTrades.length : 0;

    return NextResponse.json({
      success: true,
      data: {
        trades: trades.map((row: any) => ({
          tradeId: row.trade_id,
          symbol: row.symbol,
          zoneType: row.zone_type,
          zoneId: row.zone_id,
          zoneBottom: parseFloat(row.zone_bottom),
          zoneTop: parseFloat(row.zone_top),
          zoneHeight: parseFloat(row.zone_height),
          entryTime: row.entry_time,
          entryPrice: parseFloat(row.entry_price),
          entryCandleOpen: row.entry_candle_open ? parseFloat(row.entry_candle_open) : null,
          stopPrice: parseFloat(row.stop_price),
          targetPrice: parseFloat(row.target_price),
          targetType: row.target_type,
          targetHvnPercentile: row.target_hvn_percentile ? parseFloat(row.target_hvn_percentile) : null,
          riskAmount: parseFloat(row.risk_amount),
          rewardAmount: parseFloat(row.reward_amount),
          riskRewardRatio: parseFloat(row.risk_reward_ratio),
          outcome: row.outcome,
          exitTime: row.exit_time,
          exitPrice: row.exit_price ? parseFloat(row.exit_price) : null,
          exitReason: row.exit_reason,
          minutesToExit: row.minutes_to_exit,
          tradingDaysToExit: row.trading_days_to_exit,
          candlesToExit: row.candles_to_exit,
          pnlPoints: row.pnl_points ? parseFloat(row.pnl_points) : null,
          pnlPercent: row.pnl_percent ? parseFloat(row.pnl_percent) : null,
          rMultiple: row.r_multiple ? parseFloat(row.r_multiple) : null,
          discordAlerted: row.discord_alerted,
          timeframe: row.timeframe,
          // Legacy field mappings for backward compatibility
          alertId: row.trade_id,
          stopLoss: parseFloat(row.stop_price),
          alertTime: row.entry_time,
          alertedAt: row.entry_time,
          zoneStart: row.entry_time,
          retestDate: row.exit_time,
          retestPrice: row.exit_price ? parseFloat(row.exit_price) : null,
          close5d: row.exit_price ? parseFloat(row.exit_price) : null,
          return5d: row.pnl_percent ? parseFloat(row.pnl_percent) : null,
          adjustedReturn: row.pnl_percent ? parseFloat(row.pnl_percent) : null,
        })),
        summary: {
          totalTrades: trades.length,
          closedTrades: closedTrades.length,
          openTrades: trades.length - closedTrades.length,
          wins,
          losses,
          breakevens,
          winRate: winRate.toFixed(1),
          totalPnlPercent: totalPnlPercent.toFixed(2),
          avgPnlPercent: avgPnlPercent.toFixed(2),
          totalRMultiple: totalRMultiple.toFixed(2),
          avgRMultiple: avgRMultiple.toFixed(2),
          // Legacy field mappings for backward compatibility
          totalReturn: totalPnlPercent.toFixed(2),
          avgReturn: avgPnlPercent.toFixed(2),
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
