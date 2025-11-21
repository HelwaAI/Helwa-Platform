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

  try {
    // Query zones by joining symbols table
    const query = `
      SELECT
        s.symbol,
        s.name as company_name,
        z.zone_id as zone_id,
        z.zone_type,
        z.created_at,
        z.updated_at,
        z.top_price,
	      z.bottom_price
      FROM crypto.zones z
      JOIN crypto.symbols s ON z.symbol_id = s.id
      WHERE
        ${symbols.length > 0 ? 's.symbol = ANY($1) AND' : ''}
        z.bottom_price IS NOT NULL AND is_broken = False
      ORDER BY s.symbol, z.bottom_price DESC
      LIMIT $2
    `;

    // Always pass symbols and limit in consistent order: $1 = symbols (or null), $2 = limit
    const limit = parseInt(searchParams.get('limit') || '100');
    const params = [symbols.length > 0 ? symbols : null, limit];
    const result = await pool.query(query, params);

    // Group zones by symbol
    const groupedZones: Record<string, any[]> = {};
    result.rows.forEach((row: any) => {
      if (!groupedZones[row.symbol]) {
        groupedZones[row.symbol] = [];
      }
      groupedZones[row.symbol].push({
        zone_id: row.zone_id,
        zone_type: row.zone_type,
        top_price: row.top_price,
        bottom_price: row.bottom_price,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    });

    // Convert to summary format
    const summaries = Object.entries(groupedZones).map(([symbol, zones]) => {
      return {
        symbol,
        zones,
        zone_count: zones.length,
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
