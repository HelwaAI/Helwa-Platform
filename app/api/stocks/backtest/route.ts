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
 * Exit Strategy Types:
 * - holding_period: Use pre-calculated returns from zone_first_retests_cache
 * - stop_target: Traditional stop loss / target exit (requires intraday simulation)
 * - hvn_target: Exit when price reaches next HVN level
 * - historical_trades: Use actual historical trades from historical_trades table with Kelly sizing
 */
type ExitStrategy = 'holding_period' | 'stop_target' | 'hvn_target' | 'historical_trades';

/**
 * Holding Period Options (days)
 */
type HoldingPeriod = 1 | 2 | 3 | 5 | 10 | 20 | 22 | 65;

type ZoneTypeFilter = 'all' | 'demand' | 'supply';

interface BacktestParams {
  symbols: string[];
  start_date: string;
  end_date: string;
  initial_capital: number;
  max_positions: number;
  exit_strategy: ExitStrategy;
  holding_period?: HoldingPeriod;  // For holding_period strategy
  min_risk_reward?: number;        // For stop_target strategy
  hvn_lookback_days?: number;      // For hvn_target strategy
  timeframe_ids?: number[];        // For historical_trades strategy (multiple timeframes)
  zone_type?: ZoneTypeFilter;      // Filter by zone type: demand, supply, or all
}

/**
 * GET /api/stocks/backtest
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    if (action === 'symbols') {
      const query = `
        SELECT DISTINCT s.symbol, s.id, s.company_name
        FROM stocks.zone_first_retests_cache rc
        JOIN stocks.symbols s ON rc.symbol = s.symbol
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

      const query = `
        SELECT
          MIN(bounce_day) as min_date,
          MAX(bounce_day) as max_date,
          COUNT(*) as retest_count
        FROM stocks.zone_first_retests_cache
        WHERE symbol = $1
      `;
      const result = await pool.query(query, [symbol]);

      if (result.rows.length === 0 || !result.rows[0].min_date) {
        return NextResponse.json({
          success: false,
          error: `No retest data found for symbol: ${symbol}`
        }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        symbol,
        min_date: result.rows[0].min_date,
        max_date: result.rows[0].max_date,
        retest_count: parseInt(result.rows[0].retest_count)
      });
    }

    // Default: return API info
    return NextResponse.json({
      success: true,
      api: 'Zone Retest Backtest API',
      version: '2.0',
      exit_strategies: {
        holding_period: 'Use pre-calculated close prices at fixed holding periods (1d, 2d, 3d, 5d, 10d, 20d, 22d, 65d)',
        stop_target: 'Traditional stop loss at zone boundary, target at R:R multiple',
        hvn_target: 'Exit when price reaches next HVN (High Volume Node) level',
        historical_trades: 'Use actual historical trades with Kelly criterion position sizing'
      },
      endpoints: {
        'GET ?action=symbols': 'List available symbols with retest data',
        'GET ?action=date-range&symbol=AAPL': 'Get date range for a symbol',
        'POST': 'Run a backtest with specified exit strategy'
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
 * Body parameters:
 * - symbols: Array of symbols OR symbol: Single symbol
 * - start_date: Start date YYYY-MM-DD (required)
 * - end_date: End date YYYY-MM-DD (required)
 * - initial_capital: Starting capital (default: 10000)
 * - max_positions: Maximum concurrent positions (default: 5)
 * - exit_strategy: 'holding_period' | 'stop_target' | 'hvn_target' (default: 'holding_period')
 * - holding_period: Days to hold (1, 2, 3, 5, 10, 20, 22, 65) - for holding_period strategy
 * - min_risk_reward: R:R ratio (default: 3.0) - for stop_target strategy
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

    const params: BacktestParams = {
      symbols,
      start_date: body.start_date,
      end_date: body.end_date,
      initial_capital: body.initial_capital || 10000,
      max_positions: body.max_positions || 5,
      exit_strategy: body.exit_strategy || 'holding_period',
      holding_period: body.holding_period || 5,
      min_risk_reward: body.min_risk_reward || 3.0,
      hvn_lookback_days: body.hvn_lookback_days || 90,
      timeframe_ids: body.timeframe_ids || [4],  // Default to 5m timeframe, supports multiple
      zone_type: body.zone_type || 'all'  // Default to all zones (demand + supply)
    };

    let results;

    switch (params.exit_strategy) {
      case 'holding_period':
        results = await runHoldingPeriodBacktest(params);
        break;
      case 'stop_target':
        results = await runStopTargetBacktest(params);
        break;
      case 'hvn_target':
        results = await runHVNTargetBacktest(params);
        break;
      case 'historical_trades':
        results = await runHistoricalTradesBacktest(params);
        break;
      default:
        return NextResponse.json(
          { success: false, error: `Unknown exit strategy: ${params.exit_strategy}` },
          { status: 400 }
        );
    }

    return NextResponse.json({
      success: true,
      exit_strategy: params.exit_strategy,
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
 * HOLDING PERIOD BACKTEST
 *
 * Uses pre-calculated close prices from zone_first_retests_cache.
 * No simulation needed - just reads the actual returns from the database.
 *
 * This gives the "ground truth" of what would happen if you:
 * 1. Entered at the retest close (bounce_close)
 * 2. Held for exactly N days
 * 3. Exited at close_Nd price
 */
