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

// Trading bot backtest API endpoint
// This calls the Python backtest API running in the trading_bot
const BACKTEST_API_URL = process.env.BACKTEST_API_URL || 'http://localhost:5001';

/**
 * GET /api/stocks/backtest
 *
 * Get available symbols for backtesting
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'symbols') {
      // Get symbols with second_aggregates data (suitable for second-by-second backtesting)
      const query = `
        SELECT DISTINCT s.symbol, s.id, s.company_name
        FROM stocks.second_aggregates sa
        JOIN stocks.symbols s ON sa.symbol_id = s.id
        ORDER BY s.symbol
      `;
      const result = await pool.query(query);

      return NextResponse.json({
        success: true,
        symbols: result.rows.map(row => ({
          symbol: row.symbol,
          id: row.id,
          name: row.company_name
        })),
        count: result.rows.length
      });
    }

    if (action === 'date-range') {
      const symbol = searchParams.get('symbol');
      if (!symbol) {
        return NextResponse.json(
          { success: false, error: 'symbol parameter required' },
          { status: 400 }
        );
      }

      // Get available date range for a symbol's second_aggregates data
      const query = `
        SELECT
          MIN(timestamp)::date as min_date,
          MAX(timestamp)::date as max_date,
          COUNT(*) as bar_count
        FROM stocks.second_aggregates sa
        JOIN stocks.symbols s ON sa.symbol_id = s.id
        WHERE s.symbol = $1
      `;
      const result = await pool.query(query, [symbol]);

      if (result.rows.length === 0 || !result.rows[0].min_date) {
        return NextResponse.json({
          success: false,
          error: `No data found for symbol: ${symbol}`
        }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        symbol,
        min_date: result.rows[0].min_date,
        max_date: result.rows[0].max_date,
        bar_count: parseInt(result.rows[0].bar_count)
      });
    }

    if (action === 'zones') {
      const symbol = searchParams.get('symbol');
      const startDate = searchParams.get('start_date');
      const endDate = searchParams.get('end_date');

      if (!symbol) {
        return NextResponse.json(
          { success: false, error: 'symbol parameter required' },
          { status: 400 }
        );
      }

      // Get zones for the symbol in date range
      let query = `
        SELECT
          z.id as zone_id,
          z.zone_type,
          z.bottom_price,
          z.top_price,
          z.start_time as created_at,
          tf.label as timeframe,
          COALESCE(z.strength, 1.0) as strength
        FROM stocks.zones z
        JOIN stocks.symbols s ON z.symbol_id = s.id
        JOIN stocks.timeframes tf ON z.timeframe_id = tf.id
        WHERE s.symbol = $1
          AND z.is_active = true
      `;

      const params: any[] = [symbol];

      if (startDate) {
        params.push(startDate);
        query += ` AND z.start_time >= $${params.length}::date`;
      }
      if (endDate) {
        params.push(endDate);
        query += ` AND z.start_time <= $${params.length}::date`;
      }

      query += ' ORDER BY z.start_time';

      const result = await pool.query(query, params);

      return NextResponse.json({
        success: true,
        symbol,
        zones: result.rows,
        count: result.rows.length
      });
    }

    // Default: return API info
    return NextResponse.json({
      success: true,
      api: 'Retest Backtest API',
      version: '1.0',
      endpoints: {
        'GET ?action=symbols': 'List available symbols for backtesting',
        'GET ?action=date-range&symbol=AAPL': 'Get date range for a symbol',
        'GET ?action=zones&symbol=AAPL': 'Get zones for a symbol',
        'POST': 'Run a backtest (see body parameters)'
      }
    });

  } catch (error: any) {
    console.error('Backtest API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stocks/backtest
 *
 * Run a backtest with the given parameters
 *
 * Body parameters:
 * - symbol: Stock symbol (single) OR symbols: Array of symbols (multi-symbol mode)
 * - start_date: Start date YYYY-MM-DD (required)
 * - end_date: End date YYYY-MM-DD (required)
 * - initial_capital: Starting capital (default: 10000)
 * - max_positions: Maximum concurrent positions (default: 3)
 * - min_risk_reward: Minimum risk/reward ratio (default: 3.0)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Support both single symbol and array of symbols
    const symbols: string[] = body.symbols || (body.symbol ? [body.symbol] : []);

    if (symbols.length === 0) {
      return NextResponse.json(
        { success: false, error: 'symbol or symbols is required' },
        { status: 400 }
      );
    }
    if (!body.start_date) {
      return NextResponse.json(
        { success: false, error: 'start_date is required' },
        { status: 400 }
      );
    }
    if (!body.end_date) {
      return NextResponse.json(
        { success: false, error: 'end_date is required' },
        { status: 400 }
      );
    }

    // Try to call the Rust backtest API for single symbol
    if (symbols.length === 1) {
      try {
        const response = await fetch(`${BACKTEST_API_URL}/api/backtest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, symbol: symbols[0] }),
        });

        if (response.ok) {
          const results = await response.json();
          return NextResponse.json({
            success: true,
            engine: 'rust',
            results
          });
        }
      } catch (apiError) {
        console.log('Rust backtest API not available, using database fallback');
      }
    }

    // Run multi-symbol backtest using database queries
    const results = await runMultiSymbolBacktest({
      ...body,
      symbols
    });

    return NextResponse.json({
      success: true,
      engine: 'database',
      mode: symbols.length > 1 ? 'multi-symbol' : 'single-symbol',
      results
    });

  } catch (error: any) {
    console.error('Backtest error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * Calculate Kelly criterion parameters from historical data
 */
