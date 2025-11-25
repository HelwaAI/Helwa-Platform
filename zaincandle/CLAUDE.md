# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Lightweight Trading Dashboard Generator** - a Python tool that generates self-contained, interactive HTML trading dashboards with candlestick charts, supply/demand zones, and volume profiles. Dashboards can be hosted on Azure Blob Storage or saved locally.

### Technology Stack
- **Backend**: Python 3
- **Database**: PostgreSQL (with materialized views for optimized performance)
- **Frontend**: lightweight-charts (v4.1.1), vanilla TypeScript/JavaScript
- **Storage**: Azure Blob Storage (optional, with local fallback)
- **Styling**: CSS Grid/Flexbox with dark theme

## Project Structure

```
├── lightweight_dashboard_generator.py    # Main Python class for dashboard generation
├── templates/
│   └── lightweight_dashboard.html        # HTML template with embedded JavaScript
└── CLAUDE.md                            # This file
```

## Core Architecture

### `LightweightDashboardGenerator` Class (lightweight_dashboard_generator.py:25)
Main orchestrator that:
1. **Fetches data** from PostgreSQL for candlesticks, zones, and volume profiles
2. **Renders HTML** by injecting data into the template
3. **Uploads/saves** the final dashboard

#### Market Types
- **Stocks** (17 timeframes): `2min`, `3min`, `5min`, ... `390min` (daily), `5day`, `22day`, `65day`
  - Lookback periods: 5-1825 days depending on timeframe
  - Uses materialized views: `candles_2m`, `candles_5m`, etc.

- **Crypto** (11 timeframes): `5min`, `15min`, `30min`, `1hour`, `2hour`, `4hour`, `8hour`, `1day`, `7day`, `31day`, `93day`
  - Lookback periods: 7-2555 days depending on timeframe
  - Uses materialized views: `candles_1h`, `candles_4h`, etc.

### Data Pipeline
1. **Candle Fetching** (lightweight_dashboard_generator.py:279-413):
   - Prefers PostgreSQL materialized views for performance
   - Falls back to on-the-fly aggregation from `minute_aggregates` table
   - For small timeframes (≤15min): filters directly from minute data
   - For large timeframes: uses `time_bucket()` for aggregation

2. **Zone Fetching** (lightweight_dashboard_generator.py:415-476):
   - Retrieves supply/demand zones from `{schema}.zones` table
   - Includes zone scores and breakout status
   - Limits to top 30 zones per timeframe

3. **Volume Profile** (lightweight_dashboard_generator.py:478-528):
   - Fetches top 50 price levels from `{schema}.volume_profile`
   - Identifies HVN (High Volume Node) and LVN (Low Volume Node)
   - Aggregates volumes across the lookback period

### HTML Template (lightweight_dashboard.html)
Self-contained interactive dashboard with:
- **Chart Library**: lightweight-charts v4.1.1 (from CDN)
- **Data Injection**: Python replaces `{{SYMBOL}}`, `{{MARKET_TYPE}}`, `{{TIMESTAMP}}`, `{{DASHBOARD_DATA}}`
- **Interactive Features**:
  - Timeframe tab switching (JavaScript:481-485)
  - Zone visualization as filled rectangles with custom RectanglePrimitive plugin (lines 244-396)
  - Volume profile sidebar with HVN/LVN highlighting (lines 612-676)
  - Legend showing active/broken zone counts (lines 721-753)
  - Auto-scaling with visible range tracking (lines 602-609)

## Common Development Tasks

### Generate a dashboard programmatically
```python
from lightweight_dashboard_generator import LightweightDashboardGenerator

# Stocks
generator = LightweightDashboardGenerator(market_type='stocks', skip_upload=False)
url, uploaded = generator.generate_dashboard('AAPL', lookback_days=90)

# Crypto
generator = LightweightDashboardGenerator(market_type='crypto', skip_upload=True)
path, saved = generator.generate_dashboard('X:BTCUSD', lookback_days=30)
```

### Command line usage
```bash
# Single stock dashboard
python lightweight_dashboard_generator.py AAPL --days 90

# Crypto dashboard (local save)
python lightweight_dashboard_generator.py X:BTCUSD --crypto --skip-upload

# All stocks batch generation
python lightweight_dashboard_generator.py --all-stocks --days 180
```

## Key Dependencies

- PostgreSQL driver (psycopg2 via `database.utils.postgresql_utils`)
- Azure Storage SDK (via `src.storage.azure_blob_manager`)
- Custom logging config (`src.utils.logging_config`)

All external dependencies must be importable before running the generator.

## Database Schema Notes

The code assumes:
- Two schemas: `stocks` and `crypto` (selectable via `market_type`)
- Both schemas have: `symbols`, `minute_aggregates`, `zones`, `volume_profile` tables
- A shared schema with `timeframes` table (accessed at lightweight_dashboard_generator.py:420)
- Materialized views for all timeframes (names like `candles_5m`, `candles_1h`, etc.)

## Important Implementation Details

1. **Materialized Views Priority**: The code checks if a materialized view exists before falling back to on-the-fly aggregation (lightweight_dashboard_generator.py:320-338). This is critical for performance.

2. **Zone Breaking Logic**: A zone is marked "broken" when price CLOSES beyond zone boundaries (full penetration):
   - Demand: broken if close < bottom_price
   - Supply: broken if close > top_price
   (See lightweight_dashboard.html:531-550)

3. **Volume Profile Filtering**: The dashboard shows only the top 20 nodes but filters by visible price range when scrolling (lightweight_dashboard.html:679-719).

4. **Error Recovery**: If a timeframe fetch fails, the code rolls back the transaction and reconnects rather than crashing (lightweight_dashboard_generator.py:240-258).

5. **Azure Integration**: Connection string comes from `AZURE_STORAGE_CONNECTION_STRING` environment variable. Set `skip_upload=True` for local development.

## HTML Template Rendering

The template uses simple string replacement for data injection:
- `{{SYMBOL}}` → stock/crypto symbol
- `{{MARKET_TYPE}}` → "STOCKS" or "CRYPTO"
- `{{TIMESTAMP}}` → generation timestamp (UTC)
- `{{DASHBOARD_DATA}}` → JSON object with all timeframe data

This makes the dashboard self-contained and requires no external API calls once generated.