async function runHoldingPeriodBacktest(params: BacktestParams) {
  const { symbols, start_date, end_date, initial_capital, max_positions, holding_period = 5 } = params;

  // Map holding period to column names
  const closeColumn = `close_${holding_period}d`;
  const returnColumn = `return_${holding_period}d`;

  // Validate holding period
  const validPeriods = [1, 2, 3, 5, 10, 20, 22, 65];
  if (!validPeriods.includes(holding_period)) {
    throw new Error(`Invalid holding_period: ${holding_period}. Must be one of: ${validPeriods.join(', ')}`);
  }

  // Query all retests for the symbols in date range
  const placeholders = symbols.map((_, i) => `$${i + 1}`).join(', ');
  const query = `
    SELECT
      rc.zone_id,
      rc.symbol,
      z.zone_type,
      rc.bounce_day as entry_date,
      rc.bounce_close as entry_price,
      rc.zone_low,
      rc.zone_high,
      rc.${closeColumn} as exit_price,
      rc.${returnColumn} as return_pct
    FROM stocks.zone_first_retests_cache rc
    JOIN stocks.zones z ON rc.zone_id = z.zone_id
    WHERE rc.symbol IN (${placeholders})
      AND rc.bounce_day >= $${symbols.length + 1}::date
      AND rc.bounce_day <= $${symbols.length + 2}::date
      AND rc.bounce_close IS NOT NULL
      AND rc.bounce_close > 0
      AND rc.${closeColumn} IS NOT NULL
    ORDER BY rc.bounce_day, rc.symbol, rc.zone_id
  `;

  const result = await pool.query(query, [...symbols, start_date, end_date]);
  const retests = result.rows;

  if (retests.length === 0) {
    return createEmptyResults(initial_capital, symbols, params.exit_strategy);
  }

  // Calculate Kelly parameters from the data
  const kellyParams = calculateKellyFromRetests(retests);
  const halfKelly = Math.max(kellyParams.halfKellyFraction, 0.05);

  // Portfolio state
  let cash = initial_capital;
  const trades: any[] = [];
  const symbolStats: Map<string, { trades: number; wins: number; pnl: number }> = new Map();
  symbols.forEach(s => symbolStats.set(s, { trades: 0, wins: 0, pnl: 0 }));

  // Active positions tracking (for max_positions limit)
  // Key: exit_date, Value: array of positions closing that day
  const positionsByExitDate: Map<string, number> = new Map();
  let activePositions = 0;

  // Process each retest chronologically
  for (const retest of retests) {
    const entryDate = new Date(retest.entry_date);
    const exitDate = new Date(entryDate);
    exitDate.setDate(exitDate.getDate() + holding_period);
    const exitDateStr = exitDate.toISOString().split('T')[0];
    const entryDateStr = entryDate.toISOString().split('T')[0];

    // First, free up any positions that have exited by this entry date
    for (const [date, count] of positionsByExitDate) {
      if (date <= entryDateStr) {
        activePositions -= count;
        positionsByExitDate.delete(date);
      }
    }

    // Check if we can open a new position
    if (activePositions >= max_positions) {
      continue;
    }

    const entryPrice = parseFloat(retest.entry_price);
    const exitPrice = parseFloat(retest.exit_price);
    const zoneLow = parseFloat(retest.zone_low);
    const zoneHigh = parseFloat(retest.zone_high);
    const zoneType = retest.zone_type;

    // Calculate position size using Half-Kelly
    const positionValue = cash * halfKelly;
    if (positionValue < 100) continue;

    const shares = Math.floor(positionValue / entryPrice);
    if (shares <= 0) continue;

    const capitalDeployed = shares * entryPrice;

    // Calculate risk and P&L based on zone type
    let riskPerShare: number;
    let pnl: number;
    let direction: string;

    if (zoneType === 'demand') {
      // Long trade: risk is to zone bottom
      riskPerShare = entryPrice - (zoneLow * 0.99);
      pnl = (exitPrice - entryPrice) * shares;
      direction = 'Long';
    } else {
      // Short trade: risk is to zone top
      riskPerShare = (zoneHigh * 1.01) - entryPrice;
      pnl = (entryPrice - exitPrice) * shares;
      direction = 'Short';
    }

    const riskAmount = shares * riskPerShare;
    const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
    const status = pnl > 0 ? 'Win' : 'Loss';

    // Record the trade
    trades.push({
      zone_id: `${retest.symbol}_${retest.zone_id}`,
      symbol: retest.symbol,
      zone_type: zoneType,
      direction,
      entry_time: entryDateStr,
      exit_time: exitDateStr,
      entry_price: entryPrice,
      exit_price: exitPrice,
      stop_loss: zoneType === 'demand' ? zoneLow * 0.99 : zoneHigh * 1.01,
      target_price: null, // No target in holding period mode
      shares,
      capital_deployed: capitalDeployed,
      pnl,
      pnl_pct: (pnl / capitalDeployed) * 100,
      r_multiple: rMultiple,
      status,
      exit_reason: `${holding_period}d Hold`,
      days_held: holding_period
    });

    // Update symbol stats
    const stats = symbolStats.get(retest.symbol)!;
    stats.trades++;
    stats.pnl += pnl;
    if (pnl > 0) stats.wins++;

    // Update cash (compound returns)
    cash += pnl;

    // Track active positions
    activePositions++;
    const existingCount = positionsByExitDate.get(exitDateStr) || 0;
    positionsByExitDate.set(exitDateStr, existingCount + 1);
  }

  return buildResults(trades, initial_capital, cash, symbols, symbolStats, kellyParams, params.exit_strategy);
}

/**
 * STOP/TARGET BACKTEST
 *
 * Uses zone boundaries for stops and R:R multiple for targets.
 * Since we don't have intraday data for every day, we use the
 * holding period close prices to approximate when stops/targets are hit.
 */
