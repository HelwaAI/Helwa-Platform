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
  try {
    // Query for top performing stocks that were ACTUALLY ALERTED by the production system
    // Only includes zones from zone_touch_events where alerted = true
    // const query = `
    // SELECT * FROM (
    //       SELECT DISTINCT ON (s.symbol)
    //           s.symbol,
    //           z.zone_type,
    //           DATE(zte.entry_time) AS bounce_day,
    //           c.bounce_close,
    //           c.return_1d,
    //           c.return_2d,
    //           c.return_3d,
    //           c.return_5d,
    //           zte.zone_id
    //       FROM stocks.zone_touch_events zte
    //       JOIN stocks.zones z ON zte.zone_id = z.zone_id
    //       JOIN stocks.symbols s ON z.symbol_id = s.id
    //       JOIN stocks.zone_first_retests_cache c ON zte.zone_id = c.zone_id
    //       WHERE zte.alerted = true
    //         AND z.zone_type = 'demand'
    //         AND c.return_5d IS NOT NULL
    //         AND zte.entry_time >= CURRENT_DATE - INTERVAL '22 days'
    //       ORDER BY s.symbol, c.return_5d DESC
    //   ) best_per_symbol
    //   ORDER BY return_5d DESC
    //   LIMIT 3
    // `;

    const firstquery = `WITH best_per_symbol AS (
          SELECT ht.symbol,
                ht.zone_type,
                ht.entry_time,
                ht.pnl_percent,
                ht.entry_price,
                s.compliance,
            ht.zone_id,
                ROW_NUMBER() OVER (
                    PARTITION BY ht.symbol
                    ORDER BY ht.pnl_percent DESC
                ) AS rn
          FROM stocks.historical_trades ht
          JOIN stocks.symbols s 
            ON s.id = ht.symbol_id
          WHERE ht.entry_time >= date_trunc('month', current_date)
            AND ht.entry_time <  date_trunc('month', current_date) + interval '1 month'
      )
      SELECT symbol, zone_type, entry_time, pnl_percent, entry_price, compliance, zone_id
      FROM best_per_symbol
      WHERE rn = 1
        AND compliance != 'non-compliant'
        AND zone_type = 'demand'
      ORDER BY pnl_percent DESC
      LIMIT 3`;

    // First, try to get 3 results from current month
    const firstResult = await pool.query(firstquery);
    let finalResults = firstResult.rows;

    // If we got less than 3, keep going back month by month until we have 3
    let monthOffset = 1; // Start with 1 month back (previous month)
    const maxMonthsBack = 12; // Don't go back more than a year

    while (finalResults.length < 3 && monthOffset <= maxMonthsBack) {
      const remainingCount = 3 - finalResults.length;
      console.log(`Only got ${finalResults.length} results so far, fetching ${remainingCount} from ${monthOffset} month(s) back`);

      // Build query for N months back
      const monthBackQuery = `WITH best_per_symbol AS (
        SELECT ht.symbol,
              ht.zone_type,
              ht.entry_time,
              ht.pnl_percent,
              ht.entry_price,
              s.compliance,
              ht.zone_id,
              ROW_NUMBER() OVER (
                  PARTITION BY ht.symbol
                  ORDER BY ht.pnl_percent DESC
              ) AS rn
        FROM stocks.historical_trades ht
        JOIN stocks.symbols s ON s.id = ht.symbol_id
        WHERE ht.entry_time >= date_trunc('month', current_date) - interval '${monthOffset} months'
          AND ht.entry_time < date_trunc('month', current_date) - interval '${monthOffset - 1} months'
      )
      SELECT symbol, zone_type, entry_time, pnl_percent, entry_price, compliance, zone_id
      FROM best_per_symbol
      WHERE rn = 1 AND compliance != 'non-compliant'
            AND zone_type = 'demand'
      ORDER BY pnl_percent DESC
      LIMIT ${remainingCount}`;

      const monthBackResult = await pool.query(monthBackQuery);

      if (monthBackResult.rows.length > 0) {
        finalResults = [...finalResults, ...monthBackResult.rows];
      }

      monthOffset++;
    }

    return NextResponse.json({
      success: true,
      data: finalResults,
      count: finalResults.length,
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
