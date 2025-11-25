"""
Lightweight Dashboard Generator - Self-contained TypeScript charts

Generates interactive trading dashboards with:
- Multiple timeframes (factors of 390 for stocks, various for crypto)
- Real candlestick data from database
- Supply/Demand zones overlayed
- Volume profile with HVN/LVN highlighting
- TypeScript-based lightweight-charts implementation
"""

import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from pathlib import Path

from database.utils.postgresql_utils import get_connection
from src.storage.azure_blob_manager import AzureBlobManager
from src.utils.logging_config import setup_logging
import os

logger = setup_logging()


class LightweightDashboardGenerator:
    """Generate self-contained TypeScript dashboards with lightweight-charts"""

    def __init__(self, market_type: str = 'stocks', skip_upload: bool = False):
        """
        Initialize dashboard generator

        Args:
            market_type: 'stocks' or 'crypto'
            skip_upload: If True, save locally instead of uploading to Azure
        """
        self.market_type = market_type
        self.schema = market_type  # stocks or crypto schema
        self.skip_upload = skip_upload

        # Initialize Azure Blob Manager with connection string
        if not skip_upload:
            connection_string = os.environ.get('AZURE_STORAGE_CONNECTION_STRING')
            self.blob_manager = AzureBlobManager(
                connection_string=connection_string,
                container_name='trading-charts'
            )
        else:
            self.blob_manager = None

        self.template_path = Path(__file__).parent / 'templates' / 'lightweight_dashboard.html'

        # Timeframe configurations (in minutes) with lookback days
        if market_type == 'stocks':
            # Stocks: Comprehensive intraday + multi-day timeframes
            # All timeframes have materialized views for optimal performance
            self.timeframes = {
                # Sub-hour timeframes
                '2min': 2,         # Ultra-short scalping
                '3min': 3,         # Short-term momentum
                '5min': 5,         # Intraday entry precision
                '6min': 6,         # 1/65th of trading day
                '10min': 10,       # Intraday swing points
                '13min': 13,       # 1/30th of trading day
                '15min': 15,       # Popular intraday timeframe
                '26min': 26,       # 1/15th of trading day
                '30min': 30,       # Half-hour analysis
                '39min': 39,       # 1/10th of trading day
                '65min': 65,       # 1/6th of trading day
                '78min': 78,       # 1/5th of trading day
                '130min': 130,     # 1/3rd of trading day
                '195min': 195,     # 1/2 of trading day
                '390min': 390,     # 1 full trading day
                # Multi-day timeframes
                '5day': 1950,      # 5 trading days (1 week)
                '22day': 8580,     # 22 trading days (1 month)
                '65day': 25350,    # 65 trading days (3 months)
            }

            # Lookback days per timeframe (optimized for each period)
            self.lookback_days_map = {
                '2min': 5,         # 5 days for 2min (intraday focus)
                '3min': 7,         # 1 week for 3min
                '5min': 14,        # 2 weeks for 5min
                '6min': 14,        # 2 weeks for 6min
                '10min': 30,       # 1 month for 10min
                '13min': 30,       # 1 month for 13min
                '15min': 60,       # 2 months for 15min
                '26min': 90,       # 3 months for 26min
                '30min': 90,       # 3 months for 30min
                '39min': 180,      # 6 months for 39min
                '65min': 180,      # 6 months for 65min
                '78min': 180,      # 6 months for 78min
                '130min': 365,     # 1 year for 130min
                '195min': 365,     # 1 year for 195min
                '390min': 730,     # 2 years for daily
                '5day': 730,       # 2 years for weekly
                '22day': 1095,     # 3 years for monthly
                '65day': 1825,     # 5 years for quarterly
            }
        else:  # crypto
            # Crypto: 24/7 trading with comprehensive timeframe coverage
            self.timeframes = {
                # Intraday timeframes
                '5min': 5,         # Scalping
                '15min': 15,       # Short-term
                '30min': 30,       # Intraday
                '1hour': 60,       # Hourly analysis
                '2hour': 120,      # 2-hour structure
                '4hour': 240,      # 4-hour swings
                '8hour': 480,      # Major session divisions
                '1day': 1440,      # Daily candles
                # Multi-day timeframes
                '7day': 10080,     # Weekly (7 days * 24h * 60m)
                '31day': 44640,    # Monthly (31 days * 24h * 60m)
                '93day': 133920,   # Quarterly (93 days * 24h * 60m)
            }

            # Lookback days per crypto timeframe
            self.lookback_days_map = {
                '5min': 7,         # 1 week for scalping
                '15min': 14,       # 2 weeks for short-term
                '30min': 30,       # 1 month for intraday
                '1hour': 60,       # 2 months for hourly
                '2hour': 90,       # 3 months for 2h
                '4hour': 180,      # 6 months for 4h
                '8hour': 365,      # 1 year for 8h
                '1day': 730,       # 2 years for daily
                '7day': 1095,      # 3 years for weekly
                '31day': 1825,     # 5 years for monthly
                '93day': 2555,     # 7 years for quarterly
            }

    def generate_dashboard(
        self,
        symbol: str,
        lookback_days: int = 30
    ) -> Tuple[Optional[str], bool]:
        """
        Generate complete dashboard with all timeframes

        Args:
            symbol: Stock or crypto symbol
            lookback_days: Number of days to fetch data

        Returns:
            Tuple of (dashboard_url, was_uploaded)
        """
        try:
            logger.info(f"Generating dashboard for {symbol} ({self.market_type})")

            # Fetch all data
            dashboard_data = self._fetch_dashboard_data(symbol, lookback_days)

            if not dashboard_data:
                logger.warning(f"No data available for {symbol}")
                return None, False

            # Render HTML
            html_content = self._render_html(dashboard_data)

            if self.skip_upload:
                # Save locally
                output_dir = Path('data/dashboards')
                output_dir.mkdir(parents=True, exist_ok=True)
                filename = f"{self.market_type}_{symbol.replace(':', '_').lower()}_dashboard.html"
                filepath = output_dir / filename
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(html_content)
                logger.info(f"Dashboard saved locally: {filepath}")
                return str(filepath), True
            else:
                # Upload to Azure
                filename = f"{self.market_type}_{symbol.replace(':', '_').lower()}_dashboard.html"
                url = self.blob_manager.upload_html(html_content, filename)
                logger.info(f"Dashboard generated: {url}")
                return url, True

        except Exception as e:
            logger.error(f"Error generating dashboard for {symbol}: {e}")
            return None, False

    def _fetch_dashboard_data(self, symbol: str, lookback_days: int) -> Optional[Dict]:
        """Fetch all dashboard data from database"""
        conn = None
        cursor = None
        
        try:
            conn = get_connection()
            cursor = conn.cursor()

            # Get symbol_id
            cursor.execute(
                f"SELECT id FROM {self.schema}.symbols WHERE symbol = %s",
                (symbol,)
            )
            result = cursor.fetchone()
            if not result:
                logger.warning(f"Symbol {symbol} not found in {self.schema}.symbols")
                if cursor:
                    cursor.close()
                if conn:
                    conn.close()
                return None

            symbol_id = result[0]

            # End date is always current time
            end_date = datetime.utcnow()

            dashboard_data = {
                'symbol': symbol,
                'market_type': self.market_type.upper(),
                'timeframes': {}
            }

            # Fetch data for each timeframe with appropriate lookback period
            for tf_name, tf_minutes in self.timeframes.items():
                logger.info(f"Fetching {tf_name} data for {symbol}")

                try:
                    # Calculate start date based on timeframe's lookback days
                    tf_lookback_days = self.lookback_days_map.get(tf_name, lookback_days)
                    start_date = end_date - timedelta(days=tf_lookback_days)

                    # Fetch candles
                    candles = self._fetch_candles(cursor, symbol_id, start_date, end_date, tf_minutes)

                    # Fetch zones for this timeframe
                    zones = self._fetch_zones(cursor, symbol_id, tf_name)

                    # Fetch volume profile
                    volume_profile = self._fetch_volume_profile(cursor, symbol_id, start_date, end_date)

                    dashboard_data['timeframes'][tf_name] = {
                        'candles': candles,
                        'zones': zones,
                        'volume_profile': volume_profile
                    }

                except Exception as e:
                    logger.error(f"Error fetching {tf_name} data: {e}")
                    # Rollback transaction and close old cursor/connection
                    if conn:
                        conn.rollback()
                    if cursor:
                        cursor.close()
                    
                    # Get new connection for next timeframe
                    conn = get_connection()
                    cursor = conn.cursor()
                    
                    # Skip this timeframe but continue with others
                    dashboard_data['timeframes'][tf_name] = {
                        'candles': [],
                        'zones': [],
                        'volume_profile': []
                    }
                    continue

            # Close cursor and connection
            if cursor:
                cursor.close()
            if conn:
                conn.close()

            return dashboard_data

        except Exception as e:
            logger.error(f"Error fetching dashboard data: {e}")
            # Rollback and cleanup on fatal error
            if conn:
                conn.rollback()
            if cursor:
                cursor.close()
            if conn:
                conn.close()
            return None

    def _fetch_candles(
        self,
        cursor,
        symbol_id: int,
        start_date: datetime,
        end_date: datetime,
        timeframe_minutes: int
    ) -> List[Dict]:
        """Fetch candle data from materialized views (preferred) or aggregate on-the-fly"""
        try:
            # Map timeframe_minutes to materialized view names
            matview_map = {
                2: 'candles_2m',
                3: 'candles_3m',
                5: 'candles_5m',
                6: 'candles_6m',
                10: 'candles_10m',
                13: 'candles_13m',
                15: 'candles_15m',
                26: 'candles_26m',
                30: 'candles_30m',
                39: 'candles_39m',
                65: 'candles_65m',
                78: 'candles_78m',
                130: 'candles_130m',
                195: 'candles_195m',
                390: 'candles_390m',
                1950: 'candles_5d',
                8580: 'candles_22d',
                25350: 'candles_65d',
                # Crypto timeframes
                60: 'candles_1h',
                120: 'candles_2h',
                240: 'candles_4h',
                480: 'candles_8h',
                1440: 'candles_1d',
                10080: 'candles_7d',
                44640: 'candles_31d',
                133920: 'candles_93d',
            }

            matview_name = matview_map.get(timeframe_minutes)
            use_matview = False

            if matview_name:
                # Check if materialized view exists
                try:
                    cursor.execute(
                        """
                        SELECT EXISTS (
                            SELECT 1 FROM pg_matviews 
                            WHERE schemaname = %s AND matviewname = %s
                        )
                        """,
                        (self.schema, matview_name)
                    )
                    use_matview = cursor.fetchone()[0]
                except Exception as check_error:
                    logger.warning(f"Error checking materialized view {matview_name}: {check_error}")
                    use_matview = False

            if use_matview:
                # Use materialized view for optimal performance
                query = f"""
                    SELECT
                        EXTRACT(EPOCH FROM bucket)::bigint as time,
                        open, high, low, close, volume
                    FROM {self.schema}.{matview_name}
                    WHERE symbol_id = %s
                        AND bucket >= %s
                        AND bucket <= %s
                    ORDER BY bucket ASC
                """
                cursor.execute(query, (symbol_id, start_date, end_date))
                logger.info(f"Using materialized view: {self.schema}.{matview_name}")
            else:
                # Fallback: aggregate minute data on-the-fly
                logger.info(f"No materialized view for {timeframe_minutes}min, aggregating on-the-fly")
                
                if timeframe_minutes <= 15:
                    # Small timeframes: filter minute_aggregates
                    query = f"""
                        SELECT
                            EXTRACT(EPOCH FROM timestamp)::bigint as time,
                            open, high, low, close, volume
                        FROM {self.schema}.minute_aggregates
                        WHERE symbol_id = %s
                            AND timestamp >= %s
                            AND timestamp <= %s
                            AND EXTRACT(MINUTE FROM timestamp) %% %s = 0
                        ORDER BY timestamp ASC
                    """
                    cursor.execute(query, (symbol_id, start_date, end_date, timeframe_minutes))
                else:
                    # Large timeframes: aggregate using time_bucket
                    query = f"""
                        SELECT
                            EXTRACT(EPOCH FROM time_bucket(%s, timestamp))::bigint as time,
                            (array_agg(open ORDER BY timestamp))[1] as open,
                            MAX(high) as high,
                            MIN(low) as low,
                            (array_agg(close ORDER BY timestamp DESC))[1] as close,
                            SUM(volume) as volume
                        FROM {self.schema}.minute_aggregates
                        WHERE symbol_id = %s
                            AND timestamp >= %s
                            AND timestamp <= %s
                        GROUP BY time_bucket(%s, timestamp)
                        ORDER BY time ASC
                    """
                    bucket_interval = f'{timeframe_minutes} minutes'
                    cursor.execute(
                        query,
                        (bucket_interval, symbol_id, start_date, end_date, bucket_interval)
                    )

            rows = cursor.fetchall()
            candles = []

            for row in rows:
                candles.append({
                    'time': row[0],
                    'open': float(row[1]),
                    'high': float(row[2]),
                    'low': float(row[3]),
                    'close': float(row[4]),
                    'volume': float(row[5]) if row[5] else 0.0
                })

            logger.info(f"Fetched {len(candles)} candles")
            return candles

        except Exception as e:
            logger.error(f"Error fetching candles: {e}", exc_info=True)
            return []

    def _fetch_zones(self, cursor, symbol_id: int, timeframe: str) -> List[Dict]:
        """Fetch zones for specific timeframe with breakout tracking"""
        try:
            # Get timeframe_id
            cursor.execute(
                "SELECT id FROM shared.timeframes WHERE label = %s",
                (timeframe,)
            )
            result = cursor.fetchone()
            if not result:
                logger.warning(f"Timeframe {timeframe} not found in shared.timeframes")
                return []

            timeframe_id = result[0]
            logger.info(f"Found timeframe_id={timeframe_id} for label '{timeframe}'")

            # Fetch zones with breakout information
            query = f"""
                SELECT
                    zone_id,
                    zone_type,
                    bottom_price,
                    top_price,
                    EXTRACT(EPOCH FROM start_time)::bigint as start_time,
                    EXTRACT(EPOCH FROM end_time)::bigint as end_time,
                    COALESCE(zone_score, 0.0) as zone_score,
                    is_broken
                FROM {self.schema}.zones
                WHERE symbol_id = %s
                    AND timeframe_id = %s
                ORDER BY zone_score DESC, start_time DESC
                LIMIT 30
            """
            cursor.execute(query, (symbol_id, timeframe_id))
            rows = cursor.fetchall()

            zones = []
            for row in rows:
                zone_data = {
                    'zone_id': row[0],
                    'zone_type': row[1],
                    'bottom_price': float(row[2]),
                    'top_price': float(row[3]),
                    'start_time': row[4],
                    'end_time': row[5],
                    'zone_score': float(row[6]),
                    'is_broken': row[7],
                    'exit_price': None,  # Not tracked in database
                    'exit_time': None,   # Not tracked in database
                    'timeframe': timeframe
                }
                zones.append(zone_data)

            active_zones = [z for z in zones if not z['is_broken']]
            broken_zones = [z for z in zones if z['is_broken']]
            
            logger.info(f"Fetched {len(active_zones)} active zones and {len(broken_zones)} broken zones for {timeframe}")
            return zones

        except Exception as e:
            logger.error(f"Error fetching zones: {e}", exc_info=True)
            return []

    def _fetch_volume_profile(
        self,
        cursor,
        symbol_id: int,
        start_date: datetime,
        end_date: datetime
    ) -> List[Dict]:
        """Fetch volume profile data"""
        try:
            # Different schemas have different column names
            if self.schema == 'stocks':
                # Stocks schema uses period_start (timestamp)
                date_column = 'period_start'
                params = (symbol_id, start_date, end_date)
            else:
                # Crypto schema uses date (date type)
                date_column = 'date'
                params = (symbol_id, start_date.date(), end_date.date())

            query = f"""
                SELECT
                    price_level as price,
                    SUM(volume) as total_volume,
                    BOOL_OR(node_type = 'HVN') as is_hvn,
                    BOOL_OR(node_type = 'LVN') as is_lvn
                FROM {self.schema}.volume_profile
                WHERE symbol_id = %s
                    AND {date_column} >= %s
                    AND {date_column} <= %s
                GROUP BY price_level
                ORDER BY total_volume DESC
                LIMIT 50
            """
            cursor.execute(query, params)
            rows = cursor.fetchall()

            nodes = []
            for row in rows:
                nodes.append({
                    'price': float(row[0]),
                    'dollar_volume': float(row[1]) if row[1] else 0.0,
                    'is_hvn': bool(row[2]) if row[2] is not None else False,
                    'is_lvn': bool(row[3]) if row[3] is not None else False
                })

            logger.info(f"Fetched {len(nodes)} volume profile nodes")
            return nodes

        except Exception as e:
            logger.error(f"Error fetching volume profile: {e}", exc_info=True)
            return []

    def _render_html(self, dashboard_data: Dict) -> str:
        """Render HTML from template with dashboard data"""
        try:
            # Read template
            with open(self.template_path, 'r', encoding='utf-8') as f:
                template = f.read()

            # Prepare data for JavaScript (convert to JSON)
            dashboard_json = json.dumps(dashboard_data, indent=2)

            # Get current timestamp
            timestamp = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')

            # Replace placeholders
            html = template.replace('{{SYMBOL}}', dashboard_data['symbol'])
            html = html.replace('{{MARKET_TYPE}}', dashboard_data['market_type'])
            html = html.replace('{{TIMESTAMP}}', timestamp)
            html = html.replace('{{DASHBOARD_DATA}}', dashboard_json)

            return html

        except Exception as e:
            logger.error(f"Error rendering HTML: {e}")
            raise