async function runStopTargetBacktest(params: BacktestParams) {
  const { symbols, start_date, end_date, initial_capital, max_positions, min_risk_reward = 3.0 } = params;

  // Query all retests with all close columns
  const placeholders = symbols.map((_, i) => `$${i + 1}`).join(', ');
  const query = `
    SELECT
      rc.zone_id,
      rc.symbol,
      z.zone_type,
      rc.bounce_day as entry_date,
      rc.bounce_close as entry_price,
      rc.zone_low,
      rc.zone_high,
      rc.close_1d, rc.close_2d, rc.close_3d, rc.close_5d,
      rc.close_10d, rc.close_20d
    FROM stocks.zone_first_retests_cache rc
    JOIN stocks.zones z ON rc.zone_id = z.zone_id
    WHERE rc.symbol IN (${placeholders})
      AND rc.bounce_day >= $${symbols.length + 1}::date
      AND rc.bounce_day <= $${symbols.length + 2}::date
      AND rc.bounce_close IS NOT NULL
      AND rc.bounce_close > 0
    ORDER BY rc.bounce_day, rc.symbol, rc.zone_id
  `;

  const result = await pool.query(query, [...symbols, start_date, end_date]);
  const retests = result.rows;

  if (retests.length === 0) {
    return createEmptyResults(initial_capital, symbols, params.exit_strategy);
  }

  const kellyParams = await calculateKellyParamsFromDB(symbols);
  const halfKelly = Math.max(kellyParams.halfKellyFraction, 0.05);

  let cash = initial_capital;
  const trades: any[] = [];
  const symbolStats: Map<string, { trades: number; wins: number; pnl: number }> = new Map();
  symbols.forEach(s => symbolStats.set(s, { trades: 0, wins: 0, pnl: 0 }));

  // Process each retest
  for (const retest of retests) {
    const entryPrice = parseFloat(retest.entry_price);
    const zoneLow = parseFloat(retest.zone_low);
    const zoneHigh = parseFloat(retest.zone_high);
    const zoneType = retest.zone_type;
    const entryDate = new Date(retest.entry_date);

    // Calculate stop and target
    let stopLoss: number;
    let targetPrice: number;
    let riskPerShare: number;

    if (zoneType === 'demand') {
      stopLoss = zoneLow * 0.99;
      riskPerShare = entryPrice - stopLoss;
      targetPrice = entryPrice + (riskPerShare * min_risk_reward);
    } else {
      stopLoss = zoneHigh * 1.01;
      riskPerShare = stopLoss - entryPrice;
      targetPrice = entryPrice - (riskPerShare * min_risk_reward);
    }

    if (riskPerShare <= 0) continue;

    // Position sizing
    const positionValue = cash * halfKelly;
    if (positionValue < 100) continue;

    const shares = Math.floor(positionValue / entryPrice);
    if (shares <= 0) continue;

    const capitalDeployed = shares * entryPrice;
    const riskAmount = shares * riskPerShare;

    // Check each day's close to see if stop or target hit
    const closePrices = [
      { day: 1, price: retest.close_1d ? parseFloat(retest.close_1d) : null },
      { day: 2, price: retest.close_2d ? parseFloat(retest.close_2d) : null },
      { day: 3, price: retest.close_3d ? parseFloat(retest.close_3d) : null },
      { day: 5, price: retest.close_5d ? parseFloat(retest.close_5d) : null },
      { day: 10, price: retest.close_10d ? parseFloat(retest.close_10d) : null },
      { day: 20, price: retest.close_20d ? parseFloat(retest.close_20d) : null },
    ];

    let exitPrice: number | null = null;
    let exitReason = '';
    let daysHeld = 20; // Default to max if neither hit

    for (const { day, price } of closePrices) {
      if (price === null) continue;

      if (zoneType === 'demand') {
        if (price <= stopLoss) {
          exitPrice = stopLoss;
          exitReason = 'Stop Loss';
          daysHeld = day;
          break;
        } else if (price >= targetPrice) {
          exitPrice = targetPrice;
          exitReason = 'Target Hit';
          daysHeld = day;
          break;
        }
      } else {
        if (price >= stopLoss) {
          exitPrice = stopLoss;
          exitReason = 'Stop Loss';
          daysHeld = day;
          break;
        } else if (price <= targetPrice) {
          exitPrice = targetPrice;
          exitReason = 'Target Hit';
          daysHeld = day;
          break;
        }
      }
    }

    // If neither stop nor target hit, use 20d close as forced exit
    if (exitPrice === null) {
      const lastClose = closePrices.find(c => c.price !== null);
      if (lastClose) {
        exitPrice = lastClose.price!;
        exitReason = 'Time Exit';
        daysHeld = lastClose.day;
      } else {
        continue; // No price data, skip
      }
    }

    // Calculate P&L
    let pnl: number;
    if (zoneType === 'demand') {
      pnl = (exitPrice - entryPrice) * shares;
    } else {
      pnl = (entryPrice - exitPrice) * shares;
    }

    const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
    const exitDate = new Date(entryDate);
    exitDate.setDate(exitDate.getDate() + daysHeld);

    trades.push({
      zone_id: `${retest.symbol}_${retest.zone_id}`,
      symbol: retest.symbol,
      zone_type: zoneType,
      direction: zoneType === 'demand' ? 'Long' : 'Short',
      entry_time: entryDate.toISOString().split('T')[0],
      exit_time: exitDate.toISOString().split('T')[0],
      entry_price: entryPrice,
      exit_price: exitPrice,
      stop_loss: stopLoss,
      target_price: targetPrice,
      shares,
      capital_deployed: capitalDeployed,
      pnl,
      pnl_pct: (pnl / capitalDeployed) * 100,
      r_multiple: rMultiple,
      status: pnl > 0 ? 'Win' : 'Loss',
      exit_reason: exitReason,
      days_held: daysHeld
    });

    const stats = symbolStats.get(retest.symbol)!;
    stats.trades++;
    stats.pnl += pnl;
    if (pnl > 0) stats.wins++;

    cash += pnl;
  }

  return buildResults(trades, initial_capital, cash, symbols, symbolStats, kellyParams, params.exit_strategy);
}