async function calculateKellyParams(symbol: string, zoneType: string): Promise<{
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  kellyFraction: number;
  halfKellyFraction: number;
  numTrades: number;
}> {
  const zoneFilter = zoneType.toUpperCase() === 'ALL' ? '' : "AND z.zone_type = $1";
  const queryParams = zoneType.toUpperCase() === 'ALL' ? [] : [zoneType];

  const query = `
    WITH trade_data AS (
      SELECT
        c.zone_id,
        c.symbol,
        z.zone_type,
        c.bounce_close as entry_price,
        c.zone_low,
        c.zone_high,
        c.close_5d as exit_price,
        CASE
          WHEN z.zone_type = 'demand' THEN c.bounce_close - c.zone_low
          WHEN z.zone_type = 'supply' THEN c.zone_high - c.bounce_close
        END as risk_points,
        CASE
          WHEN z.zone_type = 'demand' THEN c.close_5d - c.bounce_close
          WHEN z.zone_type = 'supply' THEN c.bounce_close - c.close_5d
        END as pnl_points
      FROM stocks.zone_first_retests_cache c
      JOIN stocks.zones z ON c.zone_id = z.zone_id
      WHERE c.bounce_day >= '2024-01-01'
        AND c.close_5d IS NOT NULL
        AND c.bounce_close IS NOT NULL
        AND c.bounce_close > 0
        ${zoneFilter}
        AND CASE
            WHEN z.zone_type = 'demand' THEN c.bounce_close > c.zone_low
            WHEN z.zone_type = 'supply' THEN c.zone_high > c.bounce_close
        END
    ),
    r_multiples AS (
      SELECT
        zone_id,
        symbol,
        zone_type,
        entry_price,
        risk_points,
        pnl_points,
        CASE WHEN risk_points > 0 THEN pnl_points / risk_points ELSE NULL END as r_multiple,
        CASE WHEN pnl_points > 0 THEN 1 ELSE 0 END as is_win
      FROM trade_data
      WHERE risk_points > 0
    )
    SELECT
      COUNT(*) as num_trades,
      COALESCE(AVG(is_win), 0) as win_rate,
      COALESCE(AVG(CASE WHEN is_win = 1 THEN r_multiple END), 0) as avg_win_r,
      COALESCE(ABS(AVG(CASE WHEN is_win = 0 THEN r_multiple END)), 1) as avg_loss_r
    FROM r_multiples
  `;

  const result = await pool.query(query, queryParams);
  const row = result.rows[0];

  if (!row || row.num_trades === 0) {
    return {
      winRate: 0.5,
      avgWinR: 1.0,
      avgLossR: 1.0,
      kellyFraction: 0.0,
      halfKellyFraction: 0.0,
      numTrades: 0
    };
  }

  const winRate = parseFloat(row.win_rate);
  const avgWinR = parseFloat(row.avg_win_r);
  const avgLossR = parseFloat(row.avg_loss_r);
  const numTrades = parseInt(row.num_trades);

  // Kelly = W - (1-W)/b where b = avg_win/avg_loss
  const b = avgLossR > 0 ? avgWinR / avgLossR : 1;
  let kelly = b > 0 ? winRate - (1 - winRate) / b : 0;
  kelly = Math.max(0, Math.min(kelly, 0.25)); // Cap at 25%

  return {
    winRate,
    avgWinR,
    avgLossR,
    kellyFraction: kelly,
    halfKellyFraction: kelly / 2,
    numTrades
  };
}

interface OpenPosition {
  zone_id: string;
  symbol: string;
  zone_type: string;
  direction: string;
  entry_time: string;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  shares: number;
  capital_deployed: number;
  risk_amount: number;
}

/**
 * Run a backtest using database data with proper Kelly sizing and position management
 *
 * Key features:
 * - Kelly position sizing (Half-Kelly % of portfolio per position)
 * - Capital tracking (can't enter new trades if fully allocated)
 * - Stop/Target exit logic based on price data
 * - Multiple concurrent positions supported
 */