# Convenience functions for quick dashboard generation
def generate_stock_dashboard(symbol: str, lookback_days: int = 30, skip_upload: bool = False) -> Tuple[Optional[str], bool]:
    """Generate dashboard for stock symbol"""
    generator = LightweightDashboardGenerator(market_type='stocks', skip_upload=skip_upload)
    return generator.generate_dashboard(symbol, lookback_days)


def generate_crypto_dashboard(symbol: str, lookback_days: int = 30, skip_upload: bool = False) -> Tuple[Optional[str], bool]:
    """Generate dashboard for crypto symbol"""
    generator = LightweightDashboardGenerator(market_type='crypto', skip_upload=skip_upload)
    return generator.generate_dashboard(symbol, lookback_days)


def generate_all_stock_dashboards(lookback_days: int = 90, skip_upload: bool = False) -> Dict[str, str]:
    """
    Generate dashboards for all stocks in the database

    Args:
        lookback_days: Number of days of historical data to include
        skip_upload: If True, save locally instead of uploading to Azure

    Returns:
        Dictionary mapping symbol to dashboard URL (or local path)
    """
    from database.utils.postgresql_utils import get_connection

    results = {}
    conn = None
    cursor = None

    try:
        # Get all stock symbols from database
        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("""
            SELECT DISTINCT symbol
            FROM stocks.symbols
            ORDER BY symbol
        """)

        symbols = [row[0] for row in cursor.fetchall()]
        logger.info(f"Found {len(symbols)} stocks to process")

        # Close cursor/connection before generating dashboards
        cursor.close()
        conn.close()
        cursor = None
        conn = None

        # Generate dashboard for each symbol
        generator = LightweightDashboardGenerator(market_type='stocks', skip_upload=skip_upload)

        for idx, symbol in enumerate(symbols, 1):
            try:
                logger.info(f"[{idx}/{len(symbols)}] Generating dashboard for {symbol}...")
                url, uploaded = generator.generate_dashboard(symbol, lookback_days)

                if url:
                    results[symbol] = url
                    logger.info(f"SUCCESS: {symbol} -> {url}")
                else:
                    logger.warning(f"SKIP: {symbol} - No data or generation failed")

            except Exception as e:
                logger.error(f"ERROR: {symbol} - {e}")
                continue

        logger.info(f"Batch generation complete: {len(results)}/{len(symbols)} dashboards generated")
        return results

    except Exception as e:
        logger.error(f"Error in batch dashboard generation: {e}")
        return results
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