/**
 * HVN TARGET BACKTEST
 *
 * Uses volume profile to find the next HVN level as the target.
 * For demand zones (longs), finds HVN above entry.
 * For supply zones (shorts), finds HVN below entry.
 */
async function runHVNTargetBacktest(params: BacktestParams) {
  const { symbols, start_date, end_date, initial_capital, max_positions } = params;

  // First, get all HVN levels for the symbols
  const hvnQuery = `
    SELECT
      s.symbol,
      vp.price_level,
      vp.volume,
      vp.node_type
    FROM stocks.volume_profile vp
    JOIN stocks.symbols s ON vp.symbol_id = s.id
    WHERE s.symbol = ANY($1)
      AND vp.node_type IN ('HVN', 'POC')
    ORDER BY s.symbol, vp.price_level
  `;
  const hvnResult = await pool.query(hvnQuery, [symbols]);

  // Build HVN lookup by symbol
  const hvnBySymbol: Map<string, number[]> = new Map();
  for (const row of hvnResult.rows) {
    const levels = hvnBySymbol.get(row.symbol) || [];
    levels.push(parseFloat(row.price_level));
    hvnBySymbol.set(row.symbol, levels);
  }

  // Sort HVN levels for each symbol
  for (const [symbol, levels] of hvnBySymbol) {
    hvnBySymbol.set(symbol, levels.sort((a, b) => a - b));
  }

  // Query all retests
  const placeholders = symbols.map((_, i) => `$${i + 1}`).join(', ');
  const query = `
    SELECT
      rc.zone_id,
      rc.symbol,
      z.zone_type,
      rc.bounce_day as entry_date,
      rc.bounce_close as entry_price,
      rc.zone_low,
      rc.zone_high,
      rc.close_1d, rc.close_2d, rc.close_3d, rc.close_5d,
      rc.close_10d, rc.close_20d
    FROM stocks.zone_first_retests_cache rc
    JOIN stocks.zones z ON rc.zone_id = z.zone_id
    WHERE rc.symbol IN (${placeholders})
      AND rc.bounce_day >= $${symbols.length + 1}::date
      AND rc.bounce_day <= $${symbols.length + 2}::date
      AND rc.bounce_close IS NOT NULL
      AND rc.bounce_close > 0
    ORDER BY rc.bounce_day, rc.symbol, rc.zone_id
  `;

  const result = await pool.query(query, [...symbols, start_date, end_date]);
  const retests = result.rows;

  if (retests.length === 0) {
    return createEmptyResults(initial_capital, symbols, params.exit_strategy);
  }

  const kellyParams = await calculateKellyParamsFromDB(symbols);
  const halfKelly = Math.max(kellyParams.halfKellyFraction, 0.05);

  let cash = initial_capital;
  const trades: any[] = [];
  const symbolStats: Map<string, { trades: number; wins: number; pnl: number }> = new Map();
  symbols.forEach(s => symbolStats.set(s, { trades: 0, wins: 0, pnl: 0 }));

  for (const retest of retests) {
    const entryPrice = parseFloat(retest.entry_price);
    const zoneLow = parseFloat(retest.zone_low);
    const zoneHigh = parseFloat(retest.zone_high);
    const zoneType = retest.zone_type;
    const entryDate = new Date(retest.entry_date);

    // Get HVN levels for this symbol
    const hvnLevels = hvnBySymbol.get(retest.symbol) || [];
    if (hvnLevels.length === 0) continue;

    // Find target HVN and calculate stop
    let stopLoss: number;
    let targetHVN: number | null = null;
    let riskPerShare: number;

    if (zoneType === 'demand') {
      // Long: find HVN above entry price
      stopLoss = zoneLow * 0.99;
      riskPerShare = entryPrice - stopLoss;
      targetHVN = hvnLevels.find(level => level > entryPrice * 1.01) || null;
    } else {
      // Short: find HVN below entry price
      stopLoss = zoneHigh * 1.01;
      riskPerShare = stopLoss - entryPrice;
      targetHVN = [...hvnLevels].reverse().find(level => level < entryPrice * 0.99) || null;
    }

    if (riskPerShare <= 0 || targetHVN === null) continue;

    // Position sizing
    const positionValue = cash * halfKelly;
    if (positionValue < 100) continue;

    const shares = Math.floor(positionValue / entryPrice);
    if (shares <= 0) continue;

    const capitalDeployed = shares * entryPrice;
    const riskAmount = shares * riskPerShare;

    // Check each day's close for stop or HVN target
    const closePrices = [
      { day: 1, price: retest.close_1d ? parseFloat(retest.close_1d) : null },
      { day: 2, price: retest.close_2d ? parseFloat(retest.close_2d) : null },
      { day: 3, price: retest.close_3d ? parseFloat(retest.close_3d) : null },
      { day: 5, price: retest.close_5d ? parseFloat(retest.close_5d) : null },
      { day: 10, price: retest.close_10d ? parseFloat(retest.close_10d) : null },
      { day: 20, price: retest.close_20d ? parseFloat(retest.close_20d) : null },
    ];

    let exitPrice: number | null = null;
    let exitReason = '';
    let daysHeld = 20;

    for (const { day, price } of closePrices) {
      if (price === null) continue;

      if (zoneType === 'demand') {
        if (price <= stopLoss) {
          exitPrice = stopLoss;
          exitReason = 'Stop Loss';
          daysHeld = day;
          break;
        } else if (price >= targetHVN) {
          exitPrice = targetHVN;
          exitReason = 'HVN Target';
          daysHeld = day;
          break;
        }
      } else {
        if (price >= stopLoss) {
          exitPrice = stopLoss;
          exitReason = 'Stop Loss';
          daysHeld = day;
          break;
        } else if (price <= targetHVN) {
          exitPrice = targetHVN;
          exitReason = 'HVN Target';
          daysHeld = day;
          break;
        }
      }
    }

    // Time exit if neither hit
    if (exitPrice === null) {
      const lastClose = closePrices.filter(c => c.price !== null).pop();
      if (lastClose) {
        exitPrice = lastClose.price!;
        exitReason = 'Time Exit';
        daysHeld = lastClose.day;
      } else {
        continue;
      }
    }

    let pnl: number;
    if (zoneType === 'demand') {
      pnl = (exitPrice - entryPrice) * shares;
    } else {
      pnl = (entryPrice - exitPrice) * shares;
    }

    const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;
    const exitDate = new Date(entryDate);
    exitDate.setDate(exitDate.getDate() + daysHeld);

    trades.push({
      zone_id: `${retest.symbol}_${retest.zone_id}`,
      symbol: retest.symbol,
      zone_type: zoneType,
      direction: zoneType === 'demand' ? 'Long' : 'Short',
      entry_time: entryDate.toISOString().split('T')[0],
      exit_time: exitDate.toISOString().split('T')[0],
      entry_price: entryPrice,
      exit_price: exitPrice,
      stop_loss: stopLoss,
      target_price: targetHVN,
      shares,
      capital_deployed: capitalDeployed,
      pnl,
      pnl_pct: (pnl / capitalDeployed) * 100,
      r_multiple: rMultiple,
      status: pnl > 0 ? 'Win' : 'Loss',
      exit_reason: exitReason,
      days_held: daysHeld
    });

    const stats = symbolStats.get(retest.symbol)!;
    stats.trades++;
    stats.pnl += pnl;
    if (pnl > 0) stats.wins++;

    cash += pnl;
  }

  return buildResults(trades, initial_capital, cash, symbols, symbolStats, kellyParams, params.exit_strategy);
}

