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
  const ZoneFirstRetestId = searchParams.get('ZoneFirstRetestId');

  if (!ZoneFirstRetestId) {
    return NextResponse.json(
      { success: false, error: 'ZoneFirstRetestId parameter is required' },
      { status: 400 }
    );
  }

  try {
    const query = `
      SELECT zone_id, visual_retest_time
      FROM stocks.zone_first_retests_cache
      WHERE id = $1`;

    const result = await pool.query(query, [ZoneFirstRetestId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `Zone retest ID ${ZoneFirstRetestId} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        zone_id: result.rows[0].zone_id,
        visual_retest_time: result.rows[0].visual_retest_time,
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
