"use client";

import {
  BarChart3, Bell, Bot, Home, LogOut, Settings, TrendingUp, TrendingDown, Activity,
  LineChart, PieChart, Wallet, Target, Zap, Lock, Crown, ArrowRight,
  MessageSquare, Send, X, Search, Coins, FlaskConical, DollarSign,
  ChevronUp, ChevronDown
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { createChart, CandlestickSeries, MouseEventParams, ISeriesApi, SeriesType, Time, IChartApi } from "lightweight-charts";
import { RectangleDrawingTool } from "../../rectangle-drawing-tool";

// ============================================================================
// Zone Primitive Classes - Using lightweight-charts primitive plugin system
// These classes render zones that automatically update on zoom/pan
// ============================================================================

interface ZonePoint {
  time: Time;
  price: number;
}

interface ZonePrimitiveOptions {
  fillColor: string;
  borderColor: string;
  showLabel: boolean;
  labelText: string;
}

// Renderer that draws the zone rectangle
class ZonePaneRenderer {
  private _p1: { x: number | null; y: number | null };
  private _p2: { x: number | null; y: number | null };
  private _options: ZonePrimitiveOptions;

  constructor(
    p1: { x: number | null; y: number | null },
    p2: { x: number | null; y: number | null },
    options: ZonePrimitiveOptions
  ) {
    this._p1 = p1;
    this._p2 = p2;
    this._options = options;
  }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      if (
        this._p1.x === null ||
        this._p1.y === null ||
        this._p2.x === null ||
        this._p2.y === null
      ) return;

      const ctx = scope.context;
      const x1 = Math.round(this._p1.x * scope.horizontalPixelRatio);
      const y1 = Math.round(this._p1.y * scope.verticalPixelRatio);
      const x2 = Math.round(this._p2.x * scope.horizontalPixelRatio);
      const y2 = Math.round(this._p2.y * scope.verticalPixelRatio);

      const left = Math.min(x1, x2);
      const top = Math.min(y1, y2);
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);

      // Fill
      ctx.fillStyle = this._options.fillColor;
      ctx.fillRect(left, top, width, height);

      // Border
      ctx.strokeStyle = this._options.borderColor;
      ctx.lineWidth = 1 * scope.horizontalPixelRatio;
      ctx.strokeRect(left, top, width, height);

      // Left border (thicker)
      ctx.lineWidth = 2 * scope.horizontalPixelRatio;
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left, top + height);
      ctx.stroke();

      // Label
      if (this._options.showLabel && width > 50 * scope.horizontalPixelRatio) {
        ctx.fillStyle = this._options.borderColor;
        ctx.font = `${11 * scope.verticalPixelRatio}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillText(
          this._options.labelText,
          left + 8 * scope.horizontalPixelRatio,
          top + height / 2
        );
      }
    });
  }
}

// Pane view that manages coordinate conversion and creates renderer
class ZonePaneView {
  private _source: ZonePrimitive;
  private _p1: { x: number | null; y: number | null } = { x: null, y: null };
  private _p2: { x: number | null; y: number | null } = { x: null, y: null };

  constructor(source: ZonePrimitive) {
    this._source = source;
  }

  update() {
    const series = this._source.series;
    const chart = this._source.chart;
    if (!series || !chart) return;

    const timeScale = chart.timeScale();

    // Convert data coordinates (time, price) to pixel coordinates
    this._p1 = {
      x: timeScale.timeToCoordinate(this._source.p1.time),
      y: series.priceToCoordinate(this._source.p1.price)
    };
    this._p2 = {
      x: timeScale.timeToCoordinate(this._source.p2.time),
      y: series.priceToCoordinate(this._source.p2.price)
    };
  }

  renderer() {
    return new ZonePaneRenderer(this._p1, this._p2, this._source.options);
  }
}

// The main primitive class that gets attached to the series
class ZonePrimitive {
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _paneViews: ZonePaneView[];
  private _p1: ZonePoint;
  private _p2: ZonePoint;
  private _options: ZonePrimitiveOptions;
  private _requestUpdate?: () => void;

  constructor(p1: ZonePoint, p2: ZonePoint, options: ZonePrimitiveOptions) {
    this._p1 = p1;
    this._p2 = p2;
    this._options = options;
    this._paneViews = [new ZonePaneView(this)];
  }

  // Called by lightweight-charts when the primitive is attached
  attached({ chart, series, requestUpdate }: any) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  // Called by lightweight-charts when the primitive is detached
  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = undefined;
  }

  // Getters for the pane view to access
  get chart() { return this._chart; }
  get series() { return this._series; }
  get p1() { return this._p1; }
  get p2() { return this._p2; }
  get options() { return this._options; }

  // Called by lightweight-charts to get pane views for rendering
  paneViews() {
    return this._paneViews;
  }

  // Called by lightweight-charts before rendering - we update coordinates here
  updateAllViews() {
    this._paneViews.forEach(pv => pv.update());
  }

  // Request a re-render
  requestUpdate() {
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }
}

// ============================================================================
// Extended RectangleDrawingTool with snapping functionality
// ============================================================================

class SnappingRectangleDrawingTool extends RectangleDrawingTool {
  private candleData: Array<{ time: number; open: number; high: number; low: number; close: number }>;
  private originalClickHandler: any;
  private snappingClickHandler: any;

  constructor(
    chart: any,
    series: ISeriesApi<SeriesType>,
    drawingsToolbarContainer: HTMLDivElement,
    options: any,
    candleData: Array<{ time: number; open: number; high: number; low: number; close: number }>
  ) {
    super(chart, series, drawingsToolbarContainer, options);
    this.candleData = candleData;
    this.originalClickHandler = (this as any)._clickHandler;
    this.setupSnapping();
  }

  // Setup snapping by replacing the click handler
  private setupSnapping() {
    const chart = (this as any)._chart;
    const series = (this as any)._series;

    // Create new snapping click handler
    this.snappingClickHandler = (param: MouseEventParams) => {
      if (!(this as any)._drawing || !param.point || !param.time || !series) {
        return this.originalClickHandler.call(this, param);
      }

      const rawPrice = series.coordinateToPrice(param.point.y);
      if (rawPrice === null) {
        return this.originalClickHandler.call(this, param);
      }

      // Find nearest candle by time
      const clickTime = typeof param.time === 'number' ? param.time : Math.floor(new Date(param.time as string).getTime() / 1000);
      let nearestCandle = this.candleData[0];
      let minTimeDiff = Math.abs(clickTime - nearestCandle.time);

      for (const candle of this.candleData) {
        const timeDiff = Math.abs(clickTime - candle.time);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          nearestCandle = candle;
        }
      }

      // Snap to nearest high or low
      const distToHigh = Math.abs(rawPrice - nearestCandle.high);
      const distToLow = Math.abs(rawPrice - nearestCandle.low);
      const snappedPrice = distToHigh < distToLow ? nearestCandle.high : nearestCandle.low;

      // Log snapping for debugging
      console.log(`Snapping: raw price ${rawPrice.toFixed(2)} -> ${snappedPrice.toFixed(2)} (${distToHigh < distToLow ? 'high' : 'low'})`);

      // Create modified param with snapped price
      const snappedY = series.priceToCoordinate(snappedPrice);
      const modifiedParam = {
        ...param,
        point: snappedY !== null ? { ...param.point, y: snappedY } : param.point,
      };

      return this.originalClickHandler.call(this, modifiedParam);
    };

    // Unsubscribe original handler and subscribe with snapping handler
    chart.unsubscribeClick(this.originalClickHandler);
    chart.subscribeClick(this.snappingClickHandler);

    // Update the internal reference
    (this as any)._clickHandler = this.snappingClickHandler;
  }

  // Override remove to properly cleanup
  remove() {
    const chart = (this as any)._chart;
    if (chart && this.snappingClickHandler) {
      chart.unsubscribeClick(this.snappingClickHandler);
    }
    super.remove();
  }
}

// ============================================================================
// Component Interfaces
// ============================================================================

interface UserInfo {
  name: string;
  email: string;
  role: "free" | "paid" | "admin";
}

interface CryptoAggregate {
  symbol: string;
  company_name: string;
  latest_price: number;
  change: number;
  change_percent: number;
  volume_24h: number;
  high_24h: number;
  low_24h: number;
  bars: Array<{
    bucket: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  last_updated: string;
}

// Tab type definition
type DashboardTab = 'charts' | 'trades' | 'strategy' | 'portfolio' | 'alerts' | 'backtest';

// Trades data interface
interface Trade {
  // New fields from historical_trades table
  tradeId: number;
  symbol: string;
  zoneType: string;
  zoneId: number;
  zoneBottom: number;
  zoneTop: number;
  zoneHeight: number;
  entryTime: string;
  entryPrice: number;
  entryCandleOpen: number | null;
  stopPrice: number;
  targetPrice: number;
  targetType: string | null;
  targetHvnPercentile: number | null;
  riskAmount: number;
  rewardAmount: number;
  riskRewardRatio: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | null;
  exitTime: string | null;
  exitPrice: number | null;
  exitReason: string | null;
  minutesToExit: number | null;
  tradingDaysToExit: number | null;
  candlesToExit: number | null;
  pnlPoints: number | null;
  pnlPercent: number | null;
  rMultiple: number | null;
  discordAlerted: boolean;
  timeframe: string | null;
  // Legacy field mappings for backward compatibility
  alertId: number;
  stopLoss: number;
  alertTime: string;
  alertedAt: string;
  zoneStart: string;
  retestDate: string | null;
  retestPrice: number | null;
  close5d: number | null;
  return5d: number | null;
  adjustedReturn: number | null;
}

// Portfolio data interface
interface PortfolioData {
  performance: {
    totalReturn: string;
    sharpeRatio: string;
    informationRatio: string;
    maxDrawdown: string;
    winRate: string;
    avgReturn: string;
    totalTrades: number;
    wins: number;
    losses: number;
  };
  byZoneType: {
    demand: { trades: number; wins: number; winRate: string; totalReturn: string; avgReturn: string };
    supply: { trades: number; wins: number; winRate: string; totalReturn: string; avgReturn: string };
  };
  equityCurve: Array<{ date: string; cumulative: string }>;
}

// Strategy data interface
interface StrategyData {
  zoneStats: Record<string, any>;
  kellyParams: Record<string, any>;
  imbalance: Array<{ symbol: string; demandZones: number; supplyZones: number; imbalance: number; bias: string }>;
  summary: {
    totalDemandZones: number;
    totalSupplyZones: number;
    freshDemandZones: number;
    freshSupplyZones: number;
    demandWinRate: string;
    supplyWinRate: string;
    demandKelly: string;
    supplyKelly: string;
  };
}

// Backtest interfaces
interface BacktestConfig {
  symbol: string;
  symbols: string[];  // Multi-symbol support
  start_date: string;
  end_date: string;
  initial_capital: number;
  risk_per_trade: number;
  max_positions: number;
  min_risk_reward: number;
  holding_period: number;
}

interface BacktestTrade {
  zone_id: number;
  symbol: string;
  zone_type: string;
  direction: string;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  target_price: number;
  shares: number;
  capital_deployed: number;
  pnl: number;
  pnl_pct: number;
  r_multiple: number;
  status: string;
  exit_reason: string;
  days_held: number;
}

interface KellyParams {
  win_rate: number;
  avg_win_r: number;
  avg_loss_r: number;
  half_kelly_pct: number;
  sample_size: number;
}

interface SymbolBreakdown {
  symbol: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
}

interface BacktestResults {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  total_return_pct: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  max_drawdown: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  avg_r_multiple: number;
  final_capital: number;
  kelly_params: KellyParams | null;
  trades: BacktestTrade[];
  equity_curve: Array<[string, number]>;
  symbol_breakdown?: SymbolBreakdown[];  // Per-symbol stats for multi-symbol backtests
}

interface BacktestSymbol {
  symbol: string;
  id: number;
  name: string;
}

// ============================================================================
// Volume Profile Types and Primitives
// ============================================================================

interface VolumeProfileNode {
  price_level: number;
  volume: number;
  node_type: 'HVN' | 'LVN' | 'POC' | 'NORMAL';
  bin_index: number;
  price_range: [number, number];
}

interface VolumeProfileData {
  nodes: VolumeProfileNode[];
  hvn_nodes: VolumeProfileNode[];
  lvn_nodes: VolumeProfileNode[];
  poc_node: VolumeProfileNode | null;
  hvn_threshold: number;
  lvn_threshold: number;
  total_volume: number;
  price_range: [number, number];
  bin_size: number;
  poc_price: number | null;
}

// Volume Profile Renderer - draws horizontal bars on the right side of the chart
class VolumeProfilePaneRenderer {
  private _nodes: VolumeProfileNode[];
  private _priceRange: [number, number];
  private _maxVolume: number;
  private _series: ISeriesApi<SeriesType> | null;
  private _showPOC: boolean;
  private _showHVN: boolean;
  private _showLVN: boolean;

  constructor(
    nodes: VolumeProfileNode[],
    priceRange: [number, number],
    maxVolume: number,
    series: ISeriesApi<SeriesType> | null,
    showPOC: boolean = true,
    showHVN: boolean = true,
    showLVN: boolean = true
  ) {
    this._nodes = nodes;
    this._priceRange = priceRange;
    this._maxVolume = maxVolume;
    this._series = series;
    this._showPOC = showPOC;
    this._showHVN = showHVN;
    this._showLVN = showLVN;
  }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      if (!this._series || this._nodes.length === 0) return;

      const ctx = scope.context;
      const chartWidth = scope.bitmapSize.width;
      const maxBarWidth = chartWidth * 0.15; // Max 15% of chart width

      // Draw each volume bar
      for (const node of this._nodes) {
        // Get Y coordinates for this price level
        const topY = this._series.priceToCoordinate(node.price_range[1]);
        const bottomY = this._series.priceToCoordinate(node.price_range[0]);

        if (topY === null || bottomY === null) continue;

        const y1 = Math.round(topY * scope.verticalPixelRatio);
        const y2 = Math.round(bottomY * scope.verticalPixelRatio);
        const height = Math.abs(y2 - y1);
        const top = Math.min(y1, y2);

        // Calculate bar width based on volume
        const volumeRatio = node.volume / this._maxVolume;
        const barWidth = volumeRatio * maxBarWidth;

        // Position bar on the right side of the chart
        const x = chartWidth - barWidth;

        // Choose color based on node type
        let fillColor = 'rgba(156, 163, 175, 0.4)'; // Default gray for NORMAL
        let borderColor = 'rgba(156, 163, 175, 0.6)';

        if (node.node_type === 'POC' && this._showPOC) {
          fillColor = 'rgba(251, 191, 36, 0.6)'; // Yellow for POC
          borderColor = 'rgba(251, 191, 36, 0.9)';
        } else if (node.node_type === 'HVN' && this._showHVN) {
          fillColor = 'rgba(239, 68, 68, 0.5)'; // Red for HVN
          borderColor = 'rgba(239, 68, 68, 0.8)';
        } else if (node.node_type === 'LVN' && this._showLVN) {
          fillColor = 'rgba(139, 92, 246, 0.5)'; // Purple for LVN
          borderColor = 'rgba(139, 92, 246, 0.8)';
        }

        // Draw the bar
        ctx.fillStyle = fillColor;
        ctx.fillRect(x, top, barWidth, Math.max(height, 2));

        // Draw border
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, top, barWidth, Math.max(height, 2));
      }

      // Draw POC line across the entire chart
      if (this._showPOC) {
        const pocNode = this._nodes.find(n => n.node_type === 'POC');
        if (pocNode) {
          const pocY = this._series.priceToCoordinate(pocNode.price_level);
          if (pocY !== null) {
            const y = Math.round(pocY * scope.verticalPixelRatio);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(chartWidth, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw POC label
            ctx.fillStyle = '#FBBF24';
            ctx.font = `${10 * scope.verticalPixelRatio}px sans-serif`;
            ctx.fillText('POC', 5, y - 3);
          }
        }
      }
    });
  }
}

// Volume Profile Pane View
class VolumeProfilePaneView {
  private _source: VolumeProfilePrimitive;

  constructor(source: VolumeProfilePrimitive) {
    this._source = source;
  }

  update() {
    // Coordinates are calculated in renderer
  }

  renderer() {
    const maxVolume = Math.max(...this._source.nodes.map(n => n.volume), 1);
    return new VolumeProfilePaneRenderer(
      this._source.nodes,
      this._source.priceRange,
      maxVolume,
      this._source.series,
      this._source.showPOC,
      this._source.showHVN,
      this._source.showLVN
    );
  }
}

// Volume Profile Primitive
class VolumeProfilePrimitive {
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _paneViews: VolumeProfilePaneView[];
  private _nodes: VolumeProfileNode[];
  private _priceRange: [number, number];
  private _showPOC: boolean;
  private _showHVN: boolean;
  private _showLVN: boolean;
  private _requestUpdate?: () => void;

  constructor(
    nodes: VolumeProfileNode[],
    priceRange: [number, number],
    showPOC: boolean = true,
    showHVN: boolean = true,
    showLVN: boolean = true
  ) {
    this._nodes = nodes;
    this._priceRange = priceRange;
    this._showPOC = showPOC;
    this._showHVN = showHVN;
    this._showLVN = showLVN;
    this._paneViews = [new VolumeProfilePaneView(this)];
  }

  attached({ chart, series, requestUpdate }: any) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = undefined;
  }

  get chart() { return this._chart; }
  get series() { return this._series; }
  get nodes() { return this._nodes; }
  get priceRange() { return this._priceRange; }
  get showPOC() { return this._showPOC; }
  get showHVN() { return this._showHVN; }
  get showLVN() { return this._showLVN; }

  paneViews() {
    return this._paneViews;
  }

  updateAllViews() {
    this._paneViews.forEach(pv => pv.update());
  }

  requestUpdate() {
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }
}

// ============================================================================
// Trade Marker Primitive Classes - For showing trade entry/exit markers
// ============================================================================

interface TradeMarkerOptions {
  entryTime: Time;
  entryPrice: number;
  exitTime?: Time;
  exitPrice?: number;
  outcome?: string | null;
  zoneType: 'demand' | 'supply';
}

// Renderer that draws trade markers (triangles/arrows)
class TradeMarkerRenderer {
  private _entryCoord: { x: number | null; y: number | null };
  private _exitCoord: { x: number | null; y: number | null };
  private _options: TradeMarkerOptions;

  constructor(
    entryCoord: { x: number | null; y: number | null },
    exitCoord: { x: number | null; y: number | null },
    options: TradeMarkerOptions
  ) {
    this._entryCoord = entryCoord;
    this._exitCoord = exitCoord;
    this._options = options;
  }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const hRatio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;

      // Draw entry marker (upward triangle for demand/buy, downward for supply/sell)
      if (this._entryCoord.x !== null && this._entryCoord.y !== null) {
        const ex = Math.round(this._entryCoord.x * hRatio);
        const ey = Math.round(this._entryCoord.y * vRatio);
        const size = 12 * hRatio;

        // Entry marker - cyan/blue color for entry
        ctx.fillStyle = '#00BCD4';
        ctx.strokeStyle = '#00838F';
        ctx.lineWidth = 2 * hRatio;

        ctx.beginPath();
        if (this._options.zoneType === 'demand') {
          // Upward triangle (buy entry)
          ctx.moveTo(ex, ey - size);
          ctx.lineTo(ex - size * 0.7, ey + size * 0.5);
          ctx.lineTo(ex + size * 0.7, ey + size * 0.5);
        } else {
          // Downward triangle (sell entry)
          ctx.moveTo(ex, ey + size);
          ctx.lineTo(ex - size * 0.7, ey - size * 0.5);
          ctx.lineTo(ex + size * 0.7, ey - size * 0.5);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Entry label
        ctx.fillStyle = '#00BCD4';
        ctx.font = `bold ${10 * vRatio}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('ENTRY', ex, ey - size - 5 * vRatio);

        // Entry price line (dashed horizontal)
        ctx.setLineDash([5 * hRatio, 3 * hRatio]);
        ctx.strokeStyle = 'rgba(0, 188, 212, 0.6)';
        ctx.lineWidth = 1 * hRatio;
        ctx.beginPath();
        ctx.moveTo(ex - 100 * hRatio, ey);
        ctx.lineTo(ex + 100 * hRatio, ey);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw exit marker if available
      if (this._exitCoord.x !== null && this._exitCoord.y !== null) {
        const xx = Math.round(this._exitCoord.x * hRatio);
        const xy = Math.round(this._exitCoord.y * vRatio);
        const size = 12 * hRatio;

        // Exit marker color based on outcome
        const exitColor = this._options.outcome === 'WIN' ? '#4CAF50' :
                          this._options.outcome === 'LOSS' ? '#FF5252' : '#FFC107';
        const exitStroke = this._options.outcome === 'WIN' ? '#2E7D32' :
                           this._options.outcome === 'LOSS' ? '#C62828' : '#FF8F00';

        ctx.fillStyle = exitColor;
        ctx.strokeStyle = exitStroke;
        ctx.lineWidth = 2 * hRatio;

        // Draw X mark for exit
        ctx.beginPath();
        ctx.moveTo(xx - size * 0.5, xy - size * 0.5);
        ctx.lineTo(xx + size * 0.5, xy + size * 0.5);
        ctx.moveTo(xx + size * 0.5, xy - size * 0.5);
        ctx.lineTo(xx - size * 0.5, xy + size * 0.5);
        ctx.stroke();

        // Circle around X
        ctx.beginPath();
        ctx.arc(xx, xy, size * 0.7, 0, Math.PI * 2);
        ctx.stroke();

        // Exit label
        ctx.fillStyle = exitColor;
        ctx.font = `bold ${10 * vRatio}px sans-serif`;
        ctx.textAlign = 'center';
        const exitLabel = this._options.outcome === 'WIN' ? 'TARGET' :
                          this._options.outcome === 'LOSS' ? 'STOP' : 'EXIT';
        ctx.fillText(exitLabel, xx, xy - size - 5 * vRatio);

        // Exit price line (dashed horizontal)
        ctx.setLineDash([5 * hRatio, 3 * hRatio]);
        ctx.strokeStyle = `${exitColor}99`;
        ctx.lineWidth = 1 * hRatio;
        ctx.beginPath();
        ctx.moveTo(xx - 100 * hRatio, xy);
        ctx.lineTo(xx + 100 * hRatio, xy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw connecting line between entry and exit
      if (this._entryCoord.x !== null && this._entryCoord.y !== null &&
          this._exitCoord.x !== null && this._exitCoord.y !== null) {
        const ex = Math.round(this._entryCoord.x * hRatio);
        const ey = Math.round(this._entryCoord.y * vRatio);
        const xx = Math.round(this._exitCoord.x * hRatio);
        const xy = Math.round(this._exitCoord.y * vRatio);

        const lineColor = this._options.outcome === 'WIN' ? 'rgba(76, 175, 80, 0.4)' :
                          this._options.outcome === 'LOSS' ? 'rgba(255, 82, 82, 0.4)' : 'rgba(255, 193, 7, 0.4)';

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2 * hRatio;
        ctx.setLineDash([10 * hRatio, 5 * hRatio]);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(xx, xy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
  }
}

// Pane view for trade markers
class TradeMarkerPaneView {
  private _source: TradeMarkerPrimitive;
  private _entryCoord: { x: number | null; y: number | null } = { x: null, y: null };
  private _exitCoord: { x: number | null; y: number | null } = { x: null, y: null };

  constructor(source: TradeMarkerPrimitive) {
    this._source = source;
  }

  update() {
    const series = this._source.series;
    const chart = this._source.chart;
    if (!series || !chart) return;

    const timeScale = chart.timeScale();
    const options = this._source.options;

    // Convert entry coordinates
    this._entryCoord = {
      x: timeScale.timeToCoordinate(options.entryTime),
      y: series.priceToCoordinate(options.entryPrice)
    };

    // Convert exit coordinates if available
    if (options.exitTime && options.exitPrice) {
      this._exitCoord = {
        x: timeScale.timeToCoordinate(options.exitTime),
        y: series.priceToCoordinate(options.exitPrice)
      };
    } else {
      this._exitCoord = { x: null, y: null };
    }
  }

  renderer() {
    return new TradeMarkerRenderer(this._entryCoord, this._exitCoord, this._source.options);
  }
}

// Main Trade Marker Primitive class
class TradeMarkerPrimitive {
  private _chart: IChartApi | null = null;
  private _series: ISeriesApi<SeriesType> | null = null;
  private _paneViews: TradeMarkerPaneView[];
  private _options: TradeMarkerOptions;
  private _requestUpdate?: () => void;

  constructor(options: TradeMarkerOptions) {
    this._options = options;
    this._paneViews = [new TradeMarkerPaneView(this)];
  }

  attached({ chart, series, requestUpdate }: any) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = undefined;
  }

  get chart() { return this._chart; }
  get series() { return this._series; }
  get options() { return this._options; }

  paneViews() {
    return this._paneViews;
  }

  updateAllViews() {
    this._paneViews.forEach(pv => pv.update());
  }

  requestUpdate() {
    if (this._requestUpdate) {
      this._requestUpdate();
    }
  }
}

// ============================================================================
// Main Component
// ============================================================================

export default function CryptoDashboardPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [user, setUser] = useState<UserInfo>({ name: "User", email: "user@example.com", role: "admin" });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<DashboardTab>('charts');
  const [tradesData, setTradesData] = useState<{ trades: Trade[]; summary: any } | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [strategyData, setStrategyData] = useState<StrategyData | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [cryptoData, setCryptoData] = useState<CryptoAggregate | null>(null);
  const [zonesData, setZonesData] = useState<any>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const drawingToolbarRef = useRef<HTMLDivElement>(null);
  const drawingToolRef = useRef<RectangleDrawingTool | null>(null);
  const zonePrimitivesRef = useRef<ZonePrimitive[]>([]);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const pendingZoneSnapRef = useRef<string | null>(null);
  const [timeframe, setTimeframe] = useState("5m");
  const [limit, setLimit] = useState(8640);
  const [hours, setHours] = useState(720);
  const [zoneSearchQuery, setZoneSearchQuery] = useState("");
  const [selectedTimeframeKey, setSelectedTimeframeKey] = useState("5min");
  const [entryTargetStopLoss, setEntryTargetStopLoss] = useState<Record<string, {
    entry_price: number;
    target_price: number;
    stop_loss: number;
  }> | null>(null);
  const [zoneTooltip, setZoneTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    zoneId: string;
    topPrice: number;
    bottomPrice: number;
    zoneType: string;
  } | null>(null);
  // State for hovered candle data (for dynamic stats display)
  const [hoveredCandle, setHoveredCandle] = useState<{
    high: number;
    low: number;
    volume: number;
    dollarVolume: number;
    open: number;
    close: number;
  } | null>(null);

  // Trade marker state - for highlighting entry/exit when clicking from Trade History
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const pendingTradeRef = useRef<Trade | null>(null);

  // Trade table sorting state
  const [sortColumn, setSortColumn] = useState<string>('entryTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Show all trades on chart toggle
  const [showTradesOnChart, setShowTradesOnChart] = useState(false);
  const tradeMarkerPrimitivesRef = useRef<TradeMarkerPrimitive[]>([]);
  const tradeMarkerPrimitiveRef = useRef<TradeMarkerPrimitive | null>(null);

  // Backtest state
  const [backtestConfig, setBacktestConfig] = useState<BacktestConfig>({
    symbol: '',
    symbols: [],  // Multi-symbol support
    start_date: '',
    end_date: '',
    initial_capital: 100000,
    risk_per_trade: 0.02,
    max_positions: 5,
    min_risk_reward: 3.0,
    holding_period: 5,
  });
  const [backtestSymbols, setBacktestSymbols] = useState<BacktestSymbol[]>([]);
  const [multiSymbolMode, setMultiSymbolMode] = useState(false);  // Toggle for multi-symbol mode
  const [backtestDateRange, setBacktestDateRange] = useState<{ min: string; max: string } | null>(null);
  const [backtestResults, setBacktestResults] = useState<BacktestResults | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtestEngine, setBacktestEngine] = useState<string>('');

  // Volume Profile State
  const [volumeProfileData, setVolumeProfileData] = useState<VolumeProfileData | null>(null);
  const [showVolumeProfile, setShowVolumeProfile] = useState(false);
  const [volumeProfileNumBins, setVolumeProfileNumBins] = useState(50);
  const [volumeProfileStartDate, setVolumeProfileStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  });
  const [volumeProfileEndDate, setVolumeProfileEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]; // Format as YYYY-MM-DD
  });
  // Volume Profile Time State - default 00:00 UTC (crypto trades 24/7)
  const [volumeProfileStartTime, setVolumeProfileStartTime] = useState("00:00");
  const [volumeProfileEndTime, setVolumeProfileEndTime] = useState("23:59");
  const volumeProfilePrimitiveRef = useRef<VolumeProfilePrimitive | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // TEMPORARILY COMMENTED OUT FOR LOCAL DEVELOPMENT
  // Uncomment lines 47-66 below to restore Azure Easy Auth
  console.log("Timeframe: ", timeframe);
  console.log("Limit: ", limit);
  console.log("Hours: ", hours);
  console.log("Crypto Trade Data: ", tradesData)
  console.log("Crypto Strategy Data: ", strategyData)

  useEffect(() => {
    // Fetch user info from Azure Easy Auth
    fetch('/.auth/me')
      .then(res => res.json())
      .then(data => {
        if (data && data[0]) {
          const claims = data[0].user_claims || [];
          const name = claims.find((c: any) => c.typ === 'name')?.val || 'User';
          const email = claims.find((c: any) => c.typ.includes('emailaddress'))?.val || 'user@example.com';
          // For now, everyone is "free" - we'll add role detection later
          setUser({ name, email, role: "free" });
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  // Effect to read zoneId from URL parameters and automatically trigger zone search
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zoneId = params.get('zoneId');
    if (zoneId) {
      // Populate the field
      setZoneSearchQuery(zoneId);

      // Automatically trigger the zone search
      const performZoneSearch = async () => {
        try {
          // Step 1: Fetch all data for this zone (symbol, timeframe, aggregates, zones)
          await fetchCryptoDataWithZoneID(zoneId);

          // Step 2: Set pending zone to snap to
          pendingZoneSnapRef.current = zoneId;
          console.log(`Auto-triggered zone search for ${zoneId}`);

          // Step 3: Clear the search query
          setZoneSearchQuery('');
        } catch (error) {
          console.error('Error auto-searching zone:', error);
        }
      };

      performZoneSearch();
    }
  }, []);

  // Effect to refetch data when timeframe settings change
  useEffect(() => {
    if (searchQuery.trim()) {
      fetchCryptoData(searchQuery);
    }
  }, [timeframe, limit, hours]);

  // Effect to fetch tab data when tab changes
  useEffect(() => {
    if (activeTab === 'trades' && !tradesData) {
      fetchTradesData();
    } else if (activeTab === 'strategy' && !strategyData) {
      fetchStrategyData();
    }
    // Keep these commented until their APIs are ready
    // else if (activeTab === 'portfolio' && !portfolioData) {
    //   fetchPortfolioData();
    // } else if (activeTab === 'backtest' && backtestSymbols.length === 0) {
    //   fetchBacktestSymbols();
    // }
  }, [activeTab]);

  // Effect to fetch trades when showTradesOnChart is enabled
  useEffect(() => {
    if (showTradesOnChart && !tradesData) {
      fetchTradesData();
    }
  }, [showTradesOnChart]);




  // Resolve plain crypto symbol (e.g., "XRP", "BTC") to Massive format (e.g., "X:XRPUSD")
  const resolveCryptoSymbol = (input: string): string => {
    const trimmed = input.trim().toUpperCase();

    // Already in correct format (X:XXXUSD)
    if (trimmed.startsWith('X:') && trimmed.endsWith('USD')) {
      return trimmed;
    }

    // Handle "X:XXX" without USD suffix
    if (trimmed.startsWith('X:')) {
      const base = trimmed.substring(2);
      return `X:${base}USD`;
    }

    // Plain symbol like "XRP", "BTC", "ETH" - convert to X:XXXUSD
    // Remove any trailing "USD" if user typed "XRPUSD"
    const base = trimmed.endsWith('USD') ? trimmed.slice(0, -3) : trimmed;
    return `X:${base}USD`;
  };

  // Fetch crypto data based on symbol
  const fetchCryptoData = async (
    symbol: string,
    customTimeframe?: string,
    customLimit?: number,
    customHours?: number
  ) => {
    if (!symbol.trim()) {
      setCryptoData(null);
      setZonesData(null);
      setError(null);
      return;
    }

    // Resolve the symbol to Massive format
    const resolvedSymbol = resolveCryptoSymbol(symbol);

    // Use custom values if provided, otherwise use state
    const tf = customTimeframe ?? timeframe;
    const lim = customLimit ?? limit;
    const hrs = customHours ?? hours;

    try {
      setFetching(true);
      setError(null);

      // Fetch aggregates data - use all=true to get all available candles from first available
      const aggregatesResponse = await fetch(`/api/crypto/aggregates?symbols=${resolvedSymbol}&limit=${lim}&timeframe=${tf}&hours=${hrs}&all=true`);
      const aggregatesData = await aggregatesResponse.json();

      // Fetch zones data
      const zonesResponse = await fetch(`/api/crypto/zones?symbols=${resolvedSymbol}&timeframe=${tf}`);
      const zonesDataResponse = await zonesResponse.json();

      // Fetch entry/target/stoploss data (may not exist for all symbols)
      try {
        const entryTargetResponse = await fetch(`/api/crypto/entrytargetstoploss?symbol=${resolvedSymbol}`);
        const entryTargetData = await entryTargetResponse.json();

        if (entryTargetData.success && entryTargetData.data) {
          console.log("Entry/Target/StopLoss Data: ", entryTargetData.data);
          setEntryTargetStopLoss(entryTargetData.data);
        } else {
          console.log("No alert data for this symbol");
          setEntryTargetStopLoss(null);
        }
      } catch (err) {
        // 404 or other error - no alert data for this symbol
        console.log("No alert data available for this symbol");
        setEntryTargetStopLoss(null);
      }

      if (aggregatesData.success && aggregatesData.data.length > 0) {
        setCryptoData(aggregatesData.data[0]);
        // Set zones data if available
        if (zonesDataResponse.success && zonesDataResponse.data.length > 0) {
          console.log("Crypto Data: ", aggregatesData.data[0])
          console.log("ZONES DATA: ", zonesDataResponse.data[0]);
          setZonesData(zonesDataResponse.data[0]);
        } else {
          setZonesData(null);
        }
      } else {
        setError(`No data found for ${resolvedSymbol}`);
        setCryptoData(null);
        setZonesData(null);
      }
    } catch (err: any) {
      setError(`Error fetching data: ${err.message}`);
      setCryptoData(null);
      setZonesData(null);
    } finally {
      setFetching(false);
    }
  };

  // Fetch crypto trades data
  const fetchTradesData = async () => {
    try {
      setTabLoading(true);
      console.log('Fetching crypto trades from /api/crypto/trades...');
      const response = await fetch('/api/crypto/trades?limit=5000');

      // Check if response is OK and is JSON
      if (!response.ok) {
        console.warn('Trades API returned error status:', response.status);
        setTradesData(null);
        return;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Trades API did not return JSON');
        setTradesData(null);
        return;
      }

      const data = await response.json();
      console.log('Crypto trades API response:', data);

      if (data.success) {
        console.log('Setting tradesData:', data.data);
        setTradesData(data.data);
      } else {
        console.warn('Trades API returned success: false');
        setTradesData(null);
      }
    } catch (err) {
      console.error('Error fetching crypto trades:', err);
      setTradesData(null);
    } finally {
      setTabLoading(false);
    }
  };

  // Fetch portfolio data
  const fetchPortfolioData = async () => {
    try {
      setTabLoading(true);
      const response = await fetch('/api/crypto/portfolio');

      // Check if response is OK and is JSON
      if (!response.ok) {
        console.warn('Portfolio API returned error status:', response.status);
        setPortfolioData(null);
        return;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Portfolio API did not return JSON');
        setPortfolioData(null);
        return;
      }

      const data = await response.json();
      if (data.success) {
        setPortfolioData(data.data);
      } else {
        setPortfolioData(null);
      }
    } catch (err) {
      console.error('Error fetching portfolio:', err);
      setPortfolioData(null);
    } finally {
      setTabLoading(false);
    }
  };

  // Fetch strategy data
  const fetchStrategyData = async () => {
    try {
      setTabLoading(true);
      console.log('Fetching crypto strategy from /api/crypto/strategy...');
      const response = await fetch('/api/crypto/strategy');

      // Check if response is OK and is JSON
      if (!response.ok) {
        console.warn('Strategy API returned error status:', response.status);
        setStrategyData(null);
        return;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Strategy API did not return JSON');
        setStrategyData(null);
        return;
      }

      const data = await response.json();
      console.log('Crypto strategy API response:', data);

      if (data.success) {
        console.log('Setting strategyData:', data.data);
        setStrategyData(data.data);
      } else {
        console.warn('Strategy API returned success: false');
        setStrategyData(null);
      }
    } catch (err) {
      console.error('Error fetching strategy:', err);
      setStrategyData(null);
    } finally {
      setTabLoading(false);
    }
  };

  // Sort trades by column
  const sortTrades = (trades: Trade[]): Trade[] => {
    return [...trades].sort((a, b) => {
      let aVal: any = a[sortColumn as keyof Trade];
      let bVal: any = b[sortColumn as keyof Trade];

      // Handle null/undefined values - push to end
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // Handle date strings
      if (sortColumn === 'entryTime' || sortColumn === 'exitTime') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }

      // Handle numeric comparisons
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      // Handle string comparisons
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (sortDirection === 'asc') {
        return aStr.localeCompare(bStr);
      } else {
        return bStr.localeCompare(aStr);
      }
    });
  };

  // Handle column sort click
  const handleSortClick = (column: string) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to descending
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Navigate to chart for a specific trade
  const navigateToTrade = async (trade: Trade) => {
    console.log('Navigating to trade:', trade);

    // Store the trade for markers after chart loads
    pendingTradeRef.current = trade;
    setSelectedTrade(trade);

    // Set the zone ID to snap to
    pendingZoneSnapRef.current = trade.zoneId.toString();

    // Auto-enable Show Trades toggle
    setShowTradesOnChart(true);

    // Switch to charts tab
    setActiveTab('charts');

    // Trigger zone search which will load the correct symbol and timeframe
    setZoneSearchQuery(trade.zoneId.toString());

    // Use the fetchCryptoDataWithZoneID function
    await fetchCryptoDataWithZoneID(trade.zoneId.toString());
  };

  // Fetch backtest symbols
  const fetchBacktestSymbols = async () => {
    try {
      const response = await fetch('/api/crypto/backtest?action=symbols');

      // Check if response is OK and is JSON
      if (!response.ok) {
        console.warn('Backtest symbols API returned error status:', response.status);
        return;
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.warn('Backtest symbols API did not return JSON');
        return;
      }

      const data = await response.json();
      if (data.success) {
        setBacktestSymbols(data.symbols);
        // Set default symbol if available
        if (data.symbols.length > 0 && !backtestConfig.symbol) {
          const defaultSymbol = data.symbols[0].symbol;
          setBacktestConfig(prev => ({ ...prev, symbol: defaultSymbol }));
          fetchBacktestDateRange(defaultSymbol);
        }
      }
    } catch (err) {
      console.error('Error fetching backtest symbols:', err);
    }
  };

  // Fetch backtest date range for a symbol
  const fetchBacktestDateRange = async (symbol: string) => {
    try {
      const response = await fetch(`/api/crypto/backtest?action=date-range&symbol=${symbol}`);
      const data = await response.json();
      if (data.success) {
        setBacktestDateRange({ min: data.min_date, max: data.max_date });
        // Set default dates if not set
        if (!backtestConfig.start_date || !backtestConfig.end_date) {
          setBacktestConfig(prev => ({
            ...prev,
            start_date: data.min_date,
            end_date: data.max_date
          }));
        }
      } else {
        setBacktestDateRange(null);
      }
    } catch (err) {
      console.error('Error fetching backtest date range:', err);
      setBacktestDateRange(null);
    }
  };

  // Run backtest
  const runBacktest = async () => {
    setBacktestLoading(true);
    setBacktestError(null);
    setBacktestResults(null);

    try {
      // Build request payload based on mode
      const payload = {
        ...backtestConfig,
        // In multi-symbol mode, use symbols array; in single mode, use symbol
        symbols: multiSymbolMode ? backtestConfig.symbols : undefined,
        symbol: multiSymbolMode ? undefined : backtestConfig.symbol,
      };

      const response = await fetch('/api/crypto/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success) {
        setBacktestResults(data.results);
        setBacktestEngine(data.engine);
      } else {
        setBacktestError(data.error || 'Backtest failed');
      }
    } catch (err: any) {
      setBacktestError(err.message || 'Failed to run backtest');
    } finally {
      setBacktestLoading(false);
    }
  };

  // Format currency helper
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Format percent helper
  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  // Fetch volume profile data
  const fetchVolumeProfile = async (symbol: string, numBins: number = 50) => {
    if (!symbol.trim()) {
      setVolumeProfileData(null);
      return;
    }

    // Resolve symbol to Massive format
    const resolvedSymbol = resolveCryptoSymbol(symbol);

    // Validate dates before fetching
    if (!volumeProfileStartDate || !volumeProfileEndDate) {
      console.log("Volume profile dates not set yet");
      return;
    }

    try {
      // Use custom start and end dates from state
      const startDate = new Date(volumeProfileStartDate);
      const endDate = new Date(volumeProfileEndDate);

      // Check if dates are valid
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        console.error("Invalid date format for volume profile");
        return;
      }

      // Parse time strings (HH:MM format) and set on dates
      const [startHours, startMinutes] = volumeProfileStartTime.split(':').map(Number);
      const [endHours, endMinutes] = volumeProfileEndTime.split(':').map(Number);

      console.log(`[VP] Time inputs: start=${volumeProfileStartTime} (${startHours}:${startMinutes}), end=${volumeProfileEndTime} (${endHours}:${endMinutes})`);

      // Set times from the time inputs (these are interpreted as UTC times)
      startDate.setUTCHours(startHours, startMinutes, 0, 0);
      endDate.setUTCHours(endHours, endMinutes, 59, 999);

      console.log(`[VP] Fetching volume profile: ${startDate.toISOString()} to ${endDate.toISOString()}`);

      const response = await fetch(
        `/api/crypto/volumeprofile?symbol=${resolvedSymbol}&num_bins=${numBins}&timeframe=${timeframe}&start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`
      );
      const data = await response.json();

      if (data.success && data.data) {
        console.log("Volume Profile Data: ", data.data);
        setVolumeProfileData(data.data);
      } else {
        console.log("No volume profile data available");
        setVolumeProfileData(null);
      }
    } catch (err) {
      console.error("Error fetching volume profile:", err);
      setVolumeProfileData(null);
    }
  };

  // Effect to fetch volume profile when enabled and symbol changes
  useEffect(() => {
    if (showVolumeProfile && searchQuery.trim()) {
      fetchVolumeProfile(searchQuery, volumeProfileNumBins);
    }
  }, [showVolumeProfile, searchQuery, volumeProfileNumBins, timeframe, volumeProfileStartDate, volumeProfileEndDate, volumeProfileStartTime, volumeProfileEndTime]);

  // fetch crypto data based on zone_id
  const fetchCryptoDataWithZoneID = async (zoneId: string) => {
    if (!zoneId.trim()) {
      setCryptoData(null);
      setZonesData(null);
      setError(null);
      return;
    }

    try {
      setFetching(true);
      setError(null);

      // Step 1: Fetch zone search data to get symbol and timeframe
      const zoneSearchResponse = await fetch(`/api/crypto/searchzoneid?zone_id=${zoneId}`);
      const zoneSearchData = await zoneSearchResponse.json();
      console.log("ZONE SEARCH TEST: ", zoneSearchData);

      if (!zoneSearchData.success) {
        setError(zoneSearchData.error || `Zone ${zoneId} not found`);
        setCryptoData(null);
        setZonesData(null);
        setFetching(false);
        return;
      }

      const { symbol, timeframe: timeframeLabel } = zoneSearchData.data;
      console.log(`Zone ${zoneId} found: Symbol=${symbol}, Timeframe=${timeframeLabel}`);

      // Step 2: Get limit and hours from timeframe using the same maps as handleTimeframeChange
      const timeframeMap: Record<string, string> = {
        "5min": "5m", "15min": "15m", "30min": "30m", "1h": "1h", "2h": "2h",
        "4h": "4h", "8h": "8h", "Daily": "1d", "7d": "7d", "31d": "31d", "93d": "93d",
        "65min": '65m', "130min": '130m', "195min": '195m', "390min": '390m',
      };
      // Unlimited lookback - fetch all available data from database
      const limitMap: Record<string, number> = {
        "5min": 500000, "15min": 175000, "30min": 90000, "1h": 50000, "2h": 25000,
        "4h": 15000, "8h": 8000, "Daily": 5000, "7d": 1000, "31d": 250, "93d": 100,
        "65min": 50000, "130min": 25000, "195min": 17000, "390min": 10000,
      };
      const hoursMap: Record<string, number> = {
        "5min": 720, "15min": 1440, "30min": 2160, "1h": 2160, "2h": 2160,
        "4h": 4320, "8h": 8760, "Daily": 87600, "7d": 87600, "31d": 87600, "93d": 87600,
        "65min": 4320, "130min": 8760, "195min": 8760, "390min": 26280,
      };

      // Check if timeframeLabel is a key in the map (e.g., "30min")
      // If so, use it directly; otherwise do reverse lookup
      let timeframeKey = timeframeLabel;
      let timeframeValue = timeframeMap[timeframeLabel];

      if (!timeframeValue) {
        // Try reverse lookup: find the key that maps to this value
        timeframeKey = Object.keys(timeframeMap).find(key => timeframeMap[key] === timeframeLabel) || '';
        timeframeValue = timeframeLabel;
      }

      if (!timeframeKey || !timeframeValue) {
        setError(`Unknown timeframe: ${timeframeLabel}`);
        setCryptoData(null);
        setZonesData(null);
        setFetching(false);
        return;
      }

      const newLimit = limitMap[timeframeKey] || 8640;
      const newHours = hoursMap[timeframeKey] || 720;

      // Step 3: Update UI state - symbol search bar, timeframe dropdown, limit, and hours
      setSearchQuery(symbol);
      setSelectedTimeframeKey(timeframeKey); // Update dropdown selection
      setTimeframe(timeframeValue);
      setLimit(newLimit);
      setHours(newHours);

      console.log(`Updated UI: symbol=${symbol}, timeframe=${timeframeValue}, limit=${newLimit}, hours=${newHours}`);

      // Step 4: Call the existing fetchCryptoData function with the new values
      // Pass the values directly since state updates are async
      await fetchCryptoData(symbol, timeframeValue, newLimit, newHours);

    } catch (err: any) {
      setError(`Error fetching data: ${err.message}`);
      setCryptoData(null);
      setZonesData(null);
      setFetching(false);
    }
  };


  // Handle search when Enter key is pressed
  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (searchQuery.trim()) {
        fetchCryptoData(searchQuery);
      } else {
        setCryptoData(null);
        setError(null);
      }
    }
  };

  // Handle search input change (just update state)
  const handleInputChange = (value: string) => {
    setSearchQuery(value);
  };
  // Handle timeframe change
  const handleTimeframeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    const timeframeMap: Record<string, string> = {
      "5min": "5m",
      "15min": "15m",
      "30min": "30m",
      "1h": "1h",
      "2h": "2h",
      "4h": "4h",
      "8h": "8h",
      "Daily": "1d",
      "7d": "7d",
      "31d": "31d",
      "93d": "93d",
      "65min": '65m',
      "130min": '130m',
      "195min": '195m',
      "390min": '390m',

    };
    // Unlimited lookback - fetch all available data from database
    const limitMap: Record<string, number> = {
      "5min": 500000,
      "15min": 175000,
      "30min": 90000,
      "1h": 50000,
      "2h": 25000,
      "4h": 15000,
      "8h": 8000,
      "Daily": 5000,
      "7d": 1000,
      "31d": 250,
      "93d": 100,
      "65min": 50000,
      "130min": 25000,
      "195min": 17000,
      "390min": 10000,
    };
    const hoursMap: Record<string, number> = {
      "5min": 720,
      "15min": 1440,
      "30min": 2160,
      "1h": 2160,
      "2h": 2160,
      "4h": 4320,
      "8h": 8760,
      "Daily": 87600,     // ~10 years for day-based timeframes
      "7d": 87600,        // ~10 years
      "31d": 87600,       // ~10 years
      "93d": 87600,        // ~10 years
      "65min": 4320,
      "130min": 8760,
      "195min": 8760,
      "390min": 26280,
    };
    setSelectedTimeframeKey(selected);
    setTimeframe(timeframeMap[selected] || selected);
    setLimit(limitMap[selected] || 8640);
    setHours(hoursMap[selected] || 720);
  };

  // Handle zone search and zoom to zone
  const handleZoneSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const zoneId = zoneSearchQuery.trim();
      if (!zoneId || !zonesData || !zonesData.zones || !chartInstanceRef.current) {
        return;
      }

      // Find the zone by zone_id
      const targetZone = zonesData.zones.find((z: any) => z.zone_id.toString() === zoneId);

      if (!targetZone) {
        setError(`Zone ${zoneId} not found`);
        setTimeout(() => setError(null), 3000);
        return;
      }

      try {
        // Convert zone times to Unix timestamps
        const zoneStartTime = Math.floor(new Date(targetZone.start_time).getTime() / 1000);

        // Position zone at left edge with a fixed wide view window
        // Use a fixed time window regardless of zone duration
        const leftPadding = 3600; // 1 hour before zone start
        const rightWindow = 259200; // 3 days after zone start - balanced zoom level

        // Set visible range with zone at left edge
        chartInstanceRef.current.timeScale().setVisibleRange({
          from: (zoneStartTime - leftPadding) as Time,
          to: (zoneStartTime + rightWindow) as Time,
        });

        console.log(`Zoomed to zone ${zoneId}:`, {
          startTime: new Date(zoneStartTime * 1000).toISOString(),
          visibleFrom: new Date((zoneStartTime - leftPadding) * 1000).toISOString(),
          visibleTo: new Date((zoneStartTime + rightWindow) * 1000).toISOString(),
          windowDays: (rightWindow / 86400).toFixed(1)
        });
      } catch (err) {
        console.error('Error zooming to zone:', err);
        setError('Error zooming to zone');
        setTimeout(() => setError(null), 3000);
      }
    }
  };

  // Handle zone ID search - fetch data globally and snap to zone
  const handleZoneIdSearch = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const zoneId = zoneSearchQuery.trim();
      if (!zoneId) {
        return;
      }

      // Step 1: Fetch all data for this zone (symbol, timeframe, aggregates, zones)
      await fetchCryptoDataWithZoneID(zoneId);

      // Step 2: Set pending zone to snap to
      // The useEffect watching zonesData will handle the actual snapping
      pendingZoneSnapRef.current = zoneId;
      console.log(`Set pending zone snap to ${zoneId}`);

      // Clear the search query
      setZoneSearchQuery('');
    }
  };

  // Initialize candlestick chart when cryptoData changes
  useEffect(() => {
    console.log('Chart effect triggered - cryptoData:', cryptoData?.symbol, 'zonesData:', zonesData?.symbol);
    if (!cryptoData || !chartContainerRef.current) return;

    try {
      // Create chart with time scale and crosshair configuration
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
        layout: {
          background: { color: '#1A1410' }, // panel color
          textColor: '#E8D5B5', // secondary color
        },
        grid: {
          vertLines: { color: 'rgba(232, 213, 181, 0.1)' },
          horzLines: { color: 'rgba(232, 213, 181, 0.1)' },
        },
        crosshair: {
          mode: 1, // Normal crosshair mode (0 = Magnet, 1 = Normal)
          vertLine: {
            width: 1,
            color: '#F59E0B', // accent color
            style: 2, // Dashed line
            labelVisible: true, // Show date/time label on x-axis
            labelBackgroundColor: '#F59E0B',
          },
          horzLine: {
            width: 1,
            color: '#F59E0B',
            style: 2,
            labelVisible: true, // Show price label on y-axis
            labelBackgroundColor: '#F59E0B',
          },
        },
        timeScale: {
          visible: true, // Show time scale
          timeVisible: true, // Show time (not just date)
          secondsVisible: false, // Don't show seconds for cleaner look
          borderColor: 'rgba(232, 213, 181, 0.2)',
        },
        rightPriceScale: {
          visible: true,
          borderColor: 'rgba(232, 213, 181, 0.2)',
        },
      });

      // Store chart instance for later access (e.g., zoom to zone)
      chartInstanceRef.current = chart;

      // Add candlestick series
      const candlestickSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });

      // Store candlestick series reference for volume profile
      candlestickSeriesRef.current = candlestickSeries as ISeriesApi<SeriesType>;

      // Convert bars data to candlestick format
      const candleData = cryptoData.bars
        .map((bar) => {
          // Convert bucket timestamp to Unix timestamp in seconds
          const time = Math.floor(new Date(bar.bucket).getTime() / 1000);
          return {
            time,
            open: Number(bar.open),
            high: Number(bar.high),
            low: Number(bar.low),
            close: Number(bar.close),
          };
        })
        // Filter out any invalid timestamps (NaN values)
        .filter((candle) => !isNaN(candle.time))
        // Sort by time in ascending order (required by lightweight-charts)
        .sort((a, b) => a.time - b.time);

      console.log(`Rendering ${candleData.length} candles for ${cryptoData.symbol}`);
      if (candleData.length === 0) {
        console.error('No valid candle data to render');
        return;
      }

      // Set data on the series
      candlestickSeries.setData(candleData as any);

      // Fit content to view
      chart.timeScale().fitContent();

      // Initialize Rectangle Drawing Tool with snapping - COMMENTED OUT
      // if (drawingToolbarRef.current) {
      //   // Clean up existing drawing tool if any
      //   if (drawingToolRef.current) {
      //     drawingToolRef.current.remove();
      //   }

      //   // Create snapping drawing tool with supply/demand zone colors
      //   drawingToolRef.current = new SnappingRectangleDrawingTool(
      //     chart,
      //     candlestickSeries as any,
      //     drawingToolbarRef.current,
      //     {
      //       fillColor: 'rgba(255, 82, 82, 0.3)', // Supply zone (red)
      //       previewFillColor: 'rgba(255, 82, 82, 0.15)',
      //       labelColor: '#FF5252',
      //       labelTextColor: 'white',
      //       showLabels: true,
      //       priceLabelFormatter: (price: number) => `$${price.toFixed(2)}`,
      //       timeLabelFormatter: (time: any) => {
      //         const date = new Date(time * 1000);
      //         return date.toLocaleString();
      //       },
      //     },
      //     candleData
      //   );
      // }

      // Clean up existing zone primitives
      zonePrimitivesRef.current.forEach(primitive => {
        candlestickSeries.detachPrimitive(primitive);
      });
      zonePrimitivesRef.current = [];

      // Clean up existing volume profile primitive
      if (volumeProfilePrimitiveRef.current) {
        candlestickSeries.detachPrimitive(volumeProfilePrimitiveRef.current);
        volumeProfilePrimitiveRef.current = null;
      }

      // Clean up existing trade marker primitive
      if (tradeMarkerPrimitiveRef.current) {
        candlestickSeries.detachPrimitive(tradeMarkerPrimitiveRef.current);
        tradeMarkerPrimitiveRef.current = null;
      }

      // Create zone primitives using lightweight-charts primitive system
      if (zonesData && zonesData.zones && candleData.length > 0) {
        zonesData.zones.forEach((zone: any) => {
          try {
            const isDemand = zone.zone_type.toLowerCase() === 'demand';
            const topPrice = parseFloat(zone.top_price);
            const bottomPrice = parseFloat(zone.bottom_price);

            // Convert start_time to Unix timestamp in seconds
            const zoneStartTime = Math.floor(new Date(zone.start_time).getTime() / 1000);

            // Determine zone end time by checking for breaks in candle data
            // Default to last candle or 24h after start
            const lastCandle = candleData[candleData.length - 1];
            let zoneEndTime: number = lastCandle ? lastCandle.time : zoneStartTime + 86400;
            let isBroken = false;

            // Find candles after zone start
            const candlesAfterZone = candleData.filter(c => c.time >= zoneStartTime);

            // Check each candle to see if it breaks the zone
            // Zone is broken when ANY of OHLC values achieve full penetration past the zone
            for (const candle of candlesAfterZone) {
              if (isDemand) {
                // Demand zone broken if ANY of OHLC is below bottom price (full penetration)
                if (candle.open < bottomPrice || candle.high < bottomPrice ||
                  candle.low < bottomPrice || candle.close < bottomPrice) {
                  zoneEndTime = candle.time;
                  isBroken = true;
                  break;
                }
              } else {
                // Supply zone broken if ANY of OHLC is above top price (full penetration)
                if (candle.open > topPrice || candle.high > topPrice ||
                  candle.low > topPrice || candle.close > topPrice) {
                  zoneEndTime = candle.time;
                  isBroken = true;
                  break;
                }
              }
            }

            // Colors for demand (green) and supply (red) zones
            const fillColor = isDemand ? 'rgba(76, 175, 80, 0.3)' : 'rgba(255, 82, 82, 0.3)';
            const borderColor = isDemand ? '#4CAF50' : '#FF5252';

            // Create zone primitive with start and end points
            const zonePrimitive = new ZonePrimitive(
              { time: zoneStartTime as Time, price: topPrice },
              { time: zoneEndTime as Time, price: bottomPrice },
              {
                fillColor,
                borderColor,
                showLabel: true,
                labelText: `Zone ${zone.zone_id}${isBroken ? ' [BROKEN]' : ''}`
              }
            );

            // Attach primitive to the series - this integrates it with the chart's rendering pipeline
            candlestickSeries.attachPrimitive(zonePrimitive);
            zonePrimitivesRef.current.push(zonePrimitive);

            console.log(`Zone ${zone.zone_id} attached as primitive:`, {
              type: zone.zone_type,
              isBroken,
              startTime: new Date(zoneStartTime * 1000).toISOString(),
              endTime: new Date(zoneEndTime! * 1000).toISOString(),
              topPrice,
              bottomPrice
            });
          } catch (err) {
            console.error(`Error creating zone primitive:`, err);
          }
        });
      }

      // Add volume profile primitive if enabled and data is available
      if (volumeProfilePrimitiveRef.current) {
        candlestickSeries.detachPrimitive(volumeProfilePrimitiveRef.current);
        volumeProfilePrimitiveRef.current = null;
      }

      if (showVolumeProfile && volumeProfileData && volumeProfileData.nodes.length > 0) {
        const volumeProfilePrimitive = new VolumeProfilePrimitive(
          volumeProfileData.nodes,
          volumeProfileData.price_range,
          true, // showPOC
          true, // showHVN
          true  // showLVN
        );
        candlestickSeries.attachPrimitive(volumeProfilePrimitive);
        volumeProfilePrimitiveRef.current = volumeProfilePrimitive;
        console.log(`Volume profile attached with ${volumeProfileData.nodes.length} nodes`);
      }

      // Initialize hoveredCandle with last available candle data
      if (candleData.length > 0 && cryptoData.bars.length > 0) {
        const lastCandle = candleData[candleData.length - 1];
        const lastBar = cryptoData.bars[cryptoData.bars.length - 1];
        const lastVolume = lastBar.volume || 0;
        const lastVWAP = (lastCandle.high + lastCandle.low + lastCandle.close) / 3;
        const lastDollarVolume = lastVolume * lastVWAP;

        setHoveredCandle({
          high: lastCandle.high,
          low: lastCandle.low,
          open: lastCandle.open,
          close: lastCandle.close,
          volume: lastVolume,
          dollarVolume: lastDollarVolume,
        });
      }

      // Add crosshair move handler for zone tooltips AND hover stats tracking
      chart.subscribeCrosshairMove((param) => {
        // Handle hover stats (always track, even without param.point)
        if (param.time && param.seriesData) {
          const candleData = param.seriesData.get(candlestickSeries);
          if (candleData && 'open' in candleData && 'high' in candleData && 'low' in candleData && 'close' in candleData) {
            const { open, high, low, close } = candleData;
            const timeValue = typeof param.time === 'number' ? param.time : Math.floor(new Date(param.time as string).getTime() / 1000);

            // Find matching bar from cryptoData to get volume
            const matchingBar = cryptoData.bars.find(bar => {
              const barTime = Math.floor(new Date(bar.bucket).getTime() / 1000);
              return barTime === timeValue;
            });

            const volume = matchingBar ? matchingBar.volume : 0;

            // Calculate dollar volume as volume * VWAP (approximation)
            const vwap = (high + low + close) / 3;
            const dollarVolume = volume * vwap;

            setHoveredCandle({ high, low, open, close, volume, dollarVolume });
          }
        } else if (candleData.length > 0 && cryptoData.bars.length > 0) {
          // Fallback to last candle when cursor leaves chart
          const lastCandle = candleData[candleData.length - 1];
          const lastBar = cryptoData.bars[cryptoData.bars.length - 1];
          const lastVolume = lastBar.volume || 0;
          const lastVWAP = (lastCandle.high + lastCandle.low + lastCandle.close) / 3;
          const lastDollarVolume = lastVolume * lastVWAP;

          setHoveredCandle({
            high: lastCandle.high,
            low: lastCandle.low,
            open: lastCandle.open,
            close: lastCandle.close,
            volume: lastVolume,
            dollarVolume: lastDollarVolume,
          });
        }

        // Handle zone tooltips (requires param.point)
        if (!param.point || !param.time || !zonesData || !zonesData.zones) {
          setZoneTooltip(null);
          return;
        }

        const price = candlestickSeries.coordinateToPrice(param.point.y);
        const time = typeof param.time === 'number' ? param.time : Math.floor(new Date(param.time as string).getTime() / 1000);

        if (price === null) {
          setZoneTooltip(null);
          return;
        }

        // Check if mouse is within any zone
        for (const zone of zonesData.zones) {
          const topPrice = parseFloat(zone.top_price);
          const bottomPrice = parseFloat(zone.bottom_price);
          const zoneStartTime = Math.floor(new Date(zone.start_time).getTime() / 1000);
          const zoneEndTime = zone.end_time
            ? Math.floor(new Date(zone.end_time).getTime() / 1000)
            : zoneStartTime + 86400;

          // Check if mouse is within zone bounds (price and time)
          if (price <= topPrice && price >= bottomPrice && time >= zoneStartTime && time <= zoneEndTime) {
            setZoneTooltip({
              visible: true,
              x: param.point.x,
              y: param.point.y,
              zoneId: zone.zone_id,
              topPrice: topPrice,
              bottomPrice: bottomPrice,
              zoneType: zone.zone_type
            });
            return;
          }
        }

        // No zone under mouse
        setZoneTooltip(null);
      });

      // Check if there's a pending zone to snap to after chart and zones are ready
      if (pendingZoneSnapRef.current && zonesData && zonesData.zones) {
        const zoneId = pendingZoneSnapRef.current;
        const targetZone = zonesData.zones.find((z: any) => z.zone_id.toString() === zoneId);

        if (targetZone) {
          // Small delay to ensure zones are fully rendered
          setTimeout(() => {
            try {
              const zoneStartTime = Math.floor(new Date(targetZone.start_time).getTime() / 1000);
              const leftPadding = 3600; // 1 hour before zone start
              const rightWindow = 259200; // 3 days after zone start

              chart.timeScale().setVisibleRange({
                from: (zoneStartTime - leftPadding) as Time,
                to: (zoneStartTime + rightWindow) as Time,
              });

              console.log(`Successfully snapped to zone ${zoneId} at ${new Date(zoneStartTime * 1000).toISOString()}`);

              // Create trade markers if we navigated from Trade History
              if (pendingTradeRef.current) {
                const trade = pendingTradeRef.current;
                console.log('Creating trade markers for:', trade);

                // Calculate entry time - use retestDate or alertTime (matching stock dashboard)
                const entryTimeStr = trade.retestDate || trade.alertTime;
                const entryTime = Math.floor(new Date(entryTimeStr).getTime() / 1000) as Time;
                const entryPrice = trade.retestPrice || trade.entryPrice;

                // Calculate exit time (5 days after entry) and exit price
                let exitTime: Time | undefined;
                let exitPrice: number | undefined;

                if (trade.close5d !== null) {
                  // Exit is 5 trading days after entry
                  const entryDate = new Date(entryTimeStr);
                  const exitDate = new Date(entryDate);
                  exitDate.setDate(exitDate.getDate() + 7); // ~5 trading days
                  exitTime = Math.floor(exitDate.getTime() / 1000) as Time;
                  exitPrice = trade.close5d;
                }

                // Create the trade marker primitive
                const tradeMarker = new TradeMarkerPrimitive({
                  entryTime,
                  entryPrice,
                  exitTime,
                  exitPrice,
                  outcome: trade.outcome,
                  zoneType: trade.zoneType.toLowerCase() as 'demand' | 'supply'
                });

                candlestickSeries.attachPrimitive(tradeMarker);
                tradeMarkerPrimitiveRef.current = tradeMarker;
                console.log('Trade marker attached');

                // Clear the pending trade
                pendingTradeRef.current = null;
              }

              // Clear the pending snap
              pendingZoneSnapRef.current = null;
            } catch (err) {
              console.error('Error snapping to zone:', err);
              pendingZoneSnapRef.current = null;
              pendingTradeRef.current = null;
            }
          }, 200);
        } else {
          console.warn(`Zone ${zoneId} not found in zones data`);
          pendingZoneSnapRef.current = null;
          pendingTradeRef.current = null;
        }
      }

      // Clean up existing trade markers before rendering new ones
      tradeMarkerPrimitivesRef.current.forEach(primitive => {
        candlestickSeries.detachPrimitive(primitive);
      });
      tradeMarkerPrimitivesRef.current = [];

      // Render all trades for the current symbol if showTradesOnChart is enabled
      if (showTradesOnChart && tradesData && cryptoData) {
        const currentSymbol = cryptoData.symbol;
        const symbolTrades = tradesData.trades.filter((t: any) => t.symbol === currentSymbol);

        console.log(`Rendering ${symbolTrades.length} crypto trade markers for ${currentSymbol}`);

        symbolTrades.forEach((trade: any) => {
          try {
            // Calculate entry time
            const entryTimeStr = trade.entryTime || trade.retestDate || trade.alertTime;
            if (!entryTimeStr) return;

            const entryTime = Math.floor(new Date(entryTimeStr).getTime() / 1000) as Time;
            const entryPrice = trade.entryPrice || trade.retestPrice;
            if (!entryPrice) return;

            // Calculate exit time and price
            let exitTime: Time | undefined;
            let exitPrice: number | undefined;

            if (trade.exitTime) {
              exitTime = Math.floor(new Date(trade.exitTime).getTime() / 1000) as Time;
              exitPrice = trade.exitPrice || undefined;
            } else if (trade.close5d !== null && trade.close5d !== undefined) {
              // Exit is ~5 trading days after entry
              const entryDate = new Date(entryTimeStr);
              const exitDate = new Date(entryDate);
              exitDate.setDate(exitDate.getDate() + 7);
              exitTime = Math.floor(exitDate.getTime() / 1000) as Time;
              exitPrice = trade.close5d;
            }

            // Create the trade marker primitive
            const tradeMarker = new TradeMarkerPrimitive({
              entryTime,
              entryPrice,
              exitTime,
              exitPrice,
              outcome: trade.outcome,
              zoneType: (trade.zoneType || 'demand').toLowerCase() as 'demand' | 'supply'
            });

            candlestickSeries.attachPrimitive(tradeMarker);
            tradeMarkerPrimitivesRef.current.push(tradeMarker);
          } catch (err) {
            console.error('Error creating trade marker:', err, trade);
          }
        });
      }

      // Handle window resize
      const handleResize = () => {
        if (chartContainerRef.current) {
          chart.applyOptions({
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          });
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);

        // Clean up zone primitives
        zonePrimitivesRef.current.forEach(primitive => {
          candlestickSeries.detachPrimitive(primitive);
        });
        zonePrimitivesRef.current = [];

        // Clean up volume profile primitive
        if (volumeProfilePrimitiveRef.current) {
          candlestickSeries.detachPrimitive(volumeProfilePrimitiveRef.current);
          volumeProfilePrimitiveRef.current = null;
        }

        // Clean up trade marker primitive (single)
        if (tradeMarkerPrimitiveRef.current) {
          candlestickSeries.detachPrimitive(tradeMarkerPrimitiveRef.current);
          tradeMarkerPrimitiveRef.current = null;
        }

        // Clean up multiple trade marker primitives
        tradeMarkerPrimitivesRef.current.forEach(primitive => {
          candlestickSeries.detachPrimitive(primitive);
        });
        tradeMarkerPrimitivesRef.current = [];

        // Drawing tool cleanup - COMMENTED OUT
        // if (drawingToolRef.current) {
        //   drawingToolRef.current.remove();
        //   drawingToolRef.current = null;
        // }
        chart.remove();
        chartInstanceRef.current = null;
        candlestickSeriesRef.current = null;
      };
    } catch (err) {
      console.error('Error initializing chart:', err);
    }
  }, [cryptoData, zonesData, showVolumeProfile, volumeProfileData, showTradesOnChart, tradesData]);

  const isLocked = user.role === "free";

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Left Sidebar - Tab Navigation */}
      <aside className="w-16 bg-panel border-r border-border/30 flex flex-col items-center py-4 gap-2">
        {/* Logo */}
        <Link href="/" className="w-10 h-10 bg-gradient-to-br from-accent to-accent-dark rounded flex items-center justify-center mb-4">
          <Coins className="h-5 w-5 text-white" />
        </Link>

        {/* Tab Navigation Icons */}
        {[
          { icon: LineChart, label: "Charts", tab: 'charts' as DashboardTab },
          { icon: TrendingUp, label: "Trades", tab: 'trades' as DashboardTab },
          { icon: FlaskConical, label: "Strategy", tab: 'strategy' as DashboardTab },
          { icon: PieChart, label: "Portfolio", tab: 'portfolio' as DashboardTab },
          { icon: Bell, label: "Alerts", tab: 'alerts' as DashboardTab },
          { icon: Activity, label: "Backtest", tab: 'backtest' as DashboardTab },
        ].map((item) => (
          <button
            key={item.tab}
            onClick={() => setActiveTab(item.tab)}
            className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
              activeTab === item.tab
                ? 'bg-accent/10 text-accent'
                : 'text-secondary hover:bg-elevated hover:text-primary'
            }`}
            title={item.label}
          >
            <item.icon className="h-5 w-5" />
          </button>
        ))}

        {/* Bottom icons */}
        <div className="mt-auto flex flex-col gap-2">
          <button className="w-10 h-10 rounded flex items-center justify-center text-secondary hover:bg-elevated hover:text-primary transition-colors">
            <Settings className="h-5 w-5" />
          </button>
          <Link href="/.auth/logout" className="w-10 h-10 rounded flex items-center justify-center text-secondary hover:bg-elevated hover:text-primary transition-colors">
            <LogOut className="h-5 w-5" />
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 bg-panel border-b border-border/30 flex items-center justify-between px-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse"></div>
              <span className="text-sm font-medium text-primary">
                {cryptoData?.symbol || 'Select Crypto'}
              </span>
              <span className="text-lg font-bold text-success">
                ${cryptoData ? Number(cryptoData.latest_price).toFixed(2) : '0.00'}
              </span>
              <span className={`text-sm ${cryptoData && cryptoData.change_percent >= 0 ? 'text-success' : 'text-red-500'}`}>
                {cryptoData ? `${cryptoData.change_percent >= 0 ? '+' : ''}${Number(cryptoData.change_percent).toFixed(2)}%` : '0.00%'}
              </span>
            </div>
            {error && (
              <div className="text-xs text-red-500 ml-4">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {isLocked && (
              <div className="px-3 py-1.5 bg-accent/10 border border-accent/30 rounded-lg flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 text-accent" />
                <span className="text-xs font-medium text-accent">Free Plan</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                <span className="text-sm font-medium text-accent">
                  {user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="text-sm">
                <div className="font-medium text-primary">
                  {user.name}
                </div>
                <div className="text-xs text-secondary">
                  {user.email}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Dashboard Grid */}
        <div className="flex-1 flex overflow-hidden">
          {/* Center: Tab Content Area */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* CHARTS TAB */}
            {activeTab === 'charts' && (
              <div className="flex-1 flex flex-col">
            {/* Chart Container */}
            <div className="flex-1 p-4 pb-2">
              <div className="h-full bg-panel border border-border rounded-lg flex flex-col">
              {/* Chart Header */}
              <div className="bg-elevated p-3 border-b border-border flex items-center justify-between shrink-0" 
              >
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search crypto (e.g., BTC, ETH)... Press Enter"
                      value={searchQuery}
                      onChange={(e) => handleInputChange(e.target.value)}
                      onKeyDown={handleSearchKeyPress}
                      disabled={fetching}
                      className="bg-background border border-border rounded px-3 py-1.5 pl-10 text-sm text-primary placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>
                  <select
                    className="bg-background border border-border rounded px-3 py-1.5 text-sm text-primary"
                    onChange={handleTimeframeChange}
                    value={selectedTimeframeKey}
                  >                    <option>5min</option>
                    <option>15min</option>
                    <option>30min</option>
                    <option>1h</option>
                    <option>2h</option>
                    <option>4h</option>
                    <option>8h</option>
                    <option>65min</option>
                    <option>130min</option>
                    <option>195min</option>
                    <option>390min</option>
                    <option>Daily</option>
                    <option>7d</option>
                    <option>31d</option>
                    <option>93d</option>
                  </select>
                  <div className="relative">
                    <Target className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Zone ID... Press Enter"
                      value={zoneSearchQuery}
                      onChange={(e) => setZoneSearchQuery(e.target.value)}
                      onKeyDown={handleZoneIdSearch}
                      disabled={fetching}
                      className="bg-background border border-border rounded px-3 py-1.5 pl-10 text-sm text-primary placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>
                  {/* Volume Profile Toggle */}
                  <button
                    onClick={() => setShowVolumeProfile(!showVolumeProfile)}
                    className={`px-3 py-1.5 text-xs border rounded flex items-center gap-2 transition-colors ${
                      showVolumeProfile
                        ? 'bg-accent/20 border-accent text-accent'
                        : 'bg-background border-border text-secondary hover:text-primary hover:bg-elevated'
                    }`}
                    title="Toggle Volume Profile"
                  >
                    <BarChart3 className="h-4 w-4" />
                    VP
                  </button>
                  {/* Show Trades Toggle */}
                  <button
                    onClick={() => setShowTradesOnChart(!showTradesOnChart)}
                    className={`px-3 py-1.5 text-xs border rounded flex items-center gap-2 transition-colors ${
                      showTradesOnChart
                        ? 'bg-accent/20 border-accent text-accent'
                        : 'bg-background border-border text-secondary hover:text-primary hover:bg-elevated'
                    }`}
                    title="Show trade entry/exit markers on chart"
                  >
                    <Target className="h-4 w-4" />
                    Trades
                  </button>
                  {/* Volume Profile Controls (only show when VP is active) */}
                  {showVolumeProfile && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        className="bg-background border border-border rounded px-2 py-1.5 text-xs text-primary"
                        value={volumeProfileNumBins}
                        onChange={(e) => setVolumeProfileNumBins(parseInt(e.target.value))}
                        title="Number of bins"
                      >
                        <option value={25}>25 bins</option>
                        <option value={50}>50 bins</option>
                        <option value={75}>75 bins</option>
                        <option value={100}>100 bins</option>
                      </select>
                      {/* Start Date and Time */}
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-secondary whitespace-nowrap">From:</label>
                        <input
                          type="date"
                          className="bg-background border border-border rounded px-1 py-1 text-xs text-primary cursor-pointer"
                          value={volumeProfileStartDate}
                          onChange={(e) => setVolumeProfileStartDate(e.target.value)}
                          title="Start date for volume profile"
                        />
                        <input
                          type="time"
                          className="bg-background border border-border rounded px-1 py-1 text-xs text-primary cursor-pointer"
                          value={volumeProfileStartTime}
                          onChange={(e) => setVolumeProfileStartTime(e.target.value)}
                          title="Start time (UTC)"
                        />
                      </div>
                      {/* End Date and Time */}
                      <div className="flex items-center gap-1">
                        <label className="text-xs text-secondary whitespace-nowrap">To:</label>
                        <input
                          type="date"
                          className="bg-background border border-border rounded px-1 py-1 text-xs text-primary cursor-pointer"
                          value={volumeProfileEndDate}
                          onChange={(e) => setVolumeProfileEndDate(e.target.value)}
                          title="End date for volume profile"
                        />
                        <input
                          type="time"
                          className="bg-background border border-border rounded px-1 py-1 text-xs text-primary cursor-pointer"
                          value={volumeProfileEndTime}
                          onChange={(e) => setVolumeProfileEndTime(e.target.value)}
                          title="End time (UTC)"
                        />
                      </div>
                      <span className="text-xs text-accent font-medium">(UTC)</span>
                    </div>
                  )}
                </div>
                {/* <div className="flex gap-2 items-center">
                  <div
                    ref={drawingToolbarRef}
                    className="flex gap-1 items-center border-r border-border pr-2 mr-2"
                  />
                  <button className="p-1.5 hover:bg-elevated rounded transition-colors">
                    <BarChart3 className="h-4 w-4 text-secondary" />
                  </button>
                  <button className="p-1.5 hover:bg-elevated rounded transition-colors">
                    <Settings className="h-4 w-4 text-secondary" />
                  </button>
                </div> */}
              </div>

              {/* Chart Content */}
              <div className="flex-1 pt-4 pr-4 pb-4 relative min-h-0">
                {/* Lightweight Charts Container */}
                <div
                  ref={chartContainerRef}
                  className="w-full h-full"
                />

                {/* Zone Hover Tooltip */}
                {zoneTooltip && zoneTooltip.visible && (
                  <div
                    className="absolute bg-elevated border border-accent/50 rounded-lg p-3 shadow-honey-lg pointer-events-none z-50"
                    style={{
                      left: `${zoneTooltip.x + 15}px`,
                      top: `${zoneTooltip.y - 80}px`,
                    }}
                  >
                    <div className="text-xs font-semibold text-accent mb-1">
                      Zone {zoneTooltip.zoneId} ({zoneTooltip.zoneType})
                    </div>
                    <div className="text-xs text-primary space-y-0.5">
                      <div>Top: <span className="font-mono text-success">${zoneTooltip.topPrice}</span></div>
                      <div>Bottom: <span className="font-mono text-secondary">${zoneTooltip.bottomPrice}</span></div>

                      {/* Show entry/target/stoploss if available for this specific zone */}
                      {entryTargetStopLoss && entryTargetStopLoss[zoneTooltip.zoneId] && (
                        <>
                          <div className="border-t border-accent/30 my-1 pt-1"></div>
                          <div>Entry: <span className="font-mono text-accent">${entryTargetStopLoss[zoneTooltip.zoneId].entry_price}</span></div>
                          <div>Target: <span className="font-mono text-success">${entryTargetStopLoss[zoneTooltip.zoneId].target_price}</span></div>
                          <div>Stop Loss: <span className="font-mono text-red-400">${entryTargetStopLoss[zoneTooltip.zoneId].stop_loss}</span></div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Lock Overlay for Free Users */}
                {isLocked && (
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-md flex items-center justify-center" >
                    <div className="text-center max-w-md p-8">
                      <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Lock className="h-8 w-8 text-accent" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2 text-primary">
                        Unlock Professional Charts
                      </h3>
                      <p className="text-secondary mb-6">
                        Upgrade to Pro to access real-time crypto charts, advanced indicators, and AI-powered insights.
                      </p>
                      <Link
                        href="/#pricing"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-all"
                      >
                        <Crown className="h-5 w-5" />
                        Upgrade to Pro - $49/mo
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <p className="text-xs text-secondary mt-4">
                        Or continue with limited features
                      </p>
                    </div>
                  </div>
                )}
              </div>
              </div>
            </div>

            {/* Stats Container - Separate from Chart - Dynamic Hover Stats */}
            <div className="px-4 pb-4">
              <div className="grid grid-cols-3 gap-10">
              {cryptoData && hoveredCandle ? [
                // Show candle data (hovered candle or last available candle)
                {
                  label: 'Dollar Volume',
                  value: hoveredCandle.dollarVolume >= 1_000_000_000
                    ? `$${(hoveredCandle.dollarVolume / 1_000_000_000).toFixed(2)}B`
                    : hoveredCandle.dollarVolume >= 1_000_000
                    ? `$${(hoveredCandle.dollarVolume / 1_000_000).toFixed(2)}M`
                    : `$${(hoveredCandle.dollarVolume / 1_000).toFixed(2)}K`,
                  change: `${(hoveredCandle.volume / 1_000_000).toFixed(2)}M shares`,
                  up: true
                },
                {
                  label: 'High',
                  value: `$${hoveredCandle.high.toFixed(2)}`,
                  change: `+${((hoveredCandle.high - hoveredCandle.close) / hoveredCandle.close * 100).toFixed(2)}%`,
                  up: true
                },
                {
                  label: 'Low',
                  value: `$${hoveredCandle.low.toFixed(2)}`,
                  change: `${((hoveredCandle.low - hoveredCandle.close) / hoveredCandle.close * 100).toFixed(2)}%`,
                  up: false
                },
              ].map((stat, i) => (
                <div key={i} className="bg-panel border border-border rounded-lg p-4">
                  <div className="text-xs text-secondary mb-1">{stat.label}</div>
                  <div className="text-lg font-bold text-primary mb-1">{stat.value}</div>
                  <div className="text-xs text-secondary">
                    {stat.change}
                  </div>
                </div>
              )) : (
                <div className="col-span-3 text-center text-secondary py-8">
                  Search for a crypto symbol (e.g., BTC, ETH, XRP) to view statistics
                </div>
              )}
              </div>
            </div>
              </div>
            )}

            {/* TRADES TAB */}
            {activeTab === 'trades' && (
              <div className="flex-1 p-4 overflow-auto">
                <div className="bg-panel border border-border rounded-lg">
                  <div className="bg-elevated p-4 border-b border-border">
                    <h2 className="text-lg font-bold text-primary">Trade History</h2>
                    <p className="text-sm text-secondary">Crypto zone alerts and their outcomes</p>
                  </div>
                  {tabLoading ? (
                    <div className="p-8 text-center text-secondary">Loading trades...</div>
                  ) : tradesData ? (
                    <>
                      {/* Summary Stats */}
                      <div className="p-4 grid grid-cols-6 gap-4 border-b border-border">
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Total Trades</div>
                          <div className="text-xl font-bold text-primary">{tradesData.summary.totalTrades}</div>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Win Rate</div>
                          <div className="text-xl font-bold text-success">{tradesData.summary.winRate}%</div>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Wins / Losses</div>
                          <div className="text-xl font-bold">
                            <span className="text-success">{tradesData.summary.wins}</span>
                            <span className="text-secondary"> / </span>
                            <span className="text-red-500">{tradesData.summary.losses}</span>
                          </div>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Total P&L</div>
                          <div className={`text-xl font-bold ${parseFloat(tradesData.summary.totalPnlPercent || tradesData.summary.totalPnL) >= 0 ? 'text-success' : 'text-red-500'}`}>
                            {parseFloat(tradesData.summary.totalPnlPercent || tradesData.summary.totalPnL) >= 0 ? '+' : ''}{tradesData.summary.totalPnlPercent || tradesData.summary.totalPnL}%
                          </div>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Avg P&L</div>
                          <div className={`text-xl font-bold ${parseFloat(tradesData.summary.avgPnlPercent || tradesData.summary.avgReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                            {parseFloat(tradesData.summary.avgPnlPercent || tradesData.summary.avgReturn) >= 0 ? '+' : ''}{tradesData.summary.avgPnlPercent || tradesData.summary.avgReturn}%
                          </div>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Avg R-Multiple</div>
                          <div className={`text-xl font-bold ${parseFloat(tradesData.summary.avgRMultiple || '0') >= 0 ? 'text-success' : 'text-red-500'}`}>
                            {parseFloat(tradesData.summary.avgRMultiple || '0') >= 0 ? '+' : ''}{tradesData.summary.avgRMultiple || '0'}R
                          </div>
                        </div>
                      </div>
                      {/* Trades Table */}
                      <div className="overflow-auto max-h-[600px]">
                        <div className="flex items-center justify-between px-3 py-2 bg-elevated/50 border-b border-border">
                          <span className="text-xs text-secondary">Click a trade to view on chart</span>
                        </div>
                        <table className="w-full text-sm min-w-[1200px]">
                          <thead className="bg-elevated sticky top-0 z-10">
                            <tr className="text-left text-secondary">
                              <th className="p-3 cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('symbol')}>
                                <div className="flex items-center gap-1">
                                  Symbol
                                  {sortColumn === 'symbol' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('zoneType')}>
                                <div className="flex items-center gap-1">
                                  Type
                                  {sortColumn === 'zoneType' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 whitespace-nowrap cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('entryTime')}>
                                <div className="flex items-center gap-1">
                                  Entry Date
                                  {sortColumn === 'entryTime' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 whitespace-nowrap cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('exitTime')}>
                                <div className="flex items-center gap-1">
                                  Exit Date
                                  {sortColumn === 'exitTime' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-right cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('entryPrice')}>
                                <div className="flex items-center justify-end gap-1">
                                  Entry
                                  {sortColumn === 'entryPrice' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-right cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('exitPrice')}>
                                <div className="flex items-center justify-end gap-1">
                                  Exit
                                  {sortColumn === 'exitPrice' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-right cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('stopPrice')}>
                                <div className="flex items-center justify-end gap-1">
                                  Stop
                                  {sortColumn === 'stopPrice' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-right cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('targetPrice')}>
                                <div className="flex items-center justify-end gap-1">
                                  Target
                                  {sortColumn === 'targetPrice' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-right cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('riskRewardRatio')}>
                                <div className="flex items-center justify-end gap-1">
                                  R:R
                                  {sortColumn === 'riskRewardRatio' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-right cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('pnlPercent')}>
                                <div className="flex items-center justify-end gap-1">
                                  P&L %
                                  {sortColumn === 'pnlPercent' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-right cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('rMultiple')}>
                                <div className="flex items-center justify-end gap-1">
                                  R-Mult
                                  {sortColumn === 'rMultiple' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-center cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('exitReason')}>
                                <div className="flex items-center justify-center gap-1">
                                  Exit Reason
                                  {sortColumn === 'exitReason' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                              <th className="p-3 text-center cursor-pointer hover:text-primary select-none" onClick={() => handleSortClick('outcome')}>
                                <div className="flex items-center justify-center gap-1">
                                  Status
                                  {sortColumn === 'outcome' && (sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                                </div>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortTrades(tradesData.trades).map((trade) => {
                              return (
                                <tr
                                  key={trade.tradeId || trade.alertId}
                                  onClick={() => navigateToTrade(trade)}
                                  className="border-t border-border hover:bg-elevated/50 cursor-pointer transition-colors"
                                  title="Click to view on chart"
                                >
                                  <td className="p-3 font-medium text-primary">
                                    {trade.symbol}
                                  </td>
                                  <td className="p-3">
                                    <span className={`px-2 py-1 rounded text-xs ${trade.zoneType === 'demand' ? 'bg-success/20 text-success' : 'bg-red-500/20 text-red-400'}`}>
                                      {trade.zoneType === 'demand' ? 'LONG' : 'SHORT'}
                                    </span>
                                  </td>
                                  <td className="p-3 text-secondary whitespace-nowrap">
                                    {trade.entryTime ? new Date(trade.entryTime).toLocaleDateString() : new Date(trade.alertedAt).toLocaleDateString()}
                                  </td>
                                  <td className="p-3 text-secondary whitespace-nowrap">
                                    {trade.exitTime ? new Date(trade.exitTime).toLocaleDateString() : (trade.retestDate ? new Date(trade.retestDate).toLocaleDateString() : '-')}
                                  </td>
                                  <td className="p-3 text-right text-primary">
                                    ${trade.entryPrice?.toFixed(2)}
                                  </td>
                                  <td className={`p-3 text-right ${
                                    trade.exitPrice && trade.entryPrice
                                      ? (trade.zoneType === 'demand'
                                          ? (trade.exitPrice > trade.entryPrice ? 'text-success' : 'text-red-400')
                                          : (trade.exitPrice < trade.entryPrice ? 'text-success' : 'text-red-400'))
                                      : 'text-secondary'
                                  }`}>
                                    {trade.exitPrice ? `$${trade.exitPrice.toFixed(2)}` : (trade.close5d ? `$${trade.close5d.toFixed(2)}` : '-')}
                                  </td>
                                  <td className="p-3 text-right text-red-400">${(trade.stopPrice || trade.stopLoss)?.toFixed(2)}</td>
                                  <td className="p-3 text-right text-accent">${trade.targetPrice?.toFixed(2)}</td>
                                  <td className="p-3 text-right text-secondary">
                                    {trade.riskRewardRatio ? trade.riskRewardRatio.toFixed(1) : '-'}
                                  </td>
                                  <td className={`p-3 text-right font-medium ${(trade.pnlPercent ?? trade.adjustedReturn ?? 0) >= 0 ? 'text-success' : 'text-red-500'}`}>
                                    {trade.pnlPercent !== null ? `${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%` : (trade.adjustedReturn !== null ? `${trade.adjustedReturn >= 0 ? '+' : ''}${trade.adjustedReturn.toFixed(2)}%` : '-')}
                                  </td>
                                  <td className={`p-3 text-right font-medium ${(trade.rMultiple ?? 0) >= 0 ? 'text-success' : 'text-red-500'}`}>
                                    {trade.rMultiple !== null ? `${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R` : '-'}
                                  </td>
                                  <td className="p-3 text-center text-xs text-secondary">
                                    {trade.exitReason || '-'}
                                  </td>
                                  <td className="p-3 text-center">
                                    <span className={`px-2 py-1 rounded text-xs ${
                                      trade.outcome === 'WIN' ? 'bg-success/20 text-success' :
                                      trade.outcome === 'LOSS' ? 'bg-red-500/20 text-red-400' :
                                      trade.outcome === 'BREAKEVEN' ? 'bg-blue-500/20 text-blue-400' :
                                      'bg-yellow-500/20 text-yellow-400'
                                    }`}>
                                      {trade.outcome || 'PENDING'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-secondary">No trade data available</div>
                  )}
                </div>
              </div>
            )}

            {/* STRATEGY TAB */}
            {activeTab === 'strategy' && (
              <div className="flex-1 p-4 overflow-auto">
                <div className="bg-panel border border-border rounded-lg">
                  <div className="bg-elevated p-4 border-b border-border">
                    <h2 className="text-lg font-bold text-primary">Strategy Overview</h2>
                    <p className="text-sm text-secondary">Supply/Demand zone statistics and Kelly parameters</p>
                  </div>
                  {tabLoading ? (
                    <div className="p-8 text-center text-secondary">Loading strategy data...</div>
                  ) : strategyData ? (
                    <>
                      {/* Summary Cards */}
                      <div className="p-4 grid grid-cols-4 gap-4 border-b border-border">
                        <div className="bg-success/10 border border-success/30 rounded-lg p-4">
                          <div className="text-xs text-secondary">Demand Zones</div>
                          <div className="text-2xl font-bold text-success">{strategyData.summary.totalDemandZones}</div>
                          <div className="text-xs text-success mt-1">{strategyData.summary.freshDemandZones} fresh</div>
                        </div>
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                          <div className="text-xs text-secondary">Supply Zones</div>
                          <div className="text-2xl font-bold text-red-400">{strategyData.summary.totalSupplyZones}</div>
                          <div className="text-xs text-red-400 mt-1">{strategyData.summary.freshSupplyZones} fresh</div>
                        </div>
                        <div className="bg-background rounded-lg p-4">
                          <div className="text-xs text-secondary">Demand Win Rate</div>
                          <div className="text-2xl font-bold text-success">{strategyData.summary.demandWinRate}%</div>
                          <div className="text-xs text-secondary mt-1">Kelly: {strategyData.summary.demandKelly}%</div>
                        </div>
                        <div className="bg-background rounded-lg p-4">
                          <div className="text-xs text-secondary">Supply Win Rate</div>
                          <div className="text-2xl font-bold text-red-400">{strategyData.summary.supplyWinRate}%</div>
                          <div className="text-xs text-secondary mt-1">Kelly: {strategyData.summary.supplyKelly}%</div>
                        </div>
                      </div>

                      {/* Kelly Parameters */}
                      <div className="p-4 border-b border-border">
                        <h3 className="text-sm font-bold text-primary mb-3">Kelly Position Sizing Parameters</h3>
                        <div className="grid grid-cols-2 gap-4">
                          {strategyData.kellyParams.demand && (
                            <div className="bg-success/10 border border-success/30 rounded-lg p-4">
                              <h4 className="text-sm font-bold text-success mb-2">Demand (Long)</h4>
                              <div className="grid grid-cols-4 gap-2 text-sm">
                                <div><div className="text-xs text-secondary">Trades</div><div className="font-bold">{strategyData.kellyParams.demand.numTrades}</div></div>
                                <div><div className="text-xs text-secondary">Win Rate</div><div className="font-bold">{strategyData.kellyParams.demand.winRate}%</div></div>
                                <div><div className="text-xs text-secondary">Avg Win R</div><div className="font-bold text-success">{strategyData.kellyParams.demand.avgWinR}R</div></div>
                                <div><div className="text-xs text-secondary">Half-Kelly</div><div className="font-bold text-accent">{strategyData.kellyParams.demand.halfKelly}%</div></div>
                              </div>
                            </div>
                          )}
                          {strategyData.kellyParams.supply && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                              <h4 className="text-sm font-bold text-red-400 mb-2">Supply (Short)</h4>
                              <div className="grid grid-cols-4 gap-2 text-sm">
                                <div><div className="text-xs text-secondary">Trades</div><div className="font-bold">{strategyData.kellyParams.supply.numTrades}</div></div>
                                <div><div className="text-xs text-secondary">Win Rate</div><div className="font-bold">{strategyData.kellyParams.supply.winRate}%</div></div>
                                <div><div className="text-xs text-secondary">Avg Win R</div><div className="font-bold text-success">{strategyData.kellyParams.supply.avgWinR}R</div></div>
                                <div><div className="text-xs text-secondary">Half-Kelly</div><div className="font-bold text-accent">{strategyData.kellyParams.supply.halfKelly}%</div></div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Supply/Demand Imbalance Table */}
                      <div className="p-4">
                        <h3 className="text-sm font-bold text-primary mb-3">Supply/Demand Imbalance by Symbol</h3>
                        <div className="overflow-auto max-h-[300px]">
                          <table className="w-full text-sm">
                            <thead className="bg-elevated sticky top-0">
                              <tr className="text-left text-secondary">
                                <th className="p-3">Symbol</th>
                                <th className="p-3">Demand Zones</th>
                                <th className="p-3">Supply Zones</th>
                                <th className="p-3">Imbalance</th>
                                <th className="p-3">Bias</th>
                              </tr>
                            </thead>
                            <tbody>
                              {strategyData.imbalance.map((item: any) => (
                                <tr key={item.symbol} className="border-t border-border hover:bg-elevated/50">
                                  <td className="p-3 font-medium text-primary">{item.symbol}</td>
                                  <td className="p-3 text-success">{item.demandZones}</td>
                                  <td className="p-3 text-red-400">{item.supplyZones}</td>
                                  <td className={`p-3 font-bold ${item.imbalance > 0 ? 'text-success' : item.imbalance < 0 ? 'text-red-500' : 'text-secondary'}`}>
                                    {item.imbalance > 0 ? '+' : ''}{item.imbalance}
                                  </td>
                                  <td className="p-3">
                                    <span className={`px-2 py-1 rounded text-xs ${
                                      item.bias === 'BULLISH' ? 'bg-success/20 text-success' :
                                      item.bias === 'BEARISH' ? 'bg-red-500/20 text-red-400' :
                                      'bg-gray-500/20 text-gray-400'
                                    }`}>
                                      {item.bias}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-secondary">No strategy data available</div>
                  )}
                </div>
              </div>
            )}

            {/* PORTFOLIO TAB */}
            {activeTab === 'portfolio' && (
              <div className="flex-1 p-4 overflow-auto">
                <div className="space-y-4">
                  {tabLoading ? (
                    <div className="bg-panel border border-border rounded-lg p-8 text-center text-secondary">
                      Loading portfolio data...
                    </div>
                  ) : portfolioData ? (
                    <>
                      {/* Performance Metrics */}
                      <div className="bg-panel border border-border rounded-lg">
                        <div className="bg-elevated p-4 border-b border-border">
                          <h3 className="text-lg font-bold text-primary">Performance Metrics</h3>
                          <p className="text-sm text-secondary">Overall trading performance</p>
                        </div>
                        <div className="p-4 grid grid-cols-3 gap-4">
                          <div className="bg-background rounded-lg p-4">
                            <div className="text-xs text-secondary mb-1">Total Return</div>
                            <div className={`text-2xl font-bold ${Number(portfolioData.performance.totalReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                              {Number(portfolioData.performance.totalReturn) >= 0 ? '+' : ''}{portfolioData.performance.totalReturn}
                            </div>
                          </div>
                          <div className="bg-background rounded-lg p-4">
                            <div className="text-xs text-secondary mb-1">Sharpe Ratio</div>
                            <div className="text-2xl font-bold text-primary">{portfolioData.performance.sharpeRatio}</div>
                          </div>
                          <div className="bg-background rounded-lg p-4">
                            <div className="text-xs text-secondary mb-1">Information Ratio</div>
                            <div className="text-2xl font-bold text-primary">{portfolioData.performance.informationRatio}</div>
                          </div>
                          <div className="bg-background rounded-lg p-4">
                            <div className="text-xs text-secondary mb-1">Max Drawdown</div>
                            <div className="text-2xl font-bold text-red-500">{portfolioData.performance.maxDrawdown}</div>
                          </div>
                          <div className="bg-background rounded-lg p-4">
                            <div className="text-xs text-secondary mb-1">Win Rate</div>
                            <div className="text-2xl font-bold text-success">{portfolioData.performance.winRate}</div>
                          </div>
                          <div className="bg-background rounded-lg p-4">
                            <div className="text-xs text-secondary mb-1">Avg Return</div>
                            <div className={`text-2xl font-bold ${Number(portfolioData.performance.avgReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                              {Number(portfolioData.performance.avgReturn) >= 0 ? '+' : ''}{portfolioData.performance.avgReturn}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* By Zone Type */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-panel border border-border rounded-lg">
                          <div className="bg-elevated p-4 border-b border-border">
                            <h4 className="font-bold text-success">Demand Zones Performance</h4>
                          </div>
                          <div className="p-4 space-y-3">
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Total Trades</span>
                              <span className="text-sm font-medium text-primary">{portfolioData.byZoneType.demand.trades}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Wins</span>
                              <span className="text-sm font-medium text-success">{portfolioData.byZoneType.demand.wins}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Win Rate</span>
                              <span className="text-sm font-bold text-success">{portfolioData.byZoneType.demand.winRate}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Total Return</span>
                              <span className={`text-sm font-bold ${Number(portfolioData.byZoneType.demand.totalReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                                {Number(portfolioData.byZoneType.demand.totalReturn) >= 0 ? '+' : ''}{portfolioData.byZoneType.demand.totalReturn}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Avg Return</span>
                              <span className={`text-sm font-medium ${Number(portfolioData.byZoneType.demand.avgReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                                {Number(portfolioData.byZoneType.demand.avgReturn) >= 0 ? '+' : ''}{portfolioData.byZoneType.demand.avgReturn}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="bg-panel border border-border rounded-lg">
                          <div className="bg-elevated p-4 border-b border-border">
                            <h4 className="font-bold text-red-500">Supply Zones Performance</h4>
                          </div>
                          <div className="p-4 space-y-3">
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Total Trades</span>
                              <span className="text-sm font-medium text-primary">{portfolioData.byZoneType.supply.trades}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Wins</span>
                              <span className="text-sm font-medium text-success">{portfolioData.byZoneType.supply.wins}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Win Rate</span>
                              <span className="text-sm font-bold text-success">{portfolioData.byZoneType.supply.winRate}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Total Return</span>
                              <span className={`text-sm font-bold ${Number(portfolioData.byZoneType.supply.totalReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                                {Number(portfolioData.byZoneType.supply.totalReturn) >= 0 ? '+' : ''}{portfolioData.byZoneType.supply.totalReturn}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-secondary">Avg Return</span>
                              <span className={`text-sm font-medium ${Number(portfolioData.byZoneType.supply.avgReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                                {Number(portfolioData.byZoneType.supply.avgReturn) >= 0 ? '+' : ''}{portfolioData.byZoneType.supply.avgReturn}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Equity Curve Placeholder */}
                      <div className="bg-panel border border-border rounded-lg">
                        <div className="bg-elevated p-4 border-b border-border">
                          <h4 className="font-bold text-primary">Equity Curve</h4>
                          <p className="text-sm text-secondary">Cumulative returns over time</p>
                        </div>
                        <div className="p-8 text-center text-secondary">
                          <LineChart className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">Chart visualization coming soon</p>
                          <p className="text-xs mt-1">{portfolioData.equityCurve.length} data points available</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-panel border border-border rounded-lg p-8 text-center text-secondary">
                      No portfolio data available
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ALERTS TAB */}
            {activeTab === 'alerts' && (
              <div className="flex-1 p-4 overflow-auto">
                <div className="bg-panel border border-border rounded-lg">
                  <div className="bg-elevated p-4 border-b border-border">
                    <h2 className="text-lg font-bold text-primary">Alerts</h2>
                    <p className="text-sm text-secondary">Real-time crypto zone alerts</p>
                  </div>
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Bell className="h-8 w-8 text-accent" />
                    </div>
                    <h3 className="text-xl font-bold mb-2 text-primary">Alerts Coming Soon</h3>
                    <p className="text-secondary max-w-md mx-auto">
                      Get notified when price enters supply/demand zones. Real-time Discord and email alerts.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* BACKTEST TAB - Coming in next edit due to size */}
            {activeTab === 'backtest' && (
              <div className="flex-1 p-4 overflow-auto">
                <div className="bg-panel border border-border rounded-lg">
                  <div className="bg-elevated p-4 border-b border-border">
                    <h2 className="text-lg font-bold text-primary">Backtest</h2>
                    <p className="text-sm text-secondary">Test crypto zone strategy performance</p>
                  </div>
                  <div className="p-12 text-center">
                    <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Activity className="h-8 w-8 text-accent" />
                    </div>
                    <h3 className="text-xl font-bold mb-2 text-primary">Backtest Coming Soon</h3>
                    <p className="text-secondary max-w-md mx-auto">
                      Historical simulation of crypto zone trading strategy with Kelly position sizing.
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Right: AI Chat Panel */}
          {chatOpen && (
            <div className="w-80 bg-panel border-l border-border flex flex-col relative">
              {/* Chat Header */}
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-accent to-accent-dark rounded flex items-center justify-center">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-primary">AI Assistant</div>
                    <div className="text-xs text-success flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-success"></div>
                      Online
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setChatOpen(false)}
                  className="p-1 hover:bg-elevated rounded transition-colors"
                >
                  <X className="h-4 w-4 text-secondary" />
                </button>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 relative">
                {/* Sample messages */}
                <div className="flex gap-2">
                  <div className="w-6 h-6 bg-accent/20 rounded flex items-center justify-center flex-shrink-0">
                    <Bot className="h-3 w-3 text-accent" />
                  </div>
                  <div className="bg-elevated rounded-lg p-3 text-sm text-primary max-w-[85%]">
                    Hey! I'm your crypto trading assistant. What would you like to know about today's market?
                  </div>
                </div>

                {isLocked && (
                  <>
                    {/* Lock Overlay */}
                    <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center p-6">
                      <div className="text-center">
                        <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-3">
                          <Lock className="h-6 w-6 text-accent" />
                        </div>
                        <h4 className="text-lg font-bold mb-2 text-primary">AI Chat Locked</h4>
                        <p className="text-sm text-secondary mb-4">
                          Upgrade to Pro to chat with our AI assistant about crypto markets
                        </p>
                        <Link
                          href="/#pricing"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-all"
                        >
                          <Crown className="h-4 w-4" />
                          Upgrade Now
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-4 border-t border-border">
                <div className={`flex gap-2 ${isLocked ? 'opacity-40 pointer-events-none' : ''}`}>
                  <input
                    type="text"
                    placeholder={isLocked ? "Upgrade to chat..." : "Ask about crypto..."}
                    disabled={isLocked}
                    className="flex-1 bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    disabled={isLocked}
                    className="p-2 bg-accent hover:bg-accent-dark text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Chat Toggle (when closed) */}
          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              className="fixed right-4 bottom-4 w-12 h-12 bg-accent hover:bg-accent-dark text-white rounded-full shadow-lg flex items-center justify-center transition-all"
            >
              <MessageSquare className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