/**
 * HISTORICAL TRADES BACKTEST
 *
 * Uses actual historical trades from the historical_trades table.
 * Implements proper portfolio simulation with event-driven capital tracking:
 * - Capital is locked when entering a trade and released when exiting
 * - Processes entry and exit events chronologically
 * - Skips trades when insufficient capital is available
 * - Respects max_positions limit
 *
 * Calculates Kelly criterion from overall historical trade statistics for position sizing.
 * Kelly % = Win Rate - [(1 - Win Rate) / Risk:Reward Ratio]
 * Always uses Half-Kelly for position sizing.
 *
 * Filters to only include symbols rated as 'compliant' or 'questionable'.
 */
async function runHistoricalTradesBacktest(params: BacktestParams) {
  const { symbols, start_date, end_date, initial_capital, max_positions, timeframe_ids = [4], zone_type = 'all' } = params;

  // Build timeframe filter for multiple timeframes
  const timeframePlaceholders = timeframe_ids.map((_, i) => `$${i + 1}`).join(', ');

  // Build zone type filter
  const zoneTypeFilter = zone_type === 'all' ? '' : `AND ht.zone_type = '${zone_type}'`;

  // First, calculate Kelly parameters from ALL historical trades for the selected timeframes
  // Filter by compliant/questionable symbols only and zone type
  const kellyQuery = `
    WITH trade_stats AS (
      SELECT
        ht.outcome,
        ht.risk_reward_ratio,
        CASE WHEN ht.outcome = 'WIN' THEN 1 ELSE 0 END as is_win
      FROM stocks.historical_trades ht
      JOIN stocks.symbols s ON ht.symbol = s.symbol
      WHERE ht.timeframe_id IN (${timeframePlaceholders})
        AND ht.outcome IS NOT NULL
        AND ht.risk_reward_ratio IS NOT NULL
        AND s.compliance IN ('compliant', 'questionable')
        ${zoneTypeFilter}
    )
    SELECT
      COUNT(*) as total_trades,
      SUM(is_win) as wins,
      AVG(is_win) as win_rate,
      AVG(risk_reward_ratio) as avg_rr_ratio
    FROM trade_stats
  `;

  const kellyResult = await pool.query(kellyQuery, timeframe_ids);
  const kellyRow = kellyResult.rows[0];

  let kellyParams: any;
  if (!kellyRow || parseInt(kellyRow.total_trades) === 0) {
    kellyParams = { winRate: 0.5, avgRRRatio: 3, kellyFraction: 0, halfKellyFraction: 0.05, numTrades: 0 };
  } else {
    const winRate = parseFloat(kellyRow.win_rate) || 0.5;
    const avgRRRatio = parseFloat(kellyRow.avg_rr_ratio) || 3;
    const numTrades = parseInt(kellyRow.total_trades);

    // Kelly formula: Kelly % = Win Rate - [(1 - Win Rate) / Risk:Reward Ratio]
    let kelly = avgRRRatio > 0 ? winRate - ((1 - winRate) / avgRRRatio) : 0;
    kelly = Math.max(0, Math.min(kelly, 0.25)); // Cap at 25%

    kellyParams = {
      winRate,
      avgRRRatio,
      kellyFraction: kelly,
      halfKellyFraction: kelly / 2,
      numTrades
    };
  }

  // Always use Half-Kelly for position sizing
  const halfKelly = Math.max(kellyParams.halfKellyFraction, 0.02); // Minimum 2% position size

  // Query historical trades for the specified symbols, date range, and timeframes
  // Filter by compliant/questionable symbols only
  const baseParamOffset = timeframe_ids.length;

  let tradesQuery: string;
  let queryParams: any[];

  if (symbols.length === 0 || (symbols.length === 1 && symbols[0] === '')) {
    // No symbol filter - get all compliant/questionable trades
    tradesQuery = `
      SELECT
        ht.trade_id,
        ht.symbol,
        ht.zone_type,
        ht.zone_id,
        ht.zone_bottom,
        ht.zone_top,
        ht.entry_time,
        ht.entry_price,
        ht.stop_price,
        ht.target_price,
        ht.risk_amount,
        ht.reward_amount,
        ht.risk_reward_ratio,
        ht.outcome,
        ht.exit_time,
        ht.exit_price,
        ht.exit_reason,
        ht.pnl_points,
        ht.pnl_percent,
        ht.r_multiple,
        ht.minutes_to_exit,
        ht.timeframe_id,
        s.compliance as symbol_compliance
      FROM stocks.historical_trades ht
      JOIN stocks.symbols s ON ht.symbol = s.symbol
      WHERE ht.timeframe_id IN (${timeframePlaceholders})
        AND ht.entry_time >= $${baseParamOffset + 1}::timestamp
        AND ht.entry_time <= $${baseParamOffset + 2}::timestamp
        AND ht.outcome IS NOT NULL
        AND ht.exit_time IS NOT NULL
        AND s.compliance IN ('compliant', 'questionable')
        ${zoneTypeFilter}
      ORDER BY ht.entry_time ASC
    `;
    queryParams = [...timeframe_ids, start_date, end_date];
  } else {
    // Filter by symbols AND compliant/questionable compliance
    const symbolPlaceholders = symbols.map((_, i) => `$${baseParamOffset + 3 + i}`).join(', ');
    tradesQuery = `
      SELECT
        ht.trade_id,
        ht.symbol,
        ht.zone_type,
        ht.zone_id,
        ht.zone_bottom,
        ht.zone_top,
        ht.entry_time,
        ht.entry_price,
        ht.stop_price,
        ht.target_price,
        ht.risk_amount,
        ht.reward_amount,
        ht.risk_reward_ratio,
        ht.outcome,
        ht.exit_time,
        ht.exit_price,
        ht.exit_reason,
        ht.pnl_points,
        ht.pnl_percent,
        ht.r_multiple,
        ht.minutes_to_exit,
        ht.timeframe_id,
        s.compliance as symbol_compliance
      FROM stocks.historical_trades ht
      JOIN stocks.symbols s ON ht.symbol = s.symbol
      WHERE ht.timeframe_id IN (${timeframePlaceholders})
        AND ht.entry_time >= $${baseParamOffset + 1}::timestamp
        AND ht.entry_time <= $${baseParamOffset + 2}::timestamp
        AND ht.symbol IN (${symbolPlaceholders})
        AND ht.outcome IS NOT NULL
        AND ht.exit_time IS NOT NULL
        AND s.compliance IN ('compliant', 'questionable')
        ${zoneTypeFilter}
      ORDER BY ht.entry_time ASC
    `;
    queryParams = [...timeframe_ids, start_date, end_date, ...symbols];
  }

  const tradesResult = await pool.query(tradesQuery, queryParams);
  const historicalTrades = tradesResult.rows;

  if (historicalTrades.length === 0) {
    return createEmptyResults(initial_capital, symbols, params.exit_strategy);
  }

  // Get unique symbols from trades for symbol breakdown
  const uniqueSymbols = [...new Set(historicalTrades.map(t => t.symbol))];

  // ============================================================
  // EVENT-DRIVEN PORTFOLIO SIMULATION
  // ============================================================
  // Create events for entries and exits, process chronologically
  // Capital is locked on entry and released on exit

  interface TradeEvent {
    type: 'entry' | 'exit';
    timestamp: Date;
    tradeIndex: number; // Index into historicalTrades array
  }

  interface OpenPosition {
    tradeIndex: number;
    symbol: string;
    shares: number;
    capitalDeployed: number;
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
    zoneType: string;
    entryTime: Date;
    exitTime: Date;
  }

  // Build event queue
  const events: TradeEvent[] = [];
  for (let i = 0; i < historicalTrades.length; i++) {
    const trade = historicalTrades[i];
    const entryTime = new Date(trade.entry_time);
    const exitTime = new Date(trade.exit_time);

    events.push({ type: 'entry', timestamp: entryTime, tradeIndex: i });
    events.push({ type: 'exit', timestamp: exitTime, tradeIndex: i });
  }

  // Sort events chronologically (exits before entries if same timestamp to free capital first)
  events.sort((a, b) => {
    const timeDiff = a.timestamp.getTime() - b.timestamp.getTime();
    if (timeDiff !== 0) return timeDiff;
    // If same time, process exits before entries
    if (a.type === 'exit' && b.type === 'entry') return -1;
    if (a.type === 'entry' && b.type === 'exit') return 1;
    return 0;
  });

  // Portfolio state
  let availableCash = initial_capital;
  const openPositions: Map<number, OpenPosition> = new Map(); // tradeIndex -> position
  const completedTrades: any[] = [];
  const symbolStats: Map<string, { trades: number; wins: number; pnl: number }> = new Map();
  uniqueSymbols.forEach(s => symbolStats.set(s, { trades: 0, wins: 0, pnl: 0 }));

  // Track skipped trades for debugging
  let skippedNoCapital = 0;
  let skippedMaxPositions = 0;

  // Process events chronologically
  for (const event of events) {
    const trade = historicalTrades[event.tradeIndex];

    if (event.type === 'exit') {
      // EXIT EVENT: Release capital back to available cash
      const position = openPositions.get(event.tradeIndex);
      if (!position) continue; // Position was never opened (skipped at entry)

      const exitPrice = parseFloat(trade.exit_price);
      const outcome = trade.outcome;

      // Calculate P&L based on zone type
      let pnl: number;
      if (position.zoneType === 'demand') {
        // Long trade
        pnl = (exitPrice - position.entryPrice) * position.shares;
      } else {
        // Short trade
        pnl = (position.entryPrice - exitPrice) * position.shares;
      }

      // Return capital + P&L to available cash
      availableCash += position.capitalDeployed + pnl;

      // Calculate metrics
      const pnlPct = (pnl / position.capitalDeployed) * 100;
      let riskPerShare: number;
      if (position.zoneType === 'demand') {
        riskPerShare = position.entryPrice - position.stopPrice;
      } else {
        riskPerShare = position.stopPrice - position.entryPrice;
      }
      const riskAmount = position.shares * riskPerShare;
      const actualRMultiple = riskAmount > 0 ? pnl / riskAmount : 0;

      // Calculate days held
      const daysHeld = Math.ceil((position.exitTime.getTime() - position.entryTime.getTime()) / (1000 * 60 * 60 * 24));

      // Record completed trade
      completedTrades.push({
        zone_id: `${trade.symbol}_${trade.zone_id}`,
        symbol: trade.symbol,
        zone_type: position.zoneType,
        direction: position.zoneType === 'demand' ? 'Long' : 'Short',
        entry_time: position.entryTime.toISOString(),
        exit_time: position.exitTime.toISOString(),
        entry_price: position.entryPrice,
        exit_price: exitPrice,
        stop_loss: position.stopPrice,
        target_price: position.targetPrice,
        shares: position.shares,
        capital_deployed: position.capitalDeployed,
        pnl,
        pnl_pct: pnlPct,
        r_multiple: actualRMultiple,
        status: outcome === 'WIN' ? 'Win' : outcome === 'LOSS' ? 'Loss' : 'Breakeven',
        exit_reason: trade.exit_reason || 'Unknown',
        days_held: daysHeld,
        available_cash_after: availableCash
      });

      // Update symbol stats
      const stats = symbolStats.get(trade.symbol);
      if (stats) {
        stats.trades++;
        stats.pnl += pnl;
        if (pnl > 0) stats.wins++;
      }

      // Remove from open positions
      openPositions.delete(event.tradeIndex);

    } else {
      // ENTRY EVENT: Try to open a new position

      // Check max positions limit
      if (openPositions.size >= max_positions) {
        skippedMaxPositions++;
        continue;
      }

      const entryPrice = parseFloat(trade.entry_price);
      const exitTime = new Date(trade.exit_time);
      const stopPrice = parseFloat(trade.stop_price);
      const targetPrice = parseFloat(trade.target_price);
      const zoneType = trade.zone_type;

      // Calculate position size using Half-Kelly based on AVAILABLE cash
      const positionValue = availableCash * halfKelly;
      if (positionValue < 100) {
        skippedNoCapital++;
        continue; // Not enough capital
      }

      const shares = Math.floor(positionValue / entryPrice);
      if (shares <= 0) {
        skippedNoCapital++;
        continue;
      }

      const capitalDeployed = shares * entryPrice;

      // Check if we have enough available cash
      if (capitalDeployed > availableCash) {
        skippedNoCapital++;
        continue;
      }

      // Calculate risk per share based on zone type
      let riskPerShare: number;
      if (zoneType === 'demand') {
        riskPerShare = entryPrice - stopPrice;
      } else {
        riskPerShare = stopPrice - entryPrice;
      }

      if (riskPerShare <= 0) continue;

      // DEPLOY CAPITAL - subtract from available cash
      availableCash -= capitalDeployed;

      // Track open position
      openPositions.set(event.tradeIndex, {
        tradeIndex: event.tradeIndex,
        symbol: trade.symbol,
        shares,
        capitalDeployed,
        entryPrice,
        stopPrice,
        targetPrice,
        zoneType,
        entryTime: event.timestamp,
        exitTime
      });
    }
  }

  // Calculate final capital (should equal availableCash since all positions are closed)
  const finalCapital = availableCash;

  // Add debug info to results
  const debugInfo = {
    total_historical_trades: historicalTrades.length,
    trades_executed: completedTrades.length,
    skipped_no_capital: skippedNoCapital,
    skipped_max_positions: skippedMaxPositions
  };

  return buildResultsWithDebug(completedTrades, initial_capital, finalCapital, uniqueSymbols, symbolStats, kellyParams, params.exit_strategy, debugInfo);
}