async function runDatabaseBacktest(params: any) {
  const {
    symbol,
    start_date,
    end_date,
    initial_capital = 10000,
    min_risk_reward = 3.0,
    max_positions = 3
  } = params;

  // Step 1: Calculate Kelly parameters for position sizing
  const kellyParams = await calculateKellyParams(symbol, 'ALL');
  const halfKelly = Math.max(kellyParams.halfKellyFraction, 0.05); // Minimum 5%
  console.log(`Kelly params: Win=${(kellyParams.winRate * 100).toFixed(1)}%, AvgWin=${kellyParams.avgWinR.toFixed(2)}R, HalfKelly=${(halfKelly * 100).toFixed(1)}%`);

  // Step 2: Query all retest events with price history for stop/target checking
  const retestQuery = `
    SELECT
      rc.zone_id,
      rc.retest_time as entry_time,
      rc.bounce_close as entry_price,
      z.zone_type,
      rc.zone_low as bottom_price,
      rc.zone_high as top_price,
      rc.close_1d, rc.close_2d, rc.close_3d, rc.close_5d, rc.close_10d, rc.close_20d
    FROM stocks.zone_first_retests_cache rc
    JOIN stocks.zones z ON rc.zone_id = z.zone_id
    WHERE rc.symbol = $1
      AND rc.retest_time >= $2::date
      AND rc.retest_time <= $3::date
      AND rc.bounce_close IS NOT NULL
    ORDER BY rc.retest_time, rc.zone_id
  `;

  const result = await pool.query(retestQuery, [symbol, start_date, end_date]);
  const retests = result.rows;

  if (retests.length === 0) {
    return createEmptyResults(initial_capital);
  }

  // Portfolio state
  let cash = initial_capital;
  let equity = initial_capital;
  let maxEquity = initial_capital;
  let maxDrawdown = 0;
  const openPositions: Map<string, OpenPosition> = new Map();
  const closedTrades: any[] = [];
  const equityCurve: Array<[string, number]> = [[start_date, initial_capital]];

  // Process each retest chronologically
  for (const retest of retests) {
    const entryTime = retest.entry_time;
    const entryPrice = parseFloat(retest.entry_price);
    const zoneType = retest.zone_type;
    const zoneId = retest.zone_id.toString();

    // First: Check if any open positions hit stop or target
    // We use the closing prices at different holding periods to simulate price movement
    const closePrices = [
      entryPrice, // Day 0 (entry day)
      parseFloat(retest.close_1d) || entryPrice,
      parseFloat(retest.close_2d) || entryPrice,
      parseFloat(retest.close_3d) || entryPrice,
      parseFloat(retest.close_5d) || entryPrice,
      parseFloat(retest.close_10d) || entryPrice,
      parseFloat(retest.close_20d) || entryPrice
    ];

    // Check and close any positions that have hit stop/target
    const positionsToClose: string[] = [];
    for (const [posId, pos] of openPositions) {
      let exitPrice: number | null = null;
      let exitReason: string = '';
      let daysHeld = 0;

      // Check each day's close for stop/target hit
      for (let day = 1; day <= 20; day++) {
        const dayIndex = day <= 3 ? day : day <= 5 ? 3 : day <= 10 ? 4 : 5;
        const closePrice = closePrices[dayIndex];
        if (!closePrice || closePrice <= 0) continue;

        if (pos.zone_type === 'demand') {
          // Long position: stop below entry, target above
          if (closePrice <= pos.stop_loss) {
            exitPrice = pos.stop_loss;
            exitReason = 'Stop Loss';
            daysHeld = day;
            break;
          } else if (closePrice >= pos.target_price) {
            exitPrice = pos.target_price;
            exitReason = 'Target Hit';
            daysHeld = day;
            break;
          }
        } else {
          // Short position: stop above entry, target below
          if (closePrice >= pos.stop_loss) {
            exitPrice = pos.stop_loss;
            exitReason = 'Stop Loss';
            daysHeld = day;
            break;
          } else if (closePrice <= pos.target_price) {
            exitPrice = pos.target_price;
            exitReason = 'Target Hit';
            daysHeld = day;
            break;
          }
        }
      }

      // Only close if stop or target was hit (not time-based exit here)
      if (exitPrice !== null) {
        // Calculate P&L
        let pnl: number;
        if (pos.zone_type === 'demand') {
          pnl = (exitPrice - pos.entry_price) * pos.shares;
        } else {
          pnl = (pos.entry_price - exitPrice) * pos.shares;
        }

        const rMultiple = pos.risk_amount > 0 ? pnl / pos.risk_amount : 0;

        // Calculate exit time by adding daysHeld to entry_time
        const entryDate = new Date(pos.entry_time);
        const exitDate = new Date(entryDate);
        exitDate.setDate(exitDate.getDate() + daysHeld);

        closedTrades.push({
          zone_id: pos.zone_id,
          symbol: pos.symbol,
          zone_type: pos.zone_type,
          direction: pos.direction,
          entry_time: pos.entry_time,
          exit_time: exitDate.toISOString().split('T')[0],
          entry_price: pos.entry_price,
          exit_price: exitPrice,
          stop_loss: pos.stop_loss,
          target_price: pos.target_price,
          shares: pos.shares,
          capital_deployed: pos.capital_deployed,
          pnl,
          pnl_pct: pos.capital_deployed > 0 ? (pnl / pos.capital_deployed) * 100 : 0,
          r_multiple: rMultiple,
          status: pnl > 0 ? 'Win' : 'Loss',
          exit_reason: exitReason,
          days_held: daysHeld
        });

        // Return capital to cash
        cash += pos.capital_deployed + pnl;
        positionsToClose.push(posId);
      }
    }

    // Remove closed positions (after iteration to avoid mutation during iteration)
    for (const posId of positionsToClose) {
      openPositions.delete(posId);
    }

    // Check if we can open a new position
    if (openPositions.size >= max_positions) {
      continue; // Skip - max positions reached
    }

    // Calculate stop loss and target for new position
    const bottomPrice = parseFloat(retest.bottom_price);
    const topPrice = parseFloat(retest.top_price);
    let stopLoss: number;
    let targetPrice: number;
    let riskPerShare: number;

    if (zoneType === 'demand') {
      stopLoss = bottomPrice * 0.99; // 1% below zone
      riskPerShare = entryPrice - stopLoss;
      targetPrice = entryPrice + (riskPerShare * min_risk_reward);
    } else {
      stopLoss = topPrice * 1.01; // 1% above zone
      riskPerShare = stopLoss - entryPrice;
      targetPrice = entryPrice - (riskPerShare * min_risk_reward);
    }

    if (riskPerShare <= 0) continue;

    // Kelly position sizing: deploy Half-Kelly % of total equity
    const currentEquity = cash + Array.from(openPositions.values())
      .reduce((sum, p) => sum + p.capital_deployed, 0);
    const capitalToDeployTarget = currentEquity * halfKelly;
    const capitalToDeployActual = Math.min(capitalToDeployTarget, cash);

    if (capitalToDeployActual < 100) continue; // Minimum $100 position

    const shares = Math.floor(capitalToDeployActual / entryPrice);
    if (shares <= 0) continue;

    const capitalDeployed = shares * entryPrice;
    const riskAmount = shares * riskPerShare;

    // Deduct capital from cash
    cash -= capitalDeployed;

    // Open position
    const newPosition: OpenPosition = {
      zone_id: zoneId,
      symbol,
      zone_type: zoneType,
      direction: zoneType === 'demand' ? 'Long' : 'Short',
      entry_time: entryTime,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      target_price: targetPrice,
      shares,
      capital_deployed: capitalDeployed,
      risk_amount: riskAmount
    };
    openPositions.set(zoneId, newPosition);

    // Update equity curve
    equity = cash + Array.from(openPositions.values())
      .reduce((sum, p) => sum + p.capital_deployed, 0);
    equityCurve.push([entryTime, equity]);

    if (equity > maxEquity) maxEquity = equity;
    const drawdown = maxEquity - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Close any remaining open positions at their last known price
  for (const [posId, pos] of openPositions) {
    const exitPrice = pos.entry_price; // Close at entry if no price data
    const pnl = 0; // Assume breakeven for remaining

    closedTrades.push({
      zone_id: pos.zone_id,
      symbol: pos.symbol,
      zone_type: pos.zone_type,
      direction: pos.direction,
      entry_time: pos.entry_time,
      exit_time: end_date,
      entry_price: pos.entry_price,
      exit_price: exitPrice,
      stop_loss: pos.stop_loss,
      target_price: pos.target_price,
      shares: pos.shares,
      capital_deployed: pos.capital_deployed,
      pnl,
      pnl_pct: 0,
      r_multiple: 0,
      status: 'Open',
      exit_reason: 'End of Backtest',
      days_held: 0
    });

    cash += pos.capital_deployed;
  }

  // Final equity
  equity = cash;
  equityCurve.push([end_date, equity]);

  // Calculate summary statistics
  const completedTrades = closedTrades.filter(t => t.status !== 'Open');
  const winningTrades = completedTrades.filter(t => t.pnl > 0);
  const losingTrades = completedTrades.filter(t => t.pnl < 0);

  const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const totalPnl = totalWins - totalLosses;

  const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  const winRate = completedTrades.length > 0 ? winningTrades.length / completedTrades.length : 0;
  const totalReturnPct = ((equity - initial_capital) / initial_capital) * 100;
  const maxDrawdownPct = maxEquity > 0 ? (maxDrawdown / maxEquity) * 100 : 0;

  // Sharpe ratio
  const returns = equityCurve.map((point, i) =>
    i > 0 ? (point[1] - equityCurve[i-1][1]) / equityCurve[i-1][1] : 0
  ).slice(1);

  let sharpeRatio = 0;
  if (returns.length > 1) {
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpeRatio = (meanReturn / stdDev) * Math.sqrt(252);
    }
  }

  const avgRMultiple = completedTrades.length > 0
    ? completedTrades.reduce((sum, t) => sum + (t.r_multiple || 0), 0) / completedTrades.length
    : 0;

  return {
    total_trades: closedTrades.length,
    winning_trades: winningTrades.length,
    losing_trades: losingTrades.length,
    win_rate: winRate,
    total_pnl: totalPnl,
    total_return_pct: totalReturnPct,
    avg_win: avgWin,
    avg_loss: avgLoss,
    profit_factor: profitFactor,
    max_drawdown: maxDrawdown,
    max_drawdown_pct: maxDrawdownPct,
    sharpe_ratio: sharpeRatio,
    avg_r_multiple: avgRMultiple,
    final_capital: equity,
    kelly_params: {
      win_rate: kellyParams.winRate,
      avg_win_r: kellyParams.avgWinR,
      avg_loss_r: kellyParams.avgLossR,
      half_kelly_pct: halfKelly * 100,
      sample_size: kellyParams.numTrades
    },
    trades: closedTrades,
    equity_curve: equityCurve
  };
}