if __name__ == '__main__':
    """Command line dashboard generation"""
    import sys
    import argparse
    from database.utils.postgresql_utils import PostgreSQLConnectionPool

    # Initialize connection pool
    pool = PostgreSQLConnectionPool.get_instance()
    pool.initialize()

    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Generate lightweight trading dashboards')
    parser.add_argument('symbol', nargs='?', help='Stock or crypto symbol (e.g., AAPL, X:BTCUSD)')
    parser.add_argument('--days', type=int, default=90, help='Lookback days (default: 90)')
    parser.add_argument('--all-stocks', action='store_true', help='Generate dashboards for all stocks')
    parser.add_argument('--skip-upload', action='store_true', help='Save locally instead of uploading to Azure')
    parser.add_argument('--crypto', action='store_true', help='Generate crypto dashboard instead of stock')

    args = parser.parse_args()

    if args.all_stocks:
        # Batch generation for all stocks
        print(f"Generating dashboards for ALL stocks ({args.days} days lookback)...")
        results = generate_all_stock_dashboards(lookback_days=args.days, skip_upload=args.skip_upload)

        print(f"\nBatch generation complete:")
        print(f"  Total dashboards: {len(results)}")
        print(f"  Lookback days: {args.days}")
        print(f"  Upload mode: {'Local' if args.skip_upload else 'Azure Blob'}")

        if results:
            print(f"\nGenerated dashboards:")
            for symbol, url in sorted(results.items()):
                print(f"  {symbol}: {url}")

    elif args.symbol:
        # Single symbol generation
        if args.crypto:
            print(f"Generating crypto dashboard for {args.symbol}...")
            url, uploaded = generate_crypto_dashboard(args.symbol, lookback_days=args.days, skip_upload=args.skip_upload)
        else:
            print(f"Generating stock dashboard for {args.symbol}...")
            url, uploaded = generate_stock_dashboard(args.symbol, lookback_days=args.days, skip_upload=args.skip_upload)

        if url:
            print(f"SUCCESS: {url}")
        else:
            print(f"FAIL: Dashboard generation failed for {args.symbol}")

    else:
        # No arguments - show help
        parser.print_help()
        sys.exit(1)
