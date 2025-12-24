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

  try {
    // Query 1: Zone Statistics - active zones by type and timeframe
    const zoneStatsQuery = `
    SELECT
        z.zone_type,
        t.label as timeframe,
        COUNT(*) as zone_count,
        COUNT(*) as fresh_zones,
        0 as tested_zones,
        AVG(z.top_price - z.bottom_price) as avg_zone_height
    FROM crypto.zones z
    JOIN crypto.timeframes t ON z.timeframe_id = t.id
    ${symbol ? 'JOIN crypto.symbols s ON z.symbol_id = s.id' : ''}
    WHERE z.start_time >= NOW() - INTERVAL '90 days'
    ${symbol ? 'AND s.symbol = $1' : ''}
    GROUP BY z.zone_type, t.label
    ORDER BY z.zone_type, t.label
    `;

    const zoneStatsParams = symbol ? [symbol] : [];
    const zoneStatsResult = await pool.query(zoneStatsQuery, zoneStatsParams);

    // Query 2: Kelly Parameters - win rate and R-multiple by zone type from historical trades
    const kellyQuery = `
    WITH trade_data AS (
        SELECT
            ht.zone_type,
            ht.entry_price,
            ht.stop_price,
            ht.exit_price,
            ht.outcome,
            ht.r_multiple,
            CASE
                WHEN ht.zone_type = 'demand' THEN ht.entry_price - ht.stop_price
                ELSE ht.stop_price - ht.entry_price
            END as risk_points,
            CASE
                WHEN ht.zone_type = 'demand' THEN ht.exit_price - ht.entry_price
                ELSE ht.entry_price - ht.exit_price
            END as pnl_points
        FROM crypto.historical_trades ht
        WHERE ht.outcome IS NOT NULL
          AND ht.exit_price IS NOT NULL
          AND ht.r_multiple IS NOT NULL
    ),
    r_multiples AS (
        SELECT
            zone_type,
            r_multiple,
            CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END as is_win
        FROM trade_data
        WHERE r_multiple IS NOT NULL
    )
    SELECT
        zone_type,
        COUNT(*) as num_trades,
        ROUND(AVG(is_win)::numeric, 4) as win_rate,
        ROUND(AVG(CASE WHEN is_win = 1 THEN r_multiple END)::numeric, 2) as avg_win_r,
        ROUND(ABS(AVG(CASE WHEN is_win = 0 THEN r_multiple END))::numeric, 2) as avg_loss_r,
        ROUND((AVG(is_win) - (1 - AVG(is_win)) / NULLIF(
            AVG(CASE WHEN is_win = 1 THEN r_multiple END) /
            NULLIF(ABS(AVG(CASE WHEN is_win = 0 THEN r_multiple END)), 0)
        , 0))::numeric, 4) as kelly_fraction
    FROM r_multiples
    GROUP BY zone_type
    `;

    const kellyResult = await pool.query(kellyQuery);

    // Query 3: Recent Zone Performance - last 30 days
    const recentPerfQuery = `
    SELECT
        DATE_TRUNC('day', ht.entry_time) as day,
        ht.zone_type,
        COUNT(*) as trades,
        SUM(CASE WHEN ht.outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
        ROUND(AVG(ht.pnl_percent)::numeric, 2) as avg_return
    FROM crypto.historical_trades ht
    WHERE ht.entry_time >= NOW() - INTERVAL '30 days'
      AND ht.outcome IS NOT NULL
      AND ht.pnl_percent IS NOT NULL
    GROUP BY DATE_TRUNC('day', ht.entry_time), ht.zone_type
    ORDER BY day DESC
    `;

    const recentPerfResult = await pool.query(recentPerfQuery);

    // Query 4: Supply/Demand Imbalance by Symbol
    const imbalanceQuery = `
    SELECT
        s.symbol,
        COUNT(CASE WHEN z.zone_type = 'demand' THEN 1 END) as demand_zones,
        COUNT(CASE WHEN z.zone_type = 'supply' THEN 1 END) as supply_zones,
        COUNT(CASE WHEN z.zone_type = 'demand' THEN 1 END) -
        COUNT(CASE WHEN z.zone_type = 'supply' THEN 1 END) as imbalance,
        CASE
            WHEN COUNT(CASE WHEN z.zone_type = 'demand' THEN 1 END) >
                 COUNT(CASE WHEN z.zone_type = 'supply' THEN 1 END) THEN 'BULLISH'
            WHEN COUNT(CASE WHEN z.zone_type = 'demand' THEN 1 END) <
                 COUNT(CASE WHEN z.zone_type = 'supply' THEN 1 END) THEN 'BEARISH'
            ELSE 'NEUTRAL'
        END as bias
    FROM crypto.zones z
    JOIN crypto.symbols s ON z.symbol_id = s.id
    WHERE z.start_time >= NOW() - INTERVAL '30 days'
    ${symbol ? 'AND s.symbol = $1' : ''}
    GROUP BY s.symbol
    ORDER BY ABS(COUNT(CASE WHEN z.zone_type = 'demand' THEN 1 END) -
                 COUNT(CASE WHEN z.zone_type = 'supply' THEN 1 END)) DESC
    LIMIT 20
    `;

    const imbalanceParams = symbol ? [symbol] : [];
    const imbalanceResult = await pool.query(imbalanceQuery, imbalanceParams);

    // Process zone statistics
    const zoneStats: Record<string, any> = {};
    for (const row of zoneStatsResult.rows) {
      const zoneType = row.zone_type;
      if (!zoneStats[zoneType]) {
        zoneStats[zoneType] = {
          total: 0,
          fresh: 0,
          tested: 0,
          byTimeframe: {},
        };
      }
      zoneStats[zoneType].total += parseInt(row.zone_count);
      zoneStats[zoneType].fresh += parseInt(row.fresh_zones);
      zoneStats[zoneType].tested += parseInt(row.tested_zones);
      zoneStats[zoneType].byTimeframe[row.timeframe] = {
        count: parseInt(row.zone_count),
        fresh: parseInt(row.fresh_zones),
        tested: parseInt(row.tested_zones),
        avgHeight: parseFloat(row.avg_zone_height).toFixed(2),
      };
    }

    // Process Kelly parameters
    const kellyParams: Record<string, any> = {};
    for (const row of kellyResult.rows) {
      kellyParams[row.zone_type] = {
        numTrades: parseInt(row.num_trades),
        winRate: (parseFloat(row.win_rate) * 100).toFixed(1),
        avgWinR: parseFloat(row.avg_win_r) || 0,
        avgLossR: parseFloat(row.avg_loss_r) || 0,
        kellyFraction: ((parseFloat(row.kelly_fraction) || 0) * 100).toFixed(1),
        halfKelly: ((parseFloat(row.kelly_fraction) || 0) * 50).toFixed(1),
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        // Zone Statistics by Type
        zoneStats,

        // Kelly Parameters for Position Sizing
        kellyParams,

        // Recent Performance (last 30 days)
        recentPerformance: recentPerfResult.rows.map((row: any) => ({
          day: row.day,
          zoneType: row.zone_type,
          trades: parseInt(row.trades),
          wins: parseInt(row.wins),
          avgReturn: parseFloat(row.avg_return),
        })),

        // Supply/Demand Imbalance by Symbol
        imbalance: imbalanceResult.rows.map((row: any) => ({
          symbol: row.symbol,
          demandZones: parseInt(row.demand_zones),
          supplyZones: parseInt(row.supply_zones),
          imbalance: parseInt(row.imbalance),
          bias: row.bias,
        })),

        // Strategy Overview
        summary: {
          totalDemandZones: zoneStats.demand?.total || 0,
          totalSupplyZones: zoneStats.supply?.total || 0,
          freshDemandZones: zoneStats.demand?.fresh || 0,
          freshSupplyZones: zoneStats.supply?.fresh || 0,
          demandWinRate: kellyParams.demand?.winRate || '0.0',
          supplyWinRate: kellyParams.supply?.winRate || '0.0',
          demandKelly: kellyParams.demand?.halfKelly || '0.0',
          supplyKelly: kellyParams.supply?.halfKelly || '0.0',
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
