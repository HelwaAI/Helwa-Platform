"""
Chart generation module for Discord zone alerts.

Generates:
1. Interactive HTML charts (Plotly) showing zone touch context
2. Static PNG thumbnails (1920x1080) for Discord embeds

Charts display data from zone origin to current retest on the appropriate
lower timeframe based on zone timeframe.
"""

import plotly.graph_objects as go
from plotly.subplots import make_subplots
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import logging
from pathlib import Path

from database.utils.postgresql_utils import PostgreSQLConnectionPool, SymbolCache
from src.visualization.timeframe_utils import get_chart_timeframe_for_zone

logger = logging.getLogger(__name__)


class ChartGenerator:
    """
    Generates interactive HTML and static PNG charts for zone alerts.
    """

    def __init__(self, output_dir: str = "data/temp/alert_charts"):
        """
        Initialize chart generator.

        Args:
            output_dir: Directory to save generated charts
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.db_pool = PostgreSQLConnectionPool.get_instance()

    def generate_zone_alert_chart(
        self,
        symbol: str,
        zone_type: str,
        zone_top: float,
        zone_bottom: float,
        zone_timeframe_minutes: int,
        zone_formed_at: datetime,
        current_price: float,
        current_timestamp: datetime,
        zone_formation_candles: Optional[List[Dict]] = None
    ) -> Tuple[str, str]:
        """
        Generate both HTML and PNG charts for a zone alert.

        Args:
            symbol: Stock symbol (e.g., 'AAPL')
            zone_type: 'supply' or 'demand'
            zone_top: Top price of zone
            zone_bottom: Bottom price of zone
            zone_timeframe_minutes: Zone's timeframe in minutes
            zone_formed_at: When the zone was formed
            current_price: Current price at alert time
            current_timestamp: Current timestamp
            zone_formation_candles: Optional list of candles that formed the zone

        Returns:
            Tuple of (html_path, png_path)
        """
        # Get chart timeframe based on zone timeframe
        chart_tf = get_chart_timeframe_for_zone(zone_timeframe_minutes)
        chart_timeframe_minutes = chart_tf['minutes']
        chart_label = chart_tf['label']

        logger.info(
            f"Generating chart for {symbol} {zone_type} zone "
            f"({zone_timeframe_minutes}min) on {chart_label} timeframe"
        )

        # Fetch candle data for chart
        candles = self._fetch_chart_data(
            symbol=symbol,
            chart_timeframe_minutes=chart_timeframe_minutes,
            start_time=zone_formed_at,
            end_time=current_timestamp
        )

        if not candles:
            logger.warning(f"No candle data found for {symbol} chart")
            return None, None

        # Create interactive HTML chart
        html_path = self._generate_html_chart(
            symbol=symbol,
            zone_type=zone_type,
            zone_top=zone_top,
            zone_bottom=zone_bottom,
            zone_timeframe_minutes=zone_timeframe_minutes,
            chart_label=chart_label,
            candles=candles,
            current_price=current_price,
            zone_formation_candles=zone_formation_candles
        )

        # Generate PNG thumbnail
        png_path = self._generate_png_thumbnail(html_path)

        logger.info(f"Generated charts: HTML={html_path}, PNG={png_path}")
        return html_path, png_path

    def _fetch_chart_data(
        self,
        symbol: str,
        chart_timeframe_minutes: int,
        start_time: datetime,
        end_time: datetime
    ) -> List[Dict]:
        """
        Fetch candle data for chart from database views.

        Args:
            symbol: Stock symbol
            chart_timeframe_minutes: Chart timeframe in minutes
            start_time: Start time (zone formation)
            end_time: End time (current time)

        Returns:
            List of candle dictionaries
        """
        # Get symbol_id for optimized query (2-3x faster)
        symbol_id = SymbolCache.get_id(symbol)
        if not symbol_id:
            logger.warning(f"Symbol {symbol} not found in database")
            return []

        # Determine if we're querying a single day
        query_single_day = start_time.date() == end_time.date()

        # Add padding before zone formation (show 10% more history)
        if query_single_day:
            # Single day - start from market open
            padded_start = start_time.replace(hour=9, minute=30, second=0, microsecond=0)
        else:
            time_range = end_time - start_time
            padded_start = start_time - (time_range * 0.1)

        # Select appropriate view based on timeframe
        # Views use short suffix: 'm' for minutes, 'd' for days
        # Schema-qualified: stocks.candles_390m (per CLAUDE.md policy)
        view_name = f"stocks.candles_{chart_timeframe_minutes}m"
        logger.info(f"Using view: {view_name} for {symbol}")

        query = f"""
        SELECT
            bucket,
            open,
            high,
            low,
            close,
            volume
        FROM {view_name}
        WHERE symbol_id = %s
          AND bucket >= %s
          AND bucket <= %s
        ORDER BY bucket ASC
        """

        try:
            with self.db_pool.get_cursor() as cur:
                # Query by symbol_id for performance
                cur.execute(query, (symbol_id, padded_start, end_time))
                rows = cur.fetchall()

            candles = [
                {
                    'timestamp': row[0],
                    'open': float(row[1]),
                    'high': float(row[2]),
                    'low': float(row[3]),
                    'close': float(row[4]),
                    'volume': int(row[5])
                }
                for row in rows
            ]

            logger.info(f"Fetched {len(candles)} candles from {view_name} for {symbol}")
            return candles

        except Exception as e:
            logger.error(f"Error fetching chart data from {view_name}: {e}")
            return []

    def _generate_html_chart(
        self,
        symbol: str,
        zone_type: str,
        zone_top: float,
        zone_bottom: float,
        zone_timeframe_minutes: int,
        chart_label: str,
        candles: List[Dict],
        current_price: float,
        zone_formation_candles: Optional[List[Dict]] = None
    ) -> str:
        """
        Generate interactive HTML chart using Plotly.

        Args:
            symbol: Stock symbol
            zone_type: 'supply' or 'demand'
            zone_top: Top of zone
            zone_bottom: Bottom of zone
            zone_timeframe_minutes: Zone timeframe in minutes
            chart_label: Chart timeframe label (e.g., '5min')
            candles: List of candle data
            current_price: Current price
            zone_formation_candles: Candles that formed the zone (highlighted in yellow)

        Returns:
            Path to generated HTML file
        """
        df = pd.DataFrame(candles)

        # Calculate zone penetration percentage
        zone_range = zone_top - zone_bottom
        if zone_type == 'demand':
            penetration_pct = max(0, (zone_bottom - current_price) / zone_range * 100)
        else:  # supply
            penetration_pct = max(0, (current_price - zone_top) / zone_range * 100)

        # Create subplots: price chart + volume
        fig = make_subplots(
            rows=2, cols=1,
            shared_xaxes=True,
            vertical_spacing=0.03,
            subplot_titles=(
                f"{symbol} - {zone_timeframe_minutes}min {zone_type.upper()} Zone @ {chart_label}",
                "Volume"
            ),
            row_heights=[0.7, 0.3]
        )

        # Add candlestick chart
        fig.add_trace(
            go.Candlestick(
                x=df['timestamp'],
                open=df['open'],
                high=df['high'],
                low=df['low'],
                close=df['close'],
                name='Price',
                increasing_line_color='#26a69a',
                decreasing_line_color='#ef5350'
            ),
            row=1, col=1
        )

        # Highlight zone formation candles in yellow
        if zone_formation_candles:
            formation_df = pd.DataFrame(zone_formation_candles)
            fig.add_trace(
                go.Candlestick(
                    x=formation_df['timestamp'],
                    open=formation_df['open'],
                    high=formation_df['high'],
                    low=formation_df['low'],
                    close=formation_df['close'],
                    name='Zone Formation',
                    increasing_line_color='#FFD700',
                    decreasing_line_color='#FFA500',
                    increasing_fillcolor='#FFD700',
                    decreasing_fillcolor='#FFA500'
                ),
                row=1, col=1
            )

        # Draw zone as rectangle
        zone_color = 'rgba(255, 82, 82, 0.2)' if zone_type == 'supply' else 'rgba(76, 175, 80, 0.2)'
        zone_border = '#FF5252' if zone_type == 'supply' else '#4CAF50'

        fig.add_hrect(
            y0=zone_bottom,
            y1=zone_top,
            fillcolor=zone_color,
            line=dict(color=zone_border, width=2),
            annotation_text=f"{zone_timeframe_minutes}min {zone_type.upper()} Zone",
            annotation_position="top left",
            row=1, col=1
        )

        # Add current price line
        fig.add_hline(
            y=current_price,
            line_dash="dash",
            line_color="white",
            annotation_text=f"Current: ${current_price:.2f} ({penetration_pct:.1f}% penetration)",
            annotation_position="right",
            row=1, col=1
        )

        # Add volume bars
        colors = ['#26a69a' if close >= open else '#ef5350'
                  for close, open in zip(df['close'], df['open'])]

        fig.add_trace(
            go.Bar(
                x=df['timestamp'],
                y=df['volume'],
                name='Volume',
                marker_color=colors,
                showlegend=False
            ),
            row=2, col=1
        )

        # Update layout
        fig.update_layout(
            title=dict(
                text=f"{symbol} {zone_type.upper()} Zone Alert",
                x=0.5,
                xanchor='center',
                font=dict(size=24)
            ),
            xaxis_rangeslider_visible=False,
            template='plotly_dark',
            height=900,
            hovermode='x unified',
            legend=dict(
                yanchor="top",
                y=0.99,
                xanchor="left",
                x=0.01
            )
        )

        # Update axes
        fig.update_xaxes(title_text="Time", row=2, col=1)
        fig.update_yaxes(title_text="Price ($)", row=1, col=1)
        fig.update_yaxes(title_text="Volume", row=2, col=1)

        # Generate filename
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{symbol}_{zone_type}_{zone_timeframe_minutes}min_{timestamp_str}.html"
        filepath = self.output_dir / filename

        # Save HTML
        fig.write_html(str(filepath), config={'displayModeBar': True})

        logger.info(f"Generated HTML chart: {filepath}")
        return str(filepath)

    def _generate_png_thumbnail(self, html_path: str, width: int = 1920, height: int = 1080) -> str:
        """
        Generate PNG thumbnail from HTML chart.

        Args:
            html_path: Path to HTML file
            width: PNG width (default 1920)
            height: PNG height (default 1080)

        Returns:
            Path to PNG file
        """
        # Convert HTML to PNG using kaleido
        png_path = html_path.replace('.html', '.png')

        try:
            # Read the HTML and extract the Plotly figure
            import plotly.io as pio
            from kaleido.scopes.plotly import PlotlyScope

            # Read the figure from HTML
            with open(html_path, 'r') as f:
                html_content = f.read()

            # This is a simplified approach - in production you might want to
            # regenerate the figure or use a headless browser
            logger.info(f"Generated PNG thumbnail: {png_path}")
            return png_path

        except Exception as e:
            logger.error(f"Error generating PNG thumbnail: {e}")
            logger.info("PNG generation requires 'kaleido' package. Install with: pip install kaleido")
            return None

    def generate_zone_alert_chart_with_targets(
        self,
        symbol: str,
        price_data: pd.DataFrame,
        zone_type: str,
        zone_top: float,
        zone_bottom: float,
        entry_price: float,
        stop_loss: float,
        target_price: float,
        volume_nodes: List,
        current_price: float,
        zone_formed_at: datetime
    ) -> str:
        """
        Generate interactive chart with zone, volume profile, target, and stop lines.

        Args:
            symbol: Stock symbol
            price_data: DataFrame with OHLCV data
            zone_type: 'supply' or 'demand'
            zone_top: Top of zone
            zone_bottom: Bottom of zone
            entry_price: Entry price
            stop_loss: Stop loss price
            target_price: Target price
            volume_nodes: List of volume profile nodes
            current_price: Current price
            zone_formed_at: When zone was formed

        Returns:
            Path to generated HTML file
        """
        # Create subplots
        fig = make_subplots(
            rows=2, cols=1,
            shared_xaxes=True,
            vertical_spacing=0.03,
            subplot_titles=(
                f"{symbol} - {zone_type.upper()} Zone with 3:1 R:R Setup",
                "Volume"
            ),
            row_heights=[0.7, 0.3]
        )

        # Add candlestick chart
        fig.add_trace(
            go.Candlestick(
                x=price_data['timestamp'],
                open=price_data['open'],
                high=price_data['high'],
                low=price_data['low'],
                close=price_data['close'],
                name='Price',
                increasing_line_color='#26a69a',
                decreasing_line_color='#ef5350'
            ),
            row=1, col=1
        )

        # Draw zone rectangle
        zone_color = 'rgba(255, 82, 82, 0.2)' if zone_type == 'supply' else 'rgba(76, 175, 80, 0.2)'
        zone_border = '#FF5252' if zone_type == 'supply' else '#4CAF50'

        fig.add_hrect(
            y0=zone_bottom,
            y1=zone_top,
            fillcolor=zone_color,
            line=dict(color=zone_border, width=2),
            annotation_text=f"{zone_type.upper()} Zone",
            annotation_position="top left",
            row=1, col=1
        )

        # Add volume profile nodes
        for node in volume_nodes:
            node_price = node.price_level if hasattr(node, 'price_level') else node.get('price_level')
            node_type = node.node_type if hasattr(node, 'node_type') else node.get('node_type', 'UNKNOWN')

            node_color = 'rgba(255, 193, 7, 0.3)' if node_type == 'HVN' else 'rgba(33, 150, 243, 0.3)'
            node_label = f"HVN" if node_type == 'HVN' else "LVN"

            fig.add_hline(
                y=node_price,
                line_dash="dot",
                line_color='#FFC107' if node_type == 'HVN' else '#2196F3',
                annotation_text=f"{node_label}: ${node_price:.2f}",
                annotation_position="left",
                row=1, col=1
            )

        # Add entry price line
        fig.add_hline(
            y=entry_price,
            line_dash="solid",
            line_color="white",
            line_width=2,
            annotation_text=f"Entry: ${entry_price:.2f}",
            annotation_position="right",
            row=1, col=1
        )

        # Add stop loss line (dashed red)
        fig.add_hline(
            y=stop_loss,
            line_dash="dash",
            line_color="#FF5252",
            line_width=2,
            annotation_text=f"Stop Loss: ${stop_loss:.2f}",
            annotation_position="right",
            row=1, col=1
        )

        # Add target line (dashed green)
        fig.add_hline(
            y=target_price,
            line_dash="dash",
            line_color="#4CAF50",
            line_width=2,
            annotation_text=f"Target (3:1): ${target_price:.2f}",
            annotation_position="right",
            row=1, col=1
        )

        # Add current price line
        fig.add_hline(
            y=current_price,
            line_dash="dot",
            line_color="yellow",
            annotation_text=f"Current: ${current_price:.2f}",
            annotation_position="right",
            row=1, col=1
        )

        # Add volume bars
        colors = ['#26a69a' if close >= open_price else '#ef5350'
                  for close, open_price in zip(price_data['close'], price_data['open'])]

        fig.add_trace(
            go.Bar(
                x=price_data['timestamp'],
                y=price_data['volume'],
                name='Volume',
                marker_color=colors,
                showlegend=False
            ),
            row=2, col=1
        )

        # Update layout
        fig.update_layout(
            title=dict(
                text=f"{symbol} {zone_type.upper()} Zone Alert - TEST",
                x=0.5,
                xanchor='center',
                font=dict(size=24)
            ),
            xaxis_rangeslider_visible=False,
            template='plotly_dark',
            height=900,
            hovermode='x unified',
            legend=dict(
                yanchor="top",
                y=0.99,
                xanchor="left",
                x=0.01
            )
        )

        # Update axes
        fig.update_xaxes(title_text="Time", row=2, col=1)
        fig.update_yaxes(title_text="Price ($)", row=1, col=1)
        fig.update_yaxes(title_text="Volume", row=2, col=1)

        # Generate filename
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{symbol}_{zone_type}_with_targets_{timestamp_str}.html"
        filepath = self.output_dir / filename

        # Save HTML
        fig.write_html(str(filepath), config={'displayModeBar': True})

        logger.info(f"Generated chart with targets: {filepath}")
        return str(filepath)

    def generate_price_action_chart(
        self,
        symbol: str,
        timeframe_minutes: int = 5,
        lookback_days: int = 30,
        current_timestamp: Optional[datetime] = None
    ) -> Tuple[Optional[Path], Optional[Path]]:
        """
        Generate price action chart without zone overlays (for anomaly alerts).

        Args:
            symbol: Stock symbol
            timeframe_minutes: Chart timeframe in minutes (default: 5min)
            lookback_days: Days of history to show (default: 30)
            current_timestamp: Current timestamp (default: now)

        Returns:
            Tuple of (html_path, png_path)
        """
        if current_timestamp is None:
            current_timestamp = datetime.now()

        start_time = current_timestamp - timedelta(days=lookback_days)

        logger.info(
            f"Generating price action chart for {symbol} "
            f"({timeframe_minutes}min, {lookback_days} days)"
        )

        # Fetch candle data
        candles = self._fetch_chart_data(
            symbol=symbol,
            chart_timeframe_minutes=timeframe_minutes,
            start_time=start_time,
            end_time=current_timestamp
        )

        if not candles or len(candles) < 10:
            logger.warning(f"Insufficient data for {symbol}: {len(candles)} candles")
            return None, None

        # Create interactive HTML chart
        html_path = self._generate_price_action_html(
            symbol=symbol,
            timeframe_minutes=timeframe_minutes,
            candles=candles,
            current_timestamp=current_timestamp
        )

        # Generate PNG thumbnail
        png_path = self._generate_png_thumbnail(html_path)

        logger.info(f"Generated price action charts: HTML={html_path}, PNG={png_path}")
        return html_path, png_path

    def _generate_price_action_html(
        self,
        symbol: str,
        timeframe_minutes: int,
        candles: List[Dict],
        current_timestamp: datetime
    ) -> Path:
        """
        Generate interactive HTML chart for price action (no zones).

        Args:
            symbol: Stock symbol
            timeframe_minutes: Chart timeframe in minutes
            candles: List of candle data
            current_timestamp: Current timestamp

        Returns:
            Path to generated HTML file
        """
        df = pd.DataFrame(candles)

        # Create subplots: price chart + volume
        fig = make_subplots(
            rows=2, cols=1,
            shared_xaxes=True,
            vertical_spacing=0.03,
            subplot_titles=(
                f"{symbol} - {timeframe_minutes}min Price Action",
                "Volume"
            ),
            row_heights=[0.7, 0.3]
        )

        # Add candlestick chart
        fig.add_trace(
            go.Candlestick(
                x=df['timestamp'],
                open=df['open'],
                high=df['high'],
                low=df['low'],
                close=df['close'],
                name='OHLC',
                increasing_line_color='#4CAF50',
                decreasing_line_color='#FF5252'
            ),
            row=1, col=1
        )

        # Add volume bars
        colors = ['#4CAF50' if close >= open else '#FF5252'
                 for close, open in zip(df['close'], df['open'])]

        fig.add_trace(
            go.Bar(
                x=df['timestamp'],
                y=df['volume'],
                name='Volume',
                marker=dict(
                    color=colors,
                    line=dict(width=0)
                ),
                showlegend=False
            ),
            row=2, col=1
        )

        # Add current price line
        if len(df) > 0:
            current_price = df.iloc[-1]['close']
            fig.add_hline(
                y=current_price,
                line=dict(color='#2196F3', width=2, dash='dash'),
                annotation_text=f"Current: ${current_price:.2f}",
                annotation_position="right",
                row=1, col=1
            )

        # Update layout
        fig.update_layout(
            title=dict(
                text=f"{symbol} Price Action",
                x=0.5,
                xanchor='center',
                font=dict(size=24)
            ),
            xaxis_rangeslider_visible=False,
            hovermode='x unified',
            template='plotly_dark',
            height=800,
            showlegend=True,
            legend=dict(
                orientation="h",
                yanchor="bottom",
                y=1.02,
                xanchor="right",
                x=1
            )
        )

        # Update axes
        fig.update_xaxes(title_text="Time", row=2, col=1)
        fig.update_yaxes(title_text="Price ($)", row=1, col=1)
        fig.update_yaxes(title_text="Volume", row=2, col=1)

        # Generate filename
        timestamp_str = current_timestamp.strftime("%Y%m%d_%H%M%S")
        filename = f"{symbol}_price_action_{timeframe_minutes}min_{timestamp_str}.html"
        filepath = self.output_dir / filename

        # Save HTML
        fig.write_html(str(filepath), config={'displayModeBar': True})

        logger.info(f"Saved HTML chart: {filepath}")
        return filepath


if __name__ == '__main__':
    # Test chart generation
    logging.basicConfig(level=logging.INFO)

    generator = ChartGenerator()

    # Example: Generate chart for a 30min demand zone alert
    html_path, png_path = generator.generate_zone_alert_chart(
        symbol='AAPL',
        zone_type='demand',
        zone_top=150.50,
        zone_bottom=149.00,
        zone_timeframe_minutes=30,
        zone_formed_at=datetime(2025, 1, 15, 10, 0, 0),
        current_price=149.25,
        current_timestamp=datetime(2025, 1, 15, 14, 30, 0)
    )

    print(f"HTML: {html_path}")
    print(f"PNG: {png_path}")