/**
 * Build results object from trades (with debug info)
 */
function buildResultsWithDebug(
  trades: any[],
  initialCapital: number,
  finalCash: number,
  symbols: string[],
  symbolStats: Map<string, { trades: number; wins: number; pnl: number }>,
  kellyParams: any,
  exitStrategy: string,
  debugInfo: any
) {
  const baseResults = buildResults(trades, initialCapital, finalCash, symbols, symbolStats, kellyParams, exitStrategy);
  return {
    ...baseResults,
    simulation_info: debugInfo
  };
}

/**
 * Calculate Kelly parameters from in-memory retest data
 */
function calculateKellyFromRetests(retests: any[]) {
  if (retests.length === 0) {
    return { winRate: 0.5, avgWinR: 1, avgLossR: 1, kellyFraction: 0, halfKellyFraction: 0.05, numTrades: 0 };
  }

  let wins = 0;
  let winRMultiples: number[] = [];
  let lossRMultiples: number[] = [];

  for (const r of retests) {
    const entryPrice = parseFloat(r.entry_price);
    const exitPrice = parseFloat(r.exit_price);
    const zoneLow = parseFloat(r.zone_low);
    const zoneHigh = parseFloat(r.zone_high);
    const zoneType = r.zone_type;

    let riskPerShare: number;
    let pnlPerShare: number;

    if (zoneType === 'demand') {
      riskPerShare = entryPrice - (zoneLow * 0.99);
      pnlPerShare = exitPrice - entryPrice;
    } else {
      riskPerShare = (zoneHigh * 1.01) - entryPrice;
      pnlPerShare = entryPrice - exitPrice;
    }

    if (riskPerShare <= 0) continue;

    const rMultiple = pnlPerShare / riskPerShare;

    if (pnlPerShare > 0) {
      wins++;
      winRMultiples.push(rMultiple);
    } else {
      lossRMultiples.push(Math.abs(rMultiple));
    }
  }

  const winRate = retests.length > 0 ? wins / retests.length : 0.5;
  const avgWinR = winRMultiples.length > 0 ? winRMultiples.reduce((a, b) => a + b, 0) / winRMultiples.length : 1;
  const avgLossR = lossRMultiples.length > 0 ? lossRMultiples.reduce((a, b) => a + b, 0) / lossRMultiples.length : 1;

  const b = avgLossR > 0 ? avgWinR / avgLossR : 1;
  let kelly = b > 0 ? winRate - (1 - winRate) / b : 0;
  kelly = Math.max(0, Math.min(kelly, 0.25));

  return {
    winRate,
    avgWinR,
    avgLossR,
    kellyFraction: kelly,
    halfKellyFraction: kelly / 2,
    numTrades: retests.length
  };
}

