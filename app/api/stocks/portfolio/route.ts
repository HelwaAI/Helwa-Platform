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

/**
 * Calculate Sharpe Ratio from returns
 * Sharpe = (Mean Return - Risk Free Rate) / Std Dev of Returns
 */
function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0.05): number {
  if (returns.length < 2) return 0;

  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize: assuming 5-day holding periods, ~52 periods/year
  const periodsPerYear = 52;
  const annualizedReturn = meanReturn * periodsPerYear;
  const annualizedStdDev = stdDev * Math.sqrt(periodsPerYear);

  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

/**
 * Calculate Information Ratio vs benchmark
 * IR = (Portfolio Return - Benchmark Return) / Tracking Error
 */
function calculateInformationRatio(portfolioReturns: number[], benchmarkReturns: number[]): number {
  if (portfolioReturns.length < 2 || portfolioReturns.length !== benchmarkReturns.length) return 0;

  const excessReturns = portfolioReturns.map((r, i) => r - benchmarkReturns[i]);
  const meanExcess = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const variance = excessReturns.reduce((sum, r) => sum + Math.pow(r - meanExcess, 2), 0) / (excessReturns.length - 1);
  const trackingError = Math.sqrt(variance);

  if (trackingError === 0) return 0;

  // Annualize
  const periodsPerYear = 52;
  return (meanExcess * periodsPerYear) / (trackingError * Math.sqrt(periodsPerYear));
}

/**
 * Calculate Maximum Drawdown
 */
function calculateMaxDrawdown(cumulativeReturns: number[]): number {
  if (cumulativeReturns.length === 0) return 0;

  let peak = cumulativeReturns[0];
  let maxDrawdown = 0;

  for (const value of cumulativeReturns) {
    if (value > peak) peak = value;
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown * 100; // Return as percentage
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');

  try {
    // Query trades with outcomes
    let query = `
    WITH trade_returns AS (
        SELECT
            za.alerted_at::date as trade_date,
            z.zone_type,
            CASE
                WHEN z.zone_type = 'demand' THEN zfr.return_5d
                ELSE -zfr.return_5d
            END as adjusted_return,
            CASE
                WHEN z.zone_type = 'demand' THEN
                    CASE WHEN zfr.return_5d > 0 THEN 1 ELSE 0 END
                ELSE
                    CASE WHEN zfr.return_5d < 0 THEN 1 ELSE 0 END
            END as is_win
        FROM stocks.zone_alerts za
        JOIN stocks.zones z ON za.zone_id = z.zone_id
        LEFT JOIN stocks.zone_first_retests_cache zfr ON z.zone_id = zfr.zone_id
        WHERE za.alerted_at IS NOT NULL
          AND zfr.return_5d IS NOT NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND za.alerted_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND za.alerted_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += `)
    SELECT
        trade_date,
        zone_type,
        adjusted_return,
        is_win
    FROM trade_returns
    ORDER BY trade_date
    `;

    const result = await pool.query(query, params);
    const trades = result.rows;

    // Calculate portfolio metrics
    const returns = trades.map((t: any) => parseFloat(t.adjusted_return) / 100); // Convert to decimal
    const wins = trades.filter((t: any) => t.is_win === 1).length;
    const totalTrades = trades.length;

    // Calculate cumulative returns (for drawdown)
    let cumulative = 1;
    const cumulativeReturns = returns.map((r: number) => {
      cumulative *= (1 + r);
      return cumulative;
    });

    // Get S&P 500 benchmark returns for the same period (simplified - using fixed benchmark)
    // In production, you'd query actual S&P 500 data
    const benchmarkReturns = returns.map(() => 0.001); // Placeholder ~0.1% per period

    const totalReturn = cumulativeReturns.length > 0
      ? (cumulativeReturns[cumulativeReturns.length - 1] - 1) * 100
      : 0;

    const sharpeRatio = calculateSharpeRatio(returns);
    const informationRatio = calculateInformationRatio(returns, benchmarkReturns);
    const maxDrawdown = calculateMaxDrawdown(cumulativeReturns);
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const avgReturn = returns.length > 0
      ? (returns.reduce((a: number, b: number) => a + b, 0) / returns.length) * 100
      : 0;

    // Calculate by zone type
    const demandTrades = trades.filter((t: any) => t.zone_type === 'demand');
    const supplyTrades = trades.filter((t: any) => t.zone_type === 'supply');

    const demandWins = demandTrades.filter((t: any) => t.is_win === 1).length;
    const supplyWins = supplyTrades.filter((t: any) => t.is_win === 1).length;

    const demandReturns = demandTrades.map((t: any) => parseFloat(t.adjusted_return));
    const supplyReturns = supplyTrades.map((t: any) => parseFloat(t.adjusted_return));

    // Portfolio configuration (from IBKR_CONFIG)
    const portfolioConfig = {
      stockPortfolio: 10000,
      optionsPortfolio: 10000,
      useKellySizing: true,
    };

    return NextResponse.json({
      success: true,
      data: {
        // Overall Performance
        performance: {
          totalReturn: totalReturn.toFixed(2),
          sharpeRatio: sharpeRatio.toFixed(2),
          informationRatio: informationRatio.toFixed(2),
          maxDrawdown: maxDrawdown.toFixed(2),
          winRate: winRate.toFixed(1),
          avgReturn: avgReturn.toFixed(2),
          totalTrades,
          wins,
          losses: totalTrades - wins,
        },

        // By Zone Type
        byZoneType: {
          demand: {
            trades: demandTrades.length,
            wins: demandWins,
            winRate: demandTrades.length > 0 ? ((demandWins / demandTrades.length) * 100).toFixed(1) : '0.0',
            totalReturn: demandReturns.reduce((a, b) => a + b, 0).toFixed(2),
            avgReturn: demandReturns.length > 0
              ? (demandReturns.reduce((a, b) => a + b, 0) / demandReturns.length).toFixed(2)
              : '0.00',
          },
          supply: {
            trades: supplyTrades.length,
            wins: supplyWins,
            winRate: supplyTrades.length > 0 ? ((supplyWins / supplyTrades.length) * 100).toFixed(1) : '0.0',
            totalReturn: supplyReturns.reduce((a, b) => a + b, 0).toFixed(2),
            avgReturn: supplyReturns.length > 0
              ? (supplyReturns.reduce((a, b) => a + b, 0) / supplyReturns.length).toFixed(2)
              : '0.00',
          },
        },

        // Equity Curve (cumulative returns over time)
        equityCurve: trades.map((t: any, i: number) => ({
          date: t.trade_date,
          cumulative: cumulativeReturns[i] ? ((cumulativeReturns[i] - 1) * 100).toFixed(2) : '0.00',
        })),

        // Portfolio Configuration
        config: portfolioConfig,
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
