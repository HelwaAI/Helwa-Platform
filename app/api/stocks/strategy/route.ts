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
        COUNT(CASE WHEN zfr.zone_id IS NULL THEN 1 END) as fresh_zones,
        COUNT(CASE WHEN zfr.zone_id IS NOT NULL THEN 1 END) as tested_zones,
        AVG(z.top_price - z.bottom_price) as avg_zone_height
    FROM stocks.zones z
    JOIN stocks.timeframes t ON z.timeframe_id = t.id
    LEFT JOIN stocks.zone_first_retests_cache zfr ON z.zone_id = zfr.zone_id
    WHERE z.start_time >= NOW() - INTERVAL '90 days'
    ${symbol ? 'AND z.symbol_id = (SELECT id FROM stocks.symbols WHERE symbol = $1)' : ''}
    GROUP BY z.zone_type, t.label
    ORDER BY z.zone_type, t.label
    `;

    const zoneStatsParams = symbol ? [symbol] : [];
    const zoneStatsResult = await pool.query(zoneStatsQuery, zoneStatsParams);

    // Query 2: Kelly Parameters - win rate and R-multiple by zone type
    const kellyQuery = `
    WITH trade_data AS (
        SELECT
            z.zone_type,
            zfr.bounce_close as entry_price,
            zfr.zone_low,
            zfr.zone_high,
            zfr.close_5d,
            CASE
                WHEN z.zone_type = 'demand' THEN zfr.bounce_close - zfr.zone_low
                ELSE zfr.zone_high - zfr.bounce_close
            END as risk_points,
            CASE
                WHEN z.zone_type = 'demand' THEN zfr.close_5d - zfr.bounce_close
                ELSE zfr.bounce_close - zfr.close_5d
            END as pnl_points
        FROM stocks.zone_first_retests_cache zfr
        JOIN stocks.zones z ON zfr.zone_id = z.zone_id
        WHERE zfr.bounce_day >= '2025-01-01'
          AND zfr.close_5d IS NOT NULL
          AND zfr.bounce_close > 0
          AND CASE
              WHEN z.zone_type = 'demand' THEN zfr.bounce_close > zfr.zone_low
              ELSE zfr.zone_high > zfr.bounce_close
          END
    ),
    r_multiples AS (
        SELECT
            zone_type,
            pnl_points / NULLIF(risk_points, 0) as r_multiple,
            CASE WHEN pnl_points > 0 THEN 1 ELSE 0 END as is_win
        FROM trade_data
        WHERE risk_points > 0
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
        DATE_TRUNC('day', zfr.bounce_day) as day,
        z.zone_type,
        COUNT(*) as trades,
        SUM(CASE
            WHEN z.zone_type = 'demand' AND zfr.return_5d > 0 THEN 1
            WHEN z.zone_type = 'supply' AND zfr.return_5d < 0 THEN 1
            ELSE 0
        END) as wins,
        ROUND(AVG(CASE
            WHEN z.zone_type = 'demand' THEN zfr.return_5d
            ELSE -zfr.return_5d
        END)::numeric, 2) as avg_return
    FROM stocks.zone_first_retests_cache zfr
    JOIN stocks.zones z ON zfr.zone_id = z.zone_id
    WHERE zfr.bounce_day >= NOW() - INTERVAL '30 days'
      AND zfr.return_5d IS NOT NULL
    GROUP BY DATE_TRUNC('day', zfr.bounce_day), z.zone_type
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
    FROM stocks.zones z
    JOIN stocks.symbols s ON z.symbol_id = s.id
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