/**
 * Calculate Kelly parameters from database
 */
async function calculateKellyParamsFromDB(symbols: string[]) {
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
    ),
    r_multiples AS (
      SELECT
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
    return { winRate: 0.5, avgWinR: 1, avgLossR: 1, kellyFraction: 0, halfKellyFraction: 0.05, numTrades: 0 };
  }

  const winRate = parseFloat(row.win_rate);
  const avgWinR = parseFloat(row.avg_win_r);
  const avgLossR = parseFloat(row.avg_loss_r);
  const numTrades = parseInt(row.num_trades);

  const b = avgLossR > 0 ? avgWinR / avgLossR : 1;
  let kelly = b > 0 ? winRate - (1 - winRate) / b : 0;
  kelly = Math.max(0, Math.min(kelly, 0.25));

  return { winRate, avgWinR, avgLossR, kellyFraction: kelly, halfKellyFraction: kelly / 2, numTrades };
}

/**
 * Build results object from trades
 */
function buildResults(
  trades: any[],
  initialCapital: number,
  finalCash: number,
  symbols: string[],
  symbolStats: Map<string, { trades: number; wins: number; pnl: number }>,
  kellyParams: any,
  exitStrategy: string
) {
  const completedTrades = trades.filter(t => t.status !== 'Open');
  const winningTrades = completedTrades.filter(t => t.pnl > 0);
  const losingTrades = completedTrades.filter(t => t.pnl < 0);

  const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const totalPnl = totalWins - totalLosses;

  const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

  const winRate = completedTrades.length > 0 ? winningTrades.length / completedTrades.length : 0;
  const totalReturnPct = ((finalCash - initialCapital) / initialCapital) * 100;

  // Calculate max drawdown from equity curve
  let peak = initialCapital;
  let maxDrawdown = 0;
  let equity = initialCapital;
  const equityCurve: Array<[string, number]> = [];

  for (const trade of trades) {
    equity += trade.pnl;
    equityCurve.push([trade.exit_time, equity]);
    if (equity > peak) peak = equity;
    const drawdown = peak - equity;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const maxDrawdownPct = peak > 0 ? (maxDrawdown / peak) * 100 : 0;

  // Sharpe ratio approximation
  const returns = trades.map(t => t.pnl_pct / 100);
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

  // Symbol breakdown
  const symbolBreakdown = Array.from(symbolStats.entries()).map(([sym, stats]) => ({
    symbol: sym,
    total_trades: stats.trades,
    winning_trades: stats.wins,
    losing_trades: stats.trades - stats.wins,
    win_rate: stats.trades > 0 ? stats.wins / stats.trades : 0,
    total_pnl: stats.pnl
  })).filter(s => s.total_trades > 0);

  return {
    total_trades: trades.length,
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
    final_capital: finalCash,
    kelly_params: {
      win_rate: kellyParams.winRate,
      avg_win_r: kellyParams.avgWinR,
      avg_loss_r: kellyParams.avgLossR,
      half_kelly_pct: kellyParams.halfKellyFraction * 100,
      sample_size: kellyParams.numTrades
    },
    exit_strategy: exitStrategy,
    symbols_traded: symbols,
    symbol_breakdown: symbolBreakdown,
    trades,
    equity_curve: equityCurve
  };
}

function createEmptyResults(initialCapital: number, symbols: string[], exitStrategy: string) {
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
    final_capital: initialCapital,
    kelly_params: null,
    exit_strategy: exitStrategy,
    symbols_traded: symbols,
    symbol_breakdown: [],
    trades: [],
    equity_curve: []
  };
}


// new