function createEmptyResults(initial_capital: number, symbols: string[] = []) {
  return {
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    win_rate: 0,
    total_pnl: 0,
    total_return_pct: 0,
    avg_win: 0,
    avg_loss: 0,
    profit_factor: 0,
    max_drawdown: 0,
    max_drawdown_pct: 0,
    sharpe_ratio: 0,
    avg_r_multiple: 0,
    final_capital: initial_capital,
    kelly_params: null,
    symbols_traded: symbols,
    trades: [],
    equity_curve: []
  };
}

interface RetestEvent {
  zone_id: string;
  symbol: string;
  entry_time: Date;
  entry_price: number;
  zone_type: string;
  bottom_price: number;
  top_price: number;
  close_1d: number | null;
  close_2d: number | null;
  close_3d: number | null;
  close_5d: number | null;
  close_10d: number | null;
  close_20d: number | null;
}

/**
 * Run a multi-symbol backtest with shared portfolio
 *
 * Key features:
 * - Pools multiple symbols into one portfolio
 * - Capital is shared across all symbols
 * - Positions are opened chronologically across all symbols
 * - Kelly sizing based on combined historical performance
 */
async function runMultiSymbolBacktest(params: any) {
  const {
    symbols,
    start_date,
    end_date,
    initial_capital = 10000,
    min_risk_reward = 3.0,
    max_positions = 5
  } = params;

  if (!symbols || symbols.length === 0) {
    return createEmptyResults(initial_capital);
  }

  // For single symbol, use the original function
  if (symbols.length === 1) {
    return runDatabaseBacktest({
      symbol: symbols[0],
      start_date,
      end_date,
      initial_capital,
      min_risk_reward,
      max_positions
    });
  }

  // Step 1: Calculate Kelly parameters across ALL symbols for unified sizing
  const kellyParams = await calculateKellyParamsMultiSymbol(symbols);
  const halfKelly = Math.max(kellyParams.halfKellyFraction, 0.05); // Minimum 5%
  console.log(`Multi-symbol Kelly: Win=${(kellyParams.winRate * 100).toFixed(1)}%, HalfKelly=${(halfKelly * 100).toFixed(1)}% (${symbols.length} symbols, ${kellyParams.numTrades} trades)`);

  // Step 2: Query all retest events across ALL symbols
  const placeholders = symbols.map((_: string, i: number) => `$${i + 1}`).join(', ');
  const retestQuery = `
    SELECT
      rc.zone_id,
      rc.symbol,
      rc.retest_time as entry_time,
      rc.bounce_close as entry_price,
      z.zone_type,
      rc.zone_low as bottom_price,
      rc.zone_high as top_price,
      rc.close_1d, rc.close_2d, rc.close_3d, rc.close_5d, rc.close_10d, rc.close_20d
    FROM stocks.zone_first_retests_cache rc
    JOIN stocks.zones z ON rc.zone_id = z.zone_id
    WHERE rc.symbol IN (${placeholders})
      AND rc.retest_time >= $${symbols.length + 1}::date
      AND rc.retest_time <= $${symbols.length + 2}::date
      AND rc.bounce_close IS NOT NULL
    ORDER BY rc.retest_time, rc.symbol, rc.zone_id
  `;

  const result = await pool.query(retestQuery, [...symbols, start_date, end_date]);
  const retests: RetestEvent[] = result.rows.map(row => ({
    zone_id: row.zone_id.toString(),
    symbol: row.symbol,
    entry_time: new Date(row.entry_time),
    entry_price: parseFloat(row.entry_price),
    zone_type: row.zone_type,
    bottom_price: parseFloat(row.bottom_price),
    top_price: parseFloat(row.top_price),
    close_1d: row.close_1d ? parseFloat(row.close_1d) : null,
    close_2d: row.close_2d ? parseFloat(row.close_2d) : null,
    close_3d: row.close_3d ? parseFloat(row.close_3d) : null,
    close_5d: row.close_5d ? parseFloat(row.close_5d) : null,
    close_10d: row.close_10d ? parseFloat(row.close_10d) : null,
    close_20d: row.close_20d ? parseFloat(row.close_20d) : null,
  }));

  if (retests.length === 0) {
    return createEmptyResults(initial_capital, symbols);
  }

  // Portfolio state - shared across all symbols
  let cash = initial_capital;
  let equity = initial_capital;
  let maxEquity = initial_capital;
  let maxDrawdown = 0;
  const openPositions: Map<string, OpenPosition> = new Map();
  const closedTrades: any[] = [];
  const equityCurve: Array<[string, number]> = [[start_date, initial_capital]];
  const symbolStats: Map<string, { trades: number; wins: number; pnl: number }> = new Map();

  // Initialize symbol stats
  for (const sym of symbols) {
    symbolStats.set(sym, { trades: 0, wins: 0, pnl: 0 });
  }

  // Process each retest chronologically across ALL symbols
  for (const retest of retests) {
    const entryTime = retest.entry_time.toISOString();
    const entryPrice = retest.entry_price;
    const zoneType = retest.zone_type;
    const zoneId = `${retest.symbol}_${retest.zone_id}`;
    const symbol = retest.symbol;

    // Build close prices array for this retest
    const closePrices = [
      entryPrice,
      retest.close_1d || entryPrice,
      retest.close_2d || entryPrice,
      retest.close_3d || entryPrice,
      retest.close_5d || entryPrice,
      retest.close_10d || entryPrice,
      retest.close_20d || entryPrice
    ];

    // Check and close any positions that have hit stop/target
    const positionsToClose: string[] = [];
    for (const [posId, pos] of openPositions) {
      let exitPrice: number | null = null;
      let exitReason: string = '';
      let daysHeld = 0;

      // Check each day's close for stop/target hit
      for (let day = 1; day <= 20; day++) {
        const dayIndex = day <= 3 ? day : day <= 5 ? 3 : day <= 10 ? 4 : 5;
        const closePrice = closePrices[dayIndex];
        if (!closePrice || closePrice <= 0) continue;

        if (pos.zone_type === 'demand') {
          if (closePrice <= pos.stop_loss) {
            exitPrice = pos.stop_loss;
            exitReason = 'Stop Loss';
            daysHeld = day;
            break;
          } else if (closePrice >= pos.target_price) {
            exitPrice = pos.target_price;
            exitReason = 'Target Hit';
            daysHeld = day;
            break;
          }
        } else {
          if (closePrice >= pos.stop_loss) {
            exitPrice = pos.stop_loss;
            exitReason = 'Stop Loss';
            daysHeld = day;
            break;
          } else if (closePrice <= pos.target_price) {
            exitPrice = pos.target_price;
            exitReason = 'Target Hit';
            daysHeld = day;
            break;
          }
        }
      }

      // If position needs to close
      if (exitPrice !== null) {
        let pnl: number;
        if (pos.zone_type === 'demand') {
          pnl = (exitPrice - pos.entry_price) * pos.shares;
        } else {
          pnl = (pos.entry_price - exitPrice) * pos.shares;
        }

        const rMultiple = pos.risk_amount > 0 ? pnl / pos.risk_amount : 0;

        // Calculate exit time by adding daysHeld to entry_time
        const entryDate = new Date(pos.entry_time);
        const exitDate = new Date(entryDate);
        exitDate.setDate(exitDate.getDate() + daysHeld);

        closedTrades.push({
          zone_id: pos.zone_id,
          symbol: pos.symbol,
          zone_type: pos.zone_type,
          direction: pos.direction,
          entry_time: pos.entry_time,
          exit_time: exitDate.toISOString().split('T')[0],
          entry_price: pos.entry_price,
          exit_price: exitPrice,
          stop_loss: pos.stop_loss,
          target_price: pos.target_price,
          shares: pos.shares,
          capital_deployed: pos.capital_deployed,
          pnl,
          pnl_pct: pos.capital_deployed > 0 ? (pnl / pos.capital_deployed) * 100 : 0,
          r_multiple: rMultiple,
          status: pnl > 0 ? 'Win' : 'Loss',
          exit_reason: exitReason,
          days_held: daysHeld
        });

        // Update symbol stats
        const stats = symbolStats.get(pos.symbol)!;
        stats.trades++;
        stats.pnl += pnl;
        if (pnl > 0) stats.wins++;

        cash += pos.capital_deployed + pnl;
        positionsToClose.push(posId);
      }
    }

    // Remove closed positions
    for (const posId of positionsToClose) {
      openPositions.delete(posId);
    }

    // Check if we can open a new position
    if (openPositions.size >= max_positions) {
      continue;
    }

    // Skip if we already have a position in this exact zone
    if (openPositions.has(zoneId)) {
      continue;
    }

    // Calculate stop loss and target
    let stopLoss: number;
    let targetPrice: number;
    let riskPerShare: number;

    if (zoneType === 'demand') {
      stopLoss = retest.bottom_price * 0.99;
      riskPerShare = entryPrice - stopLoss;
      targetPrice = entryPrice + (riskPerShare * min_risk_reward);
    } else {
      stopLoss = retest.top_price * 1.01;
      riskPerShare = stopLoss - entryPrice;
      targetPrice = entryPrice - (riskPerShare * min_risk_reward);
    }

    if (riskPerShare <= 0) continue;

    // Kelly position sizing
    const currentEquity = cash + Array.from(openPositions.values())
      .reduce((sum, p) => sum + p.capital_deployed, 0);
    const capitalToDeployTarget = currentEquity * halfKelly;
    const capitalToDeployActual = Math.min(capitalToDeployTarget, cash);

    if (capitalToDeployActual < 100) continue;

    const shares = Math.floor(capitalToDeployActual / entryPrice);
    if (shares <= 0) continue;

    const capitalDeployed = shares * entryPrice;
    const riskAmount = shares * riskPerShare;

    cash -= capitalDeployed;

    const newPosition: OpenPosition = {
      zone_id: zoneId,
      symbol,
      zone_type: zoneType,
      direction: zoneType === 'demand' ? 'Long' : 'Short',
      entry_time: entryTime,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      target_price: targetPrice,
      shares,
      capital_deployed: capitalDeployed,
      risk_amount: riskAmount
    };
    openPositions.set(zoneId, newPosition);

    // Update equity curve
    equity = cash + Array.from(openPositions.values())
      .reduce((sum, p) => sum + p.capital_deployed, 0);
    equityCurve.push([entryTime, equity]);

    if (equity > maxEquity) maxEquity = equity;
    const drawdown = maxEquity - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Close remaining open positions
  for (const [posId, pos] of openPositions) {
    closedTrades.push({
      zone_id: pos.zone_id,
      symbol: pos.symbol,
      zone_type: pos.zone_type,
      direction: pos.direction,
      entry_time: pos.entry_time,
      exit_time: end_date,
      entry_price: pos.entry_price,
      exit_price: pos.entry_price,
      stop_loss: pos.stop_loss,
      target_price: pos.target_price,
      shares: pos.shares,
      capital_deployed: pos.capital_deployed,
      pnl: 0,
      pnl_pct: 0,
      r_multiple: 0,
      status: 'Open',
      exit_reason: 'End of Backtest',
      days_held: 0
    });
    cash += pos.capital_deployed;
  }

  equity = cash;
  equityCurve.push([end_date, equity]);

  // Calculate summary statistics
  const completedTrades = closedTrades.filter(t => t.status !== 'Open');
  const winningTrades = completedTrades.filter(t => t.pnl > 0);
  const losingTrades = completedTrades.filter(t => t.pnl < 0);

  const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const totalPnl = totalWins - totalLosses;

  const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  const winRate = completedTrades.length > 0 ? winningTrades.length / completedTrades.length : 0;
  const totalReturnPct = ((equity - initial_capital) / initial_capital) * 100;
  const maxDrawdownPct = maxEquity > 0 ? (maxDrawdown / maxEquity) * 100 : 0;

  // Sharpe ratio
  const returns = equityCurve.map((point, i) =>
    i > 0 ? (point[1] - equityCurve[i-1][1]) / equityCurve[i-1][1] : 0
  ).slice(1);

  let sharpeRatio = 0;
  if (returns.length > 1) {
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpeRatio = (meanReturn / stdDev) * Math.sqrt(252);
    }
  }

  const avgRMultiple = completedTrades.length > 0
    ? completedTrades.reduce((sum, t) => sum + (t.r_multiple || 0), 0) / completedTrades.length
    : 0;

  // Build per-symbol breakdown
  const symbolBreakdown = Array.from(symbolStats.entries()).map(([sym, stats]) => ({
    symbol: sym,
    total_trades: stats.trades,
    winning_trades: stats.wins,
    losing_trades: stats.trades - stats.wins,
    win_rate: stats.trades > 0 ? stats.wins / stats.trades : 0,
    total_pnl: stats.pnl
  })).filter(s => s.total_trades > 0);

  return {
    total_trades: closedTrades.length,
    winning_trades: winningTrades.length,
    losing_trades: losingTrades.length,
    win_rate: winRate,
    total_pnl: totalPnl,
    total_return_pct: totalReturnPct,
    avg_win: avgWin,
    avg_loss: avgLoss,
    profit_factor: profitFactor,
    max_drawdown: maxDrawdown,
    max_drawdown_pct: maxDrawdownPct,
    sharpe_ratio: sharpeRatio,
    avg_r_multiple: avgRMultiple,
    final_capital: equity,
    kelly_params: {
      win_rate: kellyParams.winRate,
      avg_win_r: kellyParams.avgWinR,
      avg_loss_r: kellyParams.avgLossR,
      half_kelly_pct: halfKelly * 100,
      sample_size: kellyParams.numTrades
    },
    symbols_traded: symbols,
    symbol_breakdown: symbolBreakdown,
    trades: closedTrades,
    equity_curve: equityCurve
  };
}

