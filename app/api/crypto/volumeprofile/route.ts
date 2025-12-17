import { NextResponse } from 'next/server';
import pkg from 'pg';
const { Pool } = pkg;
import {
  calculateVolumeProfile,
  VOLUME_PROFILE_CONFIG,
  type VolumeProfileResult,
} from '../../../../helpers/volumeProfile';

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
 * GET /api/crypto/volumeprofile
 *
 * Calculate volume profile for a crypto symbol over a specified period.
 *
 * Query Parameters:
 * - symbol (required): Crypto symbol (e.g., "X:BTCUSD")
 * - start_date (optional): ISO date string (default: 30 days ago)
 * - end_date (optional): ISO date string (default: now)
 * - num_bins (optional): Number of price bins (default: 50)
 * - timeframe (optional): Data timeframe (default: "5m")
 *
 * Returns:
 * - Volume profile with nodes, HVN/LVN classification, POC, and metadata
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // Required parameter
  const symbol = searchParams.get('symbol');
  if (!symbol) {
    return NextResponse.json(
      { success: false, error: 'symbol parameter is required' },
      { status: 400 }
    );
  }

  // Optional parameters with defaults
  const endDateStr = searchParams.get('end_date');
  const startDateStr = searchParams.get('start_date');
  const numBins = parseInt(searchParams.get('num_bins') || String(VOLUME_PROFILE_CONFIG.num_bins));
  const timeframe = searchParams.get('timeframe') || '5m';

  // Validate num_bins
  if (numBins < 10 || numBins > 200) {
    return NextResponse.json(
      { success: false, error: 'num_bins must be between 10 and 200' },
      { status: 400 }
    );
  }

  // Validate timeframe
  const validTimeframes = ['5m', '15m', '30m', '1h', '2h', '4h', '8h', '1d', '7d', '31d', '93d'];
  if (!validTimeframes.includes(timeframe)) {
    return NextResponse.json(
      { success: false, error: `Invalid timeframe. Valid options: ${validTimeframes.join(', ')}` },
      { status: 400 }
    );
  }

  // Calculate date range
  const endDate = endDateStr ? new Date(endDateStr) : new Date();
  const startDate = startDateStr
    ? new Date(startDateStr)
    : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago

  try {
    // Query crypto aggregates from the appropriate candles view
    const query = `
      SELECT
        mv.bucket,
        mv.high,
        mv.low,
        mv.volume
      FROM crypto.candles_${timeframe} mv
      JOIN crypto.symbols s ON mv.symbol_id = s.id
      WHERE
        s.symbol = $1
        AND mv.bucket >= $2
        AND mv.bucket <= $3
      ORDER BY mv.bucket ASC
    `;

    const result = await pool.query(query, [symbol, startDate.toISOString(), endDate.toISOString()]);

    if (result.rows.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          symbol,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          num_bins: numBins,
          timeframe,
          bar_count: 0,
          message: 'No data found for the specified symbol and date range',
          ...getEmptyVolumeProfile(),
        },
      });
    }

    // Transform database rows to bar data
    const bars = result.rows.map((row: any) => ({
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      volume: parseFloat(row.volume),
    }));

    // Calculate volume profile
    const volumeProfile = calculateVolumeProfile(bars, numBins);

    return NextResponse.json({
      success: true,
      data: {
        symbol,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        num_bins: numBins,
        timeframe,
        bar_count: bars.length,
        ...volumeProfile,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Volume profile calculation error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * Return empty volume profile structure for cases with no data
 */
function getEmptyVolumeProfile(): VolumeProfileResult {
  return {
    nodes: [],
    hvn_nodes: [],
    lvn_nodes: [],
    poc_node: null,
    hvn_threshold: 0,
    lvn_threshold: 0,
    total_volume: 0,
    price_range: [0, 0],
    bin_size: 0,
    poc_price: null,
  };
}