/**
 * Calculate Kelly parameters across multiple symbols
 */
async function calculateKellyParamsMultiSymbol(symbols: string[]): Promise<{
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  kellyFraction: number;
  halfKellyFraction: number;
  numTrades: number;
}> {
  const placeholders = symbols.map((_, i) => `$${i + 1}`).join(', ');

  const query = `
    WITH trade_data AS (
      SELECT
        c.zone_id,
        c.symbol,
        z.zone_type,
        c.bounce_close as entry_price,
        c.zone_low,
        c.zone_high,
        c.close_5d as exit_price,
        CASE
          WHEN z.zone_type = 'demand' THEN c.bounce_close - c.zone_low
          WHEN z.zone_type = 'supply' THEN c.zone_high - c.bounce_close
        END as risk_points,
        CASE
          WHEN z.zone_type = 'demand' THEN c.close_5d - c.bounce_close
          WHEN z.zone_type = 'supply' THEN c.bounce_close - c.close_5d
        END as pnl_points
      FROM stocks.zone_first_retests_cache c
      JOIN stocks.zones z ON c.zone_id = z.zone_id
      WHERE c.symbol IN (${placeholders})
        AND c.bounce_day >= '2024-01-01'
        AND c.close_5d IS NOT NULL
        AND c.bounce_close IS NOT NULL
        AND c.bounce_close > 0
        AND CASE
            WHEN z.zone_type = 'demand' THEN c.bounce_close > c.zone_low
            WHEN z.zone_type = 'supply' THEN c.zone_high > c.bounce_close
        END
    ),
    r_multiples AS (
      SELECT
        zone_id,
        symbol,
        zone_type,
        entry_price,
        risk_points,
        pnl_points,
        CASE WHEN risk_points > 0 THEN pnl_points / risk_points ELSE NULL END as r_multiple,
        CASE WHEN pnl_points > 0 THEN 1 ELSE 0 END as is_win
      FROM trade_data
      WHERE risk_points > 0
    )
    SELECT
      COUNT(*) as num_trades,
      COALESCE(AVG(is_win), 0) as win_rate,
      COALESCE(AVG(CASE WHEN is_win = 1 THEN r_multiple END), 0) as avg_win_r,
      COALESCE(ABS(AVG(CASE WHEN is_win = 0 THEN r_multiple END)), 1) as avg_loss_r
    FROM r_multiples
  `;

  const result = await pool.query(query, symbols);
  const row = result.rows[0];

  if (!row || row.num_trades === 0) {
    return {
      winRate: 0.5,
      avgWinR: 1.0,
      avgLossR: 1.0,
      kellyFraction: 0.0,
      halfKellyFraction: 0.0,
      numTrades: 0
    };
  }

  const winRate = parseFloat(row.win_rate);
  const avgWinR = parseFloat(row.avg_win_r);
  const avgLossR = parseFloat(row.avg_loss_r);
  const numTrades = parseInt(row.num_trades);

  const b = avgLossR > 0 ? avgWinR / avgLossR : 1;
  let kelly = b > 0 ? winRate - (1 - winRate) / b : 0;
  kelly = Math.max(0, Math.min(kelly, 0.25));

  return {
    winRate,
    avgWinR,
    avgLossR,
    kellyFraction: kelly,
    halfKellyFraction: kelly / 2,
    numTrades
  };
}
