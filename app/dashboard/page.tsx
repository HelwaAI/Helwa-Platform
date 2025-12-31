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
      // console.log(`Snapping: raw price ${rawPrice.toFixed(2)} -> ${snappedPrice.toFixed(2)} (${distToHigh < distToLow ? 'high' : 'low'})`);

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
// testing commit
// ============================================================================
// Trade Marker Primitive - Visual indicators for trade entry/exit
// ============================================================================

interface TradeMarkerOptions {
  entryTime: Time;
  entryPrice: number;
  exitTime?: Time;
  exitPrice?: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'PENDING' | null;
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
// Component Interfaces
// ============================================================================

interface UserInfo {
  name: string;
  email: string;
  role: "free" | "paid" | "admin";
}

interface StockAggregate {
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

export default function DashboardPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [user, setUser] = useState<UserInfo>({ name: "User", email: "user-admin@helwa.ai", role: "admin" });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<DashboardTab>('charts');
  const [tradesData, setTradesData] = useState<{ trades: Trade[]; summary: any } | null>(null);
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [strategyData, setStrategyData] = useState<StrategyData | null>(null);
  const [tabLoading, setTabLoading] = useState(false);
  const [stockData, setStockData] = useState<StockAggregate | null>(null);
  const [zonesData, setZonesData] = useState<any>(null);
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
  // Volume Profile Time State - default 09:30 ET for market open (14:30 UTC)
  const [volumeProfileStartTime, setVolumeProfileStartTime] = useState("09:30");
  const [volumeProfileEndTime, setVolumeProfileEndTime] = useState("16:00");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const drawingToolbarRef = useRef<HTMLDivElement>(null);
  const drawingToolRef = useRef<RectangleDrawingTool | null>(null);
  const zonePrimitivesRef = useRef<ZonePrimitive[]>([]);
  const volumeProfilePrimitiveRef = useRef<VolumeProfilePrimitive | null>(null);
  const tradeMarkerPrimitiveRef = useRef<TradeMarkerPrimitive | null>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const pendingZoneSnapRef = useRef<string | null>(null);
  const pendingRetestTimeRef = useRef<string | null>(null); // Store visual_retest_time for snapping
  const snapTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Store snap timeout ID to cancel if needed
  const lastSnappedZoneRef = useRef<string | null>(null); // Track last snapped zone to prevent duplicate snaps
  const [timeframe, setTimeframe] = useState("2m");
  const [limit, setLimit] = useState(5850);
  const [hours, setHours] = useState(720);
  const [zoneSearchQuery, setZoneSearchQuery] = useState("");
  const [zoneRetestIdSearchQuery, setZoneRetestIdSearchQuery] = useState("");
  const [selectedTimeframeKey, setSelectedTimeframeKey] = useState("2min");
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

  // console.log("Timeframe: ", timeframe);
  // console.log("Limit: ", limit);
  // console.log("Hours: ", hours);
  // console.log("Stock Trade Data: ", tradesData)
  // console.log("Stock Strategy Data: ", strategyData)

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
          await fetchStockDataWithZoneID(zoneId);

          // Step 2: Set pending zone to snap to
          pendingZoneSnapRef.current = zoneId;
          // console.log(`Auto-triggered zone search for ${zoneId}`);

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
      fetchStockData(searchQuery);
    }
  }, [timeframe, limit, hours]);

  // Effect to fetch volume profile when enabled and symbol changes
  useEffect(() => {
    if (showVolumeProfile && searchQuery.trim()) {
      fetchVolumeProfile(searchQuery, volumeProfileNumBins);
    }
  }, [showVolumeProfile, searchQuery, volumeProfileNumBins, timeframe, volumeProfileStartDate, volumeProfileEndDate, volumeProfileStartTime, volumeProfileEndTime]);

  // Effect to fetch tab data when tab changes
  useEffect(() => {
    if (activeTab === 'trades' && !tradesData) {
      fetchTradesData();
    } else if (activeTab === 'portfolio' && !portfolioData) {
      fetchPortfolioData();
    } else if (activeTab === 'strategy' && !strategyData) {
      fetchStrategyData();
    } else if (activeTab === 'backtest' && backtestSymbols.length === 0) {
      fetchBacktestSymbols();
    }
  }, [activeTab]);

  // Effect to fetch trades when showTradesOnChart is enabled
  useEffect(() => {
    if (showTradesOnChart && !tradesData) {
      fetchTradesData();
    }
  }, [showTradesOnChart]);

  // Fetch trades data
  const fetchTradesData = async () => {
    try {
      setTabLoading(true);
      const response = await fetch('/api/stocks/trades');
      const data = await response.json();
      if (data.success) {
        setTradesData(data.data);
      }
    } catch (err) {
      console.error('Error fetching trades:', err);
    } finally {
      setTabLoading(false);
    }
  };

  // Fetch portfolio data
  const fetchPortfolioData = async () => {
    try {
      setTabLoading(true);
      const response = await fetch('/api/stocks/portfolio');
      const data = await response.json();
      if (data.success) {
        setPortfolioData(data.data);
      }
    } catch (err) {
      console.error('Error fetching portfolio:', err);
    } finally {
      setTabLoading(false);
    }
  };

  // Fetch strategy data
  const fetchStrategyData = async () => {
    try {
      setTabLoading(true);
      const response = await fetch('/api/stocks/strategy');
      const data = await response.json();
      if (data.success) {
        setStrategyData(data.data);
      }
    } catch (err) {
      console.error('Error fetching strategy:', err);
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
    // console.log('Navigating to trade:', trade);

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

    // Use the fetchStockDataWithZoneID function
    await fetchStockDataWithZoneID(trade.zoneId.toString());
  };

  // Fetch backtest symbols
  const fetchBacktestSymbols = async () => {
    try {
      const response = await fetch('/api/stocks/backtest?action=symbols');
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
      const response = await fetch(`/api/stocks/backtest?action=date-range&symbol=${symbol}`);
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

      const response = await fetch('/api/stocks/backtest', {
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

  // Fetch stock data based on symbol
  const fetchStockData = async (
    symbol: string,
    customTimeframe?: string,
    customLimit?: number,
    customHours?: number
  ) => {
    if (!symbol.trim()) {
      setStockData(null);
      setZonesData(null);
      setVolumeProfileData(null);
      setError(null);
      return;
    }

    // Use custom values if provided, otherwise use state
    const tf = customTimeframe ?? timeframe;
    const lim = customLimit ?? limit;
    const hrs = customHours ?? hours;

    try {
      setFetching(true);
      setError(null);

      // Fetch aggregates data - use all=true to get all available candles from first available
      const aggregatesResponse = await fetch(`/api/stocks/aggregates?symbols=${symbol.toUpperCase()}&limit=${lim}&timeframe=${tf}&hours=${hrs}&all=true`);
      const aggregatesData = await aggregatesResponse.json();

      // Fetch zones data
      const zonesResponse = await fetch(`/api/stocks/zones?symbols=${symbol.toUpperCase()}&timeframe=${tf}`);
      const zonesDataResponse = await zonesResponse.json();

      // Fetch volume_profile
      const volumeProfileResponse = await fetch(`/api/stocks/volumeprofile?symbol=${symbol.toUpperCase()}&timeframe=${tf}`);
      const volumeProfileDataResponse = await volumeProfileResponse.json();

      // Fetch entry/target/stoploss data (may not exist for all symbols)
      try {
        const entryTargetResponse = await fetch(`/api/stocks/entrytargetstoploss?symbol=${symbol.toUpperCase()}`);
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
        setStockData(aggregatesData.data[0]);
        console.log("Stock Data: ", aggregatesData.data[0])

        // Set zones data if available
        if (zonesDataResponse.success && zonesDataResponse.data.length > 0) {
          console.log("ZONES DATA: ", zonesDataResponse.data[0]);
          setZonesData(zonesDataResponse.data[0]);
        } else {
          setZonesData(null);
        }

        // Set volume profile data if available
        if (volumeProfileDataResponse.success && volumeProfileDataResponse.data) {
          console.log("VOLUME PROFILE DATA: ", volumeProfileDataResponse.data);
          setVolumeProfileData(volumeProfileDataResponse.data);
        } else {
          setVolumeProfileData(null);
        }
      } else {
        setError(`No data found for ${symbol}`);
        setStockData(null);
        setZonesData(null);
        setVolumeProfileData(null);
      }
    } catch (err: any) {
      setError(`Error fetching data: ${err.message}`);
      setStockData(null);
      setZonesData(null);
      setVolumeProfileData(null);
    } finally {
      setFetching(false);
    }
  };

  // fetch stock data based on zone_id
  const fetchStockDataWithZoneID = async (zoneId: string) => {
    if (!zoneId.trim()) {
      setStockData(null);
      setZonesData(null);
      setVolumeProfileData(null);
      setError(null);
      return;
    }

    try {
      setFetching(true);
      setError(null);

      // Step 1: Fetch zone search data to get symbol and timeframe
      const zoneSearchResponse = await fetch(`/api/stocks/searchzoneid?zone_id=${zoneId}`);
      const zoneSearchData = await zoneSearchResponse.json();
      // console.log("ZONE SEARCH TEST: ", zoneSearchData);

      if (!zoneSearchData.success) {
        setError(zoneSearchData.error || `Zone ${zoneId} not found`);
        setStockData(null);
        setZonesData(null);
        setVolumeProfileData(null);
        setFetching(false);
        return;
      }

      const { symbol, timeframe: timeframeLabel } = zoneSearchData.data;
      // console.log(`Zone ${zoneId} found: Symbol=${symbol}, Timeframe=${timeframeLabel}`);

      // Step 2: Get limit and hours from timeframe using the same maps as handleTimeframeChange
      const timeframeMap: Record<string, string> = {
        "2min": "2m", "3min": "3m", "5min": "5m", "6min": "6m", "10min": "10m",
        "13min": "13m", "15min": "15m", "26min": "26m", "30min": "30m", "39min": "39m",
        "65min": "65m", "78min": "78m", "130min": "130m", "195min": "195m",
        "daily": "1d", "5d": "5d", "22d": "22d", "65d": "65d",
      };
      // Unlimited lookback - fetch all available data from database
      const limitMap: Record<string, number> = {
        "2min": 1000000, "3min": 750000, "5min": 500000, "6min": 400000, "10min": 250000,
        "13min": 200000, "15min": 175000, "26min": 100000, "30min": 90000, "39min": 70000,
        "65min": 50000, "78min": 40000, "130min": 25000, "195min": 17000,
        "daily": 10000, "5d": 2000, "22d": 500, "65d": 200,
      };
      const hoursMap: Record<string, number> = {
        "2min": 720, "3min": 720, "5min": 720, "6min": 1440, "10min": 1080,
        "13min": 1440, "15min": 1440, "26min": 2160, "30min": 2160, "39min": 4320,
        "65min": 4320, "78min": 4320, "130min": 43800, "195min": 43800,
        "daily": 219000, "5d": 219000, "22d": 219000, "65d": 219000,
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
        setStockData(null);
        setZonesData(null);
        setVolumeProfileData(null);
        setFetching(false);
        return;
      }

      const newLimit = limitMap[timeframeKey] || 5850;
      const newHours = hoursMap[timeframeKey] || 720;

      // Step 3: Update UI state - symbol search bar, timeframe dropdown, limit, and hours
      setSearchQuery(symbol);
      setSelectedTimeframeKey(timeframeKey); // Update dropdown selection
      setTimeframe(timeframeValue);
      setLimit(newLimit);
      setHours(newHours);

      // console.log(`Updated UI: symbol=${symbol}, timeframe=${timeframeValue}, limit=${newLimit}, hours=${newHours}`);

      // Step 4: Call the existing fetchStockData function with the new values
      // Pass the values directly since state updates are async
      await fetchStockData(symbol, timeframeValue, newLimit, newHours);

    } catch (err: any) {
      setError(`Error fetching data: ${err.message}`);
      setStockData(null);
      setZonesData(null);
      setVolumeProfileData(null);
      setFetching(false);
    }
  };

  // Handle search when Enter key is pressed
  const handleSearchKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (searchQuery.trim()) {
        fetchStockData(searchQuery);
      } else {
        setStockData(null);
        setError(null);
      }
    }
  };

  // Fetch volume profile data independently
  const fetchVolumeProfile = async (symbol: string, numBins: number = 50) => {
    if (!symbol.trim()) {
      setVolumeProfileData(null);
      return;
    }

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

      // console.log(`[VP] Time inputs: start=${volumeProfileStartTime} (${startHours}:${startMinutes}), end=${volumeProfileEndTime} (${endHours}:${endMinutes})`);

      // Set times from the time inputs (these are interpreted as ET times for stocks)
      startDate.setHours(startHours, startMinutes, 0, 0);
      endDate.setHours(endHours, endMinutes, 59, 999);

      console.log(`[VP] Fetching volume profile: ${startDate.toISOString()} to ${endDate.toISOString()}`);

      const response = await fetch(
        `/api/stocks/volumeprofile?symbol=${symbol.toUpperCase()}&num_bins=${numBins}&timeframe=${timeframe}&start_date=${startDate.toISOString()}&end_date=${endDate.toISOString()}`
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

  // Handle search input change (just update state)
  const handleInputChange = (value: string) => {
    setSearchQuery(value);
  };

  // Handle timeframe change
  const handleTimeframeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = e.target.value;
    const timeframeMap: Record<string, string> = {
      "2min": "2m",
      "3min": "3m",
      "5min": "5m",
      "6min": "6m",
      "10min": "10m",
      "13min": "13m",
      "15min": "15m",
      "26min": "26m",
      "30min": "30m",
      "39min": "39m",
      "65min": "65m",
      "78min": "78m",
      "130min": "130m",
      "195min": "195m",
      "daily": "1d",
      "5d": "5d",
      "22d": "22d",
      "65d": "65d",

    };
    // Unlimited lookback - fetch all available data from database
    const limitMap: Record<string, number> = {
      "2min": 1000000,
      "3min": 750000,
      "5min": 500000,
      "6min": 400000,
      "10min": 250000,
      "13min": 200000,
      "15min": 175000,
      "26min": 100000,
      "30min": 90000,
      "39min": 70000,
      "65min": 50000,
      "78min": 40000,
      "130min": 25000,
      "195min": 17000,
      "daily": 10000,
      "5d": 2000,
      "22d": 500,
      "65d": 200,
    };
    const hoursMap: Record<string, number> = {
      "2min": 720,  
      "3min": 720,
      "5min": 720,
      "6min": 1440, // 5760
      "10min": 1080,
      "13min": 1440,
      "15min": 1440,
      "26min": 2160,
      "30min": 2160,
      "39min": 4320,
      "65min": 4320,     // ~5 years for longer minute timeframes
      "78min": 4320,     // ~5 years
      "130min": 43800,    // ~5 years
      "195min": 43800,    // ~5 years
      "daily": 219000,    // ~25 years for day-based timeframes
      "5d": 219000,       // ~25 years
      "22d": 219000,      // ~25 years
      "65d": 219000,      // ~25 years
    };
    setSelectedTimeframeKey(selected);
    setTimeframe(timeframeMap[selected] || selected);
    setLimit(limitMap[selected] || 5850);
    setHours(hoursMap[selected] || 720);
  };

  // Handle zone ID search - fetch data globally and snap to zone
  const handleZoneIdSearch = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const zoneId = zoneSearchQuery.trim();
      if (!zoneId) {
        return;
      }

      // Step 1: Set pending zone to snap to BEFORE fetching
      // This ensures the ref is ready when useEffect runs
      pendingZoneSnapRef.current = zoneId;
      lastSnappedZoneRef.current = null; // Clear previous snap to allow new snap
      // console.log(`Set pending zone snap to ${zoneId}`);

      // Step 2: Fetch all data for this zone (symbol, timeframe, aggregates, zones)
      // The useEffect watching zonesData will handle the actual snapping
      await fetchStockDataWithZoneID(zoneId);

      // Clear the search query
      setZoneSearchQuery('');
    }
  };

  // Handle zone retest ID search - fetch zone_id from retest ID and auto-trigger zone search
  const handleZoneRetestIdSearch = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    console.log('handleZoneRetestIdSearch called, key:', e.key);
    if (e.key === 'Enter') {
      const retestId = zoneRetestIdSearchQuery.trim();
      console.log('Retest ID entered:', retestId);
      if (!retestId) {
        return;
      }

      try {
        // Call the searchZoneFirstRetestId API
        const response = await fetch(`/api/stocks/searchZoneFirstRetestId?ZoneFirstRetestId=${retestId}`);
        const result = await response.json();
        console.log('API response:', result);

        if (result.success && result.data?.zone_id) {
          const zoneId = result.data.zone_id;
          const visual_retest_time = result.data.visual_retest_time;
          console.log("Retest: ", visual_retest_time);
          console.log("Zone ID: ", zoneId);
          // Set pending refs BEFORE fetching so they're ready when useEffect runs
          pendingZoneSnapRef.current = zoneId;
          pendingRetestTimeRef.current = visual_retest_time; // Store retest time for snapping
          lastSnappedZoneRef.current = null; // Clear previous snap to allow new snap
          // Automatically trigger zone search with the fetched zone_id
          await fetchStockDataWithZoneID(zoneId);
        } else {
          console.error('Failed to fetch zone_id:', result.error);
        }
      } catch (error) {
        console.error('Error fetching zone retest ID:', error);
      }

      // Clear the search query
      setZoneRetestIdSearchQuery('');
    }
  };

  // Initialize candlestick chart when stockData changes
  useEffect(() => {
    if (!stockData || !chartContainerRef.current) return;

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

      // Convert bars data to candlestick format
      const candleData = stockData.bars
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

      if (candleData.length === 0) {
        console.error('No valid candle data to render');
        return;
      }

      // Set data on the series
      candlestickSeries.setData(candleData as any);

      // Initialize hoveredCandle with the last bar's data
      if (stockData?.bars && stockData.bars.length > 0) {
        const lastBar = stockData.bars[stockData.bars.length - 1];
        const high = Number(lastBar.high);
        const low = Number(lastBar.low);
        const open = Number(lastBar.open);
        const close = Number(lastBar.close);
        const volume = Number(lastBar.volume);
        const vwap = (high + low + close) / 3;
        const dollarVolume = volume * vwap;
        setHoveredCandle({
          high,
          low,
          open,
          close,
          volume,
          dollarVolume
        });
      }

      // Fit content to view (skip if we have a pending snap OR just snapped to a zone)
      if (!pendingZoneSnapRef.current && !pendingRetestTimeRef.current && !lastSnappedZoneRef.current) {
        chart.timeScale().fitContent();
      }

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

            // Use end_time from API if available, otherwise calculate based on break detection
            const lastCandle = candleData[candleData.length - 1];
            let zoneEndTime: number;
            let isBroken = false;

            // If zone.broken_at is provided by API, use it as the zone end time
            if (zone.visual_broken_time) {
              zoneEndTime = Math.floor(new Date(zone.visual_broken_time).getTime() / 1000);
              isBroken = true;
            } else {
              // Fallback: determine zone end time by checking for breaks in candle data
              // Default to last candle or 24h after start
              zoneEndTime = lastCandle ? lastCandle.time : zoneStartTime + 86400;

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

            // Attach primitive to the series
            candlestickSeries.attachPrimitive(zonePrimitive);
            zonePrimitivesRef.current.push(zonePrimitive);

            // console.log(`Zone ${zone.zone_id} attached as primitive:`, {
            //   type: zone.zone_type,
            //   isBroken,
            //   startTime: new Date(zoneStartTime * 1000).toISOString(),
            //   endTime: new Date(zoneEndTime! * 1000).toISOString(),
            //   topPrice,
            //   bottomPrice,
            //   usedApiEndTime: !!zone.end_time,
            //   apiEndTime: zone.end_time || 'N/A',
            //   duration: `${((zoneEndTime - zoneStartTime) / 60).toFixed(0)} minutes`
            // });
          } catch (err) {
            console.error(`Error creating zone primitive:`, err);
          }
        });
      }

      // Add volume profile primitive if enabled and data is available
      if (showVolumeProfile && volumeProfileData && volumeProfileData.nodes && volumeProfileData.nodes.length > 0) {
        const volumeProfilePrimitive = new VolumeProfilePrimitive(
          volumeProfileData.nodes,
          volumeProfileData.price_range,
          true, // showPOC
          true, // showHVN
          true  // showLVN
        );
        candlestickSeries.attachPrimitive(volumeProfilePrimitive);
        volumeProfilePrimitiveRef.current = volumeProfilePrimitive;
        // console.log(`Volume profile attached with ${volumeProfileData.nodes.length} nodes`);
      }

      // Add crosshair move handler for zone tooltips and candle stats
      chart.subscribeCrosshairMove((param) => {
        // Update hovered candle data for stats display
        if (param.time && param.seriesData) {
          const candleData = param.seriesData.get(candlestickSeries) as { open: number; high: number; low: number; close: number } | undefined;
          if (candleData) {
            // Find the matching bar from stockData to get volume
            const timeValue = typeof param.time === 'number' ? param.time : Math.floor(new Date(param.time as string).getTime() / 1000);
            const matchingBar = stockData?.bars?.find(bar => {
              const barTime = Math.floor(new Date(bar.bucket).getTime() / 1000);
              return barTime === timeValue;
            });
            const volume = matchingBar?.volume || 0;
            // Calculate dollar volume as volume * VWAP (approximated as (high + low + close) / 3)
            const vwap = (candleData.high + candleData.low + candleData.close) / 3;
            const dollarVolume = volume * vwap;

            setHoveredCandle({
              high: candleData.high,
              low: candleData.low,
              open: candleData.open,
              close: candleData.close,
              volume: volume,
              dollarVolume: dollarVolume
            });
          }
        } else {
          // When cursor leaves chart, show the last available candle's data
          if (stockData?.bars && stockData.bars.length > 0) {
            const lastBar = stockData.bars[stockData.bars.length - 1];
            const high = Number(lastBar.high);
            const low = Number(lastBar.low);
            const open = Number(lastBar.open);
            const close = Number(lastBar.close);
            const volume = Number(lastBar.volume);
            const vwap = (high + low + close) / 3;
            const dollarVolume = volume * vwap;
            setHoveredCandle({
              high,
              low,
              open,
              close,
              volume,
              dollarVolume: dollarVolume
            });
          }
        }

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

          // Verify zone has valid coordinates before showing tooltip
          // Only show tooltip if the zone is actually rendered on the chart
          const startCoordinate = chart.timeScale().timeToCoordinate(zoneStartTime as Time);
          const endCoordinate = chart.timeScale().timeToCoordinate(zoneEndTime as Time);

          // Skip zones that can't be rendered (times outside chart data range)
          if (startCoordinate === null || endCoordinate === null) {
            continue;
          }

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
      console.log('[SNAP] Checking snap condition - pendingZone:', pendingZoneSnapRef.current, 'hasZonesData:', !!zonesData, 'hasZones:', !!zonesData?.zones);
      if (pendingZoneSnapRef.current && zonesData && zonesData.zones) {
        const zoneId = pendingZoneSnapRef.current;

        // Skip if we already snapped to this zone (prevents duplicate snaps from double useEffect runs)
        if (lastSnappedZoneRef.current === zoneId) {
          console.log('[SNAP] Already snapped to zone', zoneId, '- skipping duplicate snap');
          return;
        }

        console.log('[SNAP] Attempting snap to zone:', zoneId, 'Has retest ref:', !!pendingRetestTimeRef.current, 'Retest time:', pendingRetestTimeRef.current);
        const targetZone = zonesData.zones.find((z: any) => z.zone_id.toString() === zoneId);

        if (targetZone) {
          console.log('[SNAP] Target zone found:', targetZone.zone_id);

          // Mark this zone as snapped
          lastSnappedZoneRef.current = zoneId;

          // Cancel any existing snap timeout to prevent double-snapping
          if (snapTimeoutRef.current) {
            console.log('[SNAP] Canceling previous snap timeout');
            clearTimeout(snapTimeoutRef.current);
            snapTimeoutRef.current = null;
          }

          // Small delay to ensure zones are fully rendered
          snapTimeoutRef.current = setTimeout(() => {
            try {
              // Use chartInstanceRef to ensure we're operating on the current chart
              // (not a stale chart if useEffect ran multiple times)
              if (!chartInstanceRef.current) {
                console.warn('[SNAP] Chart instance not available');
                return;
              }

              // Different zoom behavior for retest vs zone snapping
              if (pendingRetestTimeRef.current) {
                // RETEST SCENARIO: Zoom in tight to the retest candle (testing)
                const retestTime = Math.floor(new Date(pendingRetestTimeRef.current).getTime() / 1000);
                const tightWindow = 900; // 15 minutes on each side (30 min total window)
                console.log('[SNAP] Executing RETEST snap - retestTime:', retestTime, 'from:', retestTime - tightWindow, 'to:', retestTime + tightWindow);

                chartInstanceRef.current.timeScale().setVisibleRange({
                  from: (retestTime - tightWindow) as Time,
                  to: (retestTime + tightWindow) as Time,
                });
                console.log('[SNAP] RETEST snap completed');
              } else {
                // ZONE SCENARIO: Show full zone duration with proportional padding
                const zoneStartTime = Math.floor(new Date(targetZone.start_time).getTime() / 1000);

                // Calculate zone end time using the same logic as zone rendering
                const candleData = stockData.bars.map((bar) => ({
                  time: Math.floor(new Date(bar.bucket).getTime() / 1000),
                  open: Number(bar.open),
                  high: Number(bar.high),
                  low: Number(bar.low),
                  close: Number(bar.close),
                }));

                const lastCandle = candleData[candleData.length - 1];
                let zoneEndTime: number;

                // Check if zone has visual_broken_time from API
                if (targetZone.visual_broken_time) {
                  zoneEndTime = Math.floor(new Date(targetZone.visual_broken_time).getTime() / 1000);
                } else {
                  // Default to last candle or 24h after start
                  zoneEndTime = lastCandle ? lastCandle.time : zoneStartTime + 86400;

                  // Check candles for zone break
                  const isDemand = targetZone.zone_type.toLowerCase() === 'demand';
                  const topPrice = parseFloat(targetZone.top_price);
                  const bottomPrice = parseFloat(targetZone.bottom_price);
                  const candlesAfterZone = candleData.filter(c => c.time >= zoneStartTime);

                  for (const candle of candlesAfterZone) {
                    if (isDemand) {
                      // Demand zone broken if ANY OHLC is below bottom price
                      if (candle.open < bottomPrice || candle.high < bottomPrice ||
                        candle.low < bottomPrice || candle.close < bottomPrice) {
                        zoneEndTime = candle.time;
                        break;
                      }
                    } else {
                      // Supply zone broken if ANY OHLC is above top price
                      if (candle.open > topPrice || candle.high > topPrice ||
                        candle.low > topPrice || candle.close > topPrice) {
                        zoneEndTime = candle.time;
                        break;
                      }
                    }
                  }
                }

                // Calculate zone duration and add proportional padding
                const zoneDuration = zoneEndTime - zoneStartTime;
                const paddingRatio = 0.2; // 20% padding on each side
                const padding = Math.max(zoneDuration * paddingRatio, 3600); // Minimum 1 hour padding
                const maxPadding = 86400 * 3; // Maximum 3 days padding
                const finalPadding = Math.min(padding, maxPadding);

                chartInstanceRef.current.timeScale().setVisibleRange({
                  from: (zoneStartTime - finalPadding) as Time,
                  to: (zoneEndTime + finalPadding) as Time,
                });
              }

              // console.log(`Successfully snapped to ${pendingRetestTimeRef.current ? 'retest time' : 'zone'} ${zoneId}`);

              // Create trade markers if we navigated from Trade History
              if (pendingTradeRef.current) {
                const trade = pendingTradeRef.current;
                // console.log('Creating trade markers for:', trade);

                // Calculate entry time - use alertTime or retestDate
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
                // console.log('Trade marker attached');

                // Clear the pending trade
                pendingTradeRef.current = null;
              }

              // Clear the pending snap
              pendingZoneSnapRef.current = null;
              pendingRetestTimeRef.current = null;
              snapTimeoutRef.current = null;

              // Render all trades for the current symbol if showTradesOnChart is enabled
              if (showTradesOnChart && tradesData && stockData) {
                const currentSymbol = stockData.symbol;
                const symbolTrades = tradesData.trades.filter(t => t.symbol === currentSymbol);

                // console.log(`Rendering ${symbolTrades.length} trade markers for ${currentSymbol}`);

                symbolTrades.forEach(trade => {
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
            } catch (err) {
              console.error('Error snapping to zone:', err);
              pendingZoneSnapRef.current = null;
              pendingRetestTimeRef.current = null;
              pendingTradeRef.current = null;
              snapTimeoutRef.current = null;
            }
          }, 50); // Reduced delay to minimize race condition with double useEffect runs
        } else {
          console.warn(`Zone ${zoneId} not found in zones data`);
          pendingZoneSnapRef.current = null;
          pendingRetestTimeRef.current = null;
          pendingTradeRef.current = null;
        }
      }

      // Render all trades for the current symbol if showTradesOnChart is enabled
      // This runs even when not snapping to a specific zone
      if (showTradesOnChart && tradesData && stockData && !pendingZoneSnapRef.current) {
        const currentSymbol = stockData.symbol;
        const symbolTrades = tradesData.trades.filter((t: any) => t.symbol === currentSymbol);

        // console.log(`Rendering ${symbolTrades.length} trade markers for ${currentSymbol} (toggle mode)`);

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

        chart.remove();
        chartInstanceRef.current = null;
      };
    } catch (err) {
      console.error('Error initializing chart:', err);
    }
  }, [stockData, zonesData, showVolumeProfile, volumeProfileData, showTradesOnChart, tradesData]);

  const isLocked = user.role === "free";

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Left Sidebar - TradingView style */}
      <aside className="w-16 bg-panel border-r border-border/30 flex flex-col items-center py-4 gap-2">
        {/* Logo */}
        <Link href="/" className="w-10 h-10 bg-gradient-to-br from-accent to-accent-dark rounded flex items-center justify-center mb-4">
          <Coins className="h-5 w-5 text-white" />
        </Link>

        {/* Nav icons */}
        {[
          { icon: LineChart, label: "Charts", tab: 'charts' as DashboardTab },
          { icon: TrendingUp, label: "Trades", tab: 'trades' as DashboardTab },
          { icon: Target, label: "Strategy", tab: 'strategy' as DashboardTab },
          { icon: PieChart, label: "Portfolio", tab: 'portfolio' as DashboardTab },
          { icon: Bell, label: "Alerts", tab: 'alerts' as DashboardTab },
          { icon: FlaskConical, label: "Backtest", tab: 'backtest' as DashboardTab },
        ].map((item, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(item.tab)}
            className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${activeTab === item.tab
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
                {stockData?.symbol || 'Select Stock'}
              </span>
              <span className="text-lg font-bold text-success">
                ${stockData ? Number(stockData.latest_price).toFixed(2) : '0.00'}
              </span>
              <span className={`text-sm ${stockData && stockData.change_percent >= 0 ? 'text-success' : 'text-red-500'}`}>
                {stockData ? `${stockData.change_percent >= 0 ? '+' : ''}${Number(stockData.change_percent).toFixed(2)}%` : '0.00%'}
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

            {/* TRADES TAB */}
            {activeTab === 'trades' && (
              <div className="flex-1 p-4 overflow-auto">
                <div className="bg-panel border border-border rounded-lg">
                  <div className="bg-elevated p-4 border-b border-border">
                    <h2 className="text-lg font-bold text-primary">Trade History</h2>
                    <p className="text-sm text-secondary">Zone alerts and their outcomes</p>
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
                          <div className={`text-xl font-bold ${parseFloat(tradesData.summary.totalPnlPercent || tradesData.summary.totalReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                            {parseFloat(tradesData.summary.totalPnlPercent || tradesData.summary.totalReturn) >= 0 ? '+' : ''}{tradesData.summary.totalPnlPercent || tradesData.summary.totalReturn}%
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
                            {sortTrades(tradesData.trades).map((trade: Trade) => {
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
                    <div className="p-8 text-center text-secondary">No trades data available</div>
                  )}
                </div>
              </div>
            )}

            {/* PORTFOLIO TAB */}
            {activeTab === 'portfolio' && (
              <div className="flex-1 p-4 overflow-auto">
                <div className="bg-panel border border-border rounded-lg">
                  <div className="bg-elevated p-4 border-b border-border">
                    <h2 className="text-lg font-bold text-primary">Portfolio Performance</h2>
                    <p className="text-sm text-secondary">Returns, risk metrics, and equity curve</p>
                  </div>
                  {tabLoading ? (
                    <div className="p-8 text-center text-secondary">Loading portfolio data...</div>
                  ) : portfolioData ? (
                    <>
                      {/* Performance Metrics */}
                      <div className="p-4 grid grid-cols-4 gap-4 border-b border-border">
                        <div className="bg-background rounded-lg p-4">
                          <div className="text-xs text-secondary mb-1">Total Return</div>
                          <div className={`text-2xl font-bold ${parseFloat(portfolioData.performance.totalReturn) >= 0 ? 'text-success' : 'text-red-500'}`}>
                            {parseFloat(portfolioData.performance.totalReturn) >= 0 ? '+' : ''}{portfolioData.performance.totalReturn}%
                          </div>
                        </div>
                        <div className="bg-background rounded-lg p-4">
                          <div className="text-xs text-secondary mb-1">Sharpe Ratio</div>
                          <div className={`text-2xl font-bold ${parseFloat(portfolioData.performance.sharpeRatio) >= 1 ? 'text-success' : parseFloat(portfolioData.performance.sharpeRatio) >= 0 ? 'text-accent' : 'text-red-500'}`}>
                            {portfolioData.performance.sharpeRatio}
                          </div>
                          <div className="text-xs text-secondary mt-1">Risk-adjusted return</div>
                        </div>
                        <div className="bg-background rounded-lg p-4">
                          <div className="text-xs text-secondary mb-1">Information Ratio</div>
                          <div className={`text-2xl font-bold ${parseFloat(portfolioData.performance.informationRatio) >= 0 ? 'text-success' : 'text-red-500'}`}>
                            {portfolioData.performance.informationRatio}
                          </div>
                          <div className="text-xs text-secondary mt-1">vs S&P 500 benchmark</div>
                        </div>
                        <div className="bg-background rounded-lg p-4">
                          <div className="text-xs text-secondary mb-1">Max Drawdown</div>
                          <div className="text-2xl font-bold text-red-500">
                            -{portfolioData.performance.maxDrawdown}%
                          </div>
                          <div className="text-xs text-secondary mt-1">Peak to trough</div>
                        </div>
                      </div>

                      {/* Zone Type Breakdown */}
                      <div className="p-4 grid grid-cols-2 gap-4 border-b border-border">
                        <div className="bg-success/10 border border-success/30 rounded-lg p-4">
                          <h3 className="text-sm font-bold text-success mb-2">Demand Zones (Long)</h3>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <div className="text-xs text-secondary">Trades</div>
                              <div className="font-bold text-primary">{portfolioData.byZoneType.demand.trades}</div>
                            </div>
                            <div>
                              <div className="text-xs text-secondary">Win Rate</div>
                              <div className="font-bold text-success">{portfolioData.byZoneType.demand.winRate}%</div>
                            </div>
                            <div>
                              <div className="text-xs text-secondary">Avg Return</div>
                              <div className="font-bold text-primary">{portfolioData.byZoneType.demand.avgReturn}%</div>
                            </div>
                          </div>
                        </div>
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                          <h3 className="text-sm font-bold text-red-400 mb-2">Supply Zones (Short)</h3>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <div className="text-xs text-secondary">Trades</div>
                              <div className="font-bold text-primary">{portfolioData.byZoneType.supply.trades}</div>
                            </div>
                            <div>
                              <div className="text-xs text-secondary">Win Rate</div>
                              <div className="font-bold text-red-400">{portfolioData.byZoneType.supply.winRate}%</div>
                            </div>
                            <div>
                              <div className="text-xs text-secondary">Avg Return</div>
                              <div className="font-bold text-primary">{portfolioData.byZoneType.supply.avgReturn}%</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Trade Stats */}
                      <div className="p-4 grid grid-cols-4 gap-4">
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Win Rate</div>
                          <div className="text-xl font-bold text-success">{portfolioData.performance.winRate}%</div>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Total Trades</div>
                          <div className="text-xl font-bold text-primary">{portfolioData.performance.totalTrades}</div>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Wins</div>
                          <div className="text-xl font-bold text-success">{portfolioData.performance.wins}</div>
                        </div>
                        <div className="bg-background rounded-lg p-3">
                          <div className="text-xs text-secondary">Losses</div>
                          <div className="text-xl font-bold text-red-500">{portfolioData.performance.losses}</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="p-8 text-center text-secondary">No portfolio data available</div>
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

            {/* ALERTS TAB */}
            {activeTab === 'alerts' && (
              <div className="flex-1 p-4 overflow-auto">
                <div className="bg-panel border border-border rounded-lg p-8 text-center">
                  <Bell className="h-12 w-12 text-secondary mx-auto mb-4" />
                  <h2 className="text-lg font-bold text-primary mb-2">Alerts</h2>
                  <p className="text-sm text-secondary">Real-time zone alerts will appear here.</p>
                  <p className="text-xs text-secondary mt-2">Coming soon...</p>
                </div>
              </div>
            )}

            {/* BACKTEST TAB */}
            {activeTab === 'backtest' && (
              <div className="flex-1 flex overflow-hidden">
                {/* Configuration Panel */}
                <div className="w-80 border-r border-border bg-panel p-4 overflow-y-auto">
                  <h2 className="text-lg font-medium flex items-center gap-2 mb-4">
                    <Settings className="w-5 h-5" />
                    Configuration
                  </h2>

                  <div className="space-y-4">
                    {/* Multi-Symbol Mode Toggle */}
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-secondary">Multi-Symbol Mode</label>
                      <button
                        onClick={() => {
                          setMultiSymbolMode(!multiSymbolMode);
                          if (!multiSymbolMode) {
                            // Switching to multi-symbol mode - clear single symbol
                            setBacktestConfig({ ...backtestConfig, symbol: '', symbols: [] });
                            setBacktestDateRange(null);
                          } else {
                            // Switching to single symbol mode - clear multi symbols
                            setBacktestConfig({ ...backtestConfig, symbols: [] });
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          multiSymbolMode ? 'bg-accent' : 'bg-elevated border border-border'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            multiSymbolMode ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Symbol Selection */}
                    {!multiSymbolMode ? (
                      // Single Symbol Mode
                      <div>
                        <label className="block text-sm text-secondary mb-1">Symbol</label>
                        <select
                          value={backtestConfig.symbol}
                          onChange={(e) => {
                            setBacktestConfig({ ...backtestConfig, symbol: e.target.value });
                            fetchBacktestDateRange(e.target.value);
                          }}
                          className="w-full bg-elevated border border-border rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
                        >
                          {backtestSymbols.map((s) => (
                            <option key={s.symbol} value={s.symbol}>
                              {s.symbol} - {s.name || 'Unknown'}
                            </option>
                          ))}
                        </select>
                        {backtestDateRange && (
                          <p className="text-xs text-secondary mt-1">
                            Data: {backtestDateRange.min} to {backtestDateRange.max}
                          </p>
                        )}
                      </div>
                    ) : (
                      // Multi-Symbol Mode
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-sm text-secondary">
                            Select Symbols ({backtestConfig.symbols.length} selected)
                          </label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setBacktestConfig({
                                ...backtestConfig,
                                symbols: backtestSymbols.map(s => s.symbol)
                              })}
                              className="text-xs text-accent hover:text-amber-400 transition-colors"
                            >
                              Select All
                            </button>
                            <span className="text-secondary">|</span>
                            <button
                              onClick={() => setBacktestConfig({
                                ...backtestConfig,
                                symbols: []
                              })}
                              className="text-xs text-secondary hover:text-primary transition-colors"
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="bg-elevated border border-border rounded max-h-48 overflow-y-auto">
                          {backtestSymbols.map((s) => (
                            <label
                              key={s.symbol}
                              className="flex items-center px-3 py-2 hover:bg-panel cursor-pointer border-b border-border last:border-b-0"
                            >
                              <input
                                type="checkbox"
                                checked={backtestConfig.symbols.includes(s.symbol)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setBacktestConfig({
                                      ...backtestConfig,
                                      symbols: [...backtestConfig.symbols, s.symbol]
                                    });
                                  } else {
                                    setBacktestConfig({
                                      ...backtestConfig,
                                      symbols: backtestConfig.symbols.filter(sym => sym !== s.symbol)
                                    });
                                  }
                                }}
                                className="w-4 h-4 rounded border-border bg-background text-accent focus:ring-accent mr-3"
                              />
                              <span className="text-primary text-sm">{s.symbol}</span>
                              <span className="text-secondary text-xs ml-2">- {s.name || 'Unknown'}</span>
                            </label>
                          ))}
                        </div>
                        {backtestConfig.symbols.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {backtestConfig.symbols.map(sym => (
                              <span
                                key={sym}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-accent/20 text-accent"
                              >
                                {sym}
                                <button
                                  onClick={() => setBacktestConfig({
                                    ...backtestConfig,
                                    symbols: backtestConfig.symbols.filter(s => s !== sym)
                                  })}
                                  className="ml-1 hover:text-white"
                                >
                                  x
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-secondary mt-1">
                          Pool multiple stocks to trade with shared capital
                        </p>
                      </div>
                    )}

                    {/* Date Range */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm text-secondary mb-1">Start Date</label>
                        <input
                          type="date"
                          value={backtestConfig.start_date}
                          onChange={(e) => setBacktestConfig({ ...backtestConfig, start_date: e.target.value })}
                          className="w-full bg-elevated border border-border rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-secondary mb-1">End Date</label>
                        <input
                          type="date"
                          value={backtestConfig.end_date}
                          onChange={(e) => setBacktestConfig({ ...backtestConfig, end_date: e.target.value })}
                          className="w-full bg-elevated border border-border rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>

                    {/* Capital */}
                    <div>
                      <label className="block text-sm text-secondary mb-1">Initial Capital</label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
                        <input
                          type="number"
                          value={backtestConfig.initial_capital}
                          onChange={(e) => setBacktestConfig({ ...backtestConfig, initial_capital: Number(e.target.value) })}
                          className="w-full bg-elevated border border-border rounded pl-9 pr-3 py-2 text-primary focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>

                    {/* Position Sizing Note */}
                    <div className="bg-elevated/50 rounded-lg p-3">
                      <p className="text-xs text-secondary">
                        <span className="text-accent font-medium">Kelly Position Sizing</span>: Position size is calculated dynamically using Half-Kelly criterion based on historical win rate and R-multiples.
                      </p>
                    </div>

                    {/* Min Risk/Reward */}
                    <div>
                      <label className="block text-sm text-secondary mb-1">Min Risk/Reward</label>
                      <input
                        type="number"
                        step="0.5"
                        min="1"
                        max="10"
                        value={backtestConfig.min_risk_reward}
                        onChange={(e) => setBacktestConfig({ ...backtestConfig, min_risk_reward: Number(e.target.value) })}
                        className="w-full bg-elevated border border-border rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
                      />
                      <p className="text-xs text-secondary mt-1">{backtestConfig.min_risk_reward}:1 ratio</p>
                    </div>

                    {/* Max Positions */}
                    <div>
                      <label className="block text-sm text-secondary mb-1">Max Positions</label>
                      <select
                        value={backtestConfig.max_positions}
                        onChange={(e) => setBacktestConfig({ ...backtestConfig, max_positions: Number(e.target.value) })}
                        className="w-full bg-elevated border border-border rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
                      >
                        <option value={1}>1 Position</option>
                        <option value={2}>2 Positions</option>
                        <option value={3}>3 Positions</option>
                        <option value={5}>5 Positions</option>
                        <option value={10}>10 Positions</option>
                      </select>
                      <p className="text-xs text-secondary mt-1">Concurrent trades allowed</p>
                    </div>

                    {/* Run Button */}
                    <button
                      onClick={runBacktest}
                      disabled={
                        backtestLoading ||
                        !backtestConfig.start_date ||
                        !backtestConfig.end_date ||
                        (multiSymbolMode ? backtestConfig.symbols.length === 0 : !backtestConfig.symbol)
                      }
                      className="w-full bg-accent hover:bg-amber-600 text-background font-medium py-3 rounded flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {backtestLoading ? (
                        <>
                          <Activity className="w-5 h-5 animate-spin" />
                          Running...
                        </>
                      ) : (
                        <>
                          <Zap className="w-5 h-5" />
                          {multiSymbolMode ? `Run Backtest (${backtestConfig.symbols.length} symbols)` : 'Run Backtest'}
                        </>
                      )}
                    </button>

                    {backtestEngine && (
                      <p className="text-xs text-secondary text-center">Engine: {backtestEngine}</p>
                    )}
                  </div>
                </div>

                {/* Results Panel */}
                <div className="flex-1 p-4 overflow-y-auto">
                  {backtestError && (
                    <div className="bg-red-900/20 border border-red-500/50 text-red-400 px-4 py-3 rounded mb-4">
                      {backtestError}
                    </div>
                  )}

                  {!backtestResults && !backtestLoading && (
                    <div className="flex flex-col items-center justify-center h-full text-secondary">
                      <FlaskConical className="w-16 h-16 mb-4 opacity-50" />
                      <p className="text-lg">Configure and run a backtest to see results</p>
                      <p className="text-sm mt-2">Select a symbol and date range, then click "Run Backtest"</p>
                    </div>
                  )}

                  {backtestLoading && (
                    <div className="flex flex-col items-center justify-center h-full text-secondary">
                      <Activity className="w-16 h-16 mb-4 animate-spin text-accent" />
                      <p className="text-lg">Running backtest...</p>
                      <p className="text-sm mt-2">This may take a moment</p>
                    </div>
                  )}

                  {backtestResults && (
                    <div className="space-y-4">
                      {/* Summary Stats */}
                      <div className="grid grid-cols-4 gap-4">
                        <div className="bg-panel border border-border rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Total Trades</div>
                          <div className="text-2xl font-semibold">{backtestResults.total_trades ?? 0}</div>
                        </div>
                        <div className="bg-panel border border-border rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Win Rate</div>
                          <div className={`text-2xl font-semibold ${(backtestResults.win_rate ?? 0) >= 0.5 ? 'text-success' : 'text-red-400'}`}>
                            {formatPercent((backtestResults.win_rate ?? 0) * 100)}
                          </div>
                          <div className="text-xs text-secondary">{backtestResults.winning_trades ?? 0}W / {backtestResults.losing_trades ?? 0}L</div>
                        </div>
                        <div className="bg-panel border border-border rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Total P&L</div>
                          <div className={`text-2xl font-semibold ${(backtestResults.total_pnl ?? 0) >= 0 ? 'text-success' : 'text-red-400'}`}>
                            {formatCurrency(backtestResults.total_pnl ?? 0)}
                          </div>
                          <div className="text-xs text-secondary">{formatPercent(backtestResults.total_return_pct ?? 0)}</div>
                        </div>
                        <div className="bg-panel border border-border rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Final Capital</div>
                          <div className={`text-2xl font-semibold ${(backtestResults.final_capital ?? 0) >= backtestConfig.initial_capital ? 'text-success' : 'text-red-400'}`}>
                            {formatCurrency(backtestResults.final_capital ?? 0)}
                          </div>
                        </div>
                      </div>

                      {/* Performance Metrics */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="bg-elevated rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Profit Factor</div>
                          <div className="text-xl font-medium">
                            {backtestResults.profit_factor === Infinity ? "Inf" : (backtestResults.profit_factor ?? 0).toFixed(2)}
                          </div>
                        </div>
                        <div className="bg-elevated rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Sharpe Ratio</div>
                          <div className="text-xl font-medium">{(backtestResults.sharpe_ratio ?? 0).toFixed(2)}</div>
                        </div>
                        <div className="bg-elevated rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Avg R-Multiple</div>
                          <div className="text-xl font-medium">{(backtestResults.avg_r_multiple ?? 0).toFixed(2)}R</div>
                        </div>
                        <div className="bg-elevated rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Avg Win</div>
                          <div className="text-xl font-medium text-success">{formatCurrency(backtestResults.avg_win ?? 0)}</div>
                        </div>
                        <div className="bg-elevated rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Avg Loss</div>
                          <div className="text-xl font-medium text-red-400">{formatCurrency(backtestResults.avg_loss ?? 0)}</div>
                        </div>
                        <div className="bg-elevated rounded-lg p-4">
                          <div className="text-secondary text-sm mb-1">Max Drawdown</div>
                          <div className="text-xl font-medium text-red-400">{formatPercent(backtestResults.max_drawdown_pct ?? 0)}</div>
                        </div>
                      </div>

                      {/* Kelly Position Sizing Parameters */}
                      {backtestResults.kelly_params && (
                        <div className="bg-panel border border-accent/30 rounded-lg p-4">
                          <h3 className="text-lg font-medium mb-3 text-accent">Kelly Position Sizing</h3>
                          <div className="grid grid-cols-5 gap-4 text-sm">
                            <div>
                              <div className="text-secondary mb-1">Win Rate</div>
                              <div className="font-medium">{((backtestResults.kelly_params.win_rate ?? 0) * 100).toFixed(1)}%</div>
                            </div>
                            <div>
                              <div className="text-secondary mb-1">Avg Win</div>
                              <div className="font-medium text-success">{(backtestResults.kelly_params.avg_win_r ?? 0).toFixed(2)}R</div>
                            </div>
                            <div>
                              <div className="text-secondary mb-1">Avg Loss</div>
                              <div className="font-medium text-red-400">{(backtestResults.kelly_params.avg_loss_r ?? 0).toFixed(2)}R</div>
                            </div>
                            <div>
                              <div className="text-secondary mb-1">Half-Kelly</div>
                              <div className="font-medium text-accent">{(backtestResults.kelly_params.half_kelly_pct ?? 0).toFixed(1)}%</div>
                            </div>
                            <div>
                              <div className="text-secondary mb-1">Sample Size</div>
                              <div className="font-medium">{backtestResults.kelly_params.sample_size ?? 0} trades</div>
                            </div>
                          </div>
                          <p className="text-xs text-secondary mt-2">Position size = Half-Kelly % of portfolio equity per trade</p>
                        </div>
                      )}

                      {/* Symbol Breakdown (Multi-Symbol Mode) */}
                      {backtestResults.symbol_breakdown && backtestResults.symbol_breakdown.length > 1 && (
                        <div className="bg-panel border border-border rounded-lg overflow-hidden">
                          <div className="px-4 py-3 border-b border-border">
                            <h3 className="text-lg font-medium">Per-Symbol Breakdown</h3>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-elevated">
                                <tr>
                                  <th className="text-left px-4 py-2 text-secondary font-medium">Symbol</th>
                                  <th className="text-right px-4 py-2 text-secondary font-medium">Trades</th>
                                  <th className="text-right px-4 py-2 text-secondary font-medium">Win Rate</th>
                                  <th className="text-right px-4 py-2 text-secondary font-medium">W/L</th>
                                  <th className="text-right px-4 py-2 text-secondary font-medium">P&L</th>
                                </tr>
                              </thead>
                              <tbody>
                                {backtestResults.symbol_breakdown.map((sb, i) => (
                                  <tr key={i} className="border-t border-border hover:bg-elevated/50">
                                    <td className="px-4 py-2 font-medium">{sb.symbol}</td>
                                    <td className="px-4 py-2 text-right">{sb.total_trades}</td>
                                    <td className={`px-4 py-2 text-right ${(sb.win_rate ?? 0) >= 0.5 ? 'text-success' : 'text-red-400'}`}>
                                      {((sb.win_rate ?? 0) * 100).toFixed(1)}%
                                    </td>
                                    <td className="px-4 py-2 text-right text-secondary">
                                      {sb.winning_trades}W / {sb.losing_trades}L
                                    </td>
                                    <td className={`px-4 py-2 text-right ${(sb.total_pnl ?? 0) >= 0 ? 'text-success' : 'text-red-400'}`}>
                                      {formatCurrency(sb.total_pnl ?? 0)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Equity Curve */}
                      {backtestResults.equity_curve.length > 0 && (
                        <div className="bg-panel border border-border rounded-lg p-4">
                          <h3 className="text-lg font-medium mb-4">Equity Curve</h3>
                          <div className="h-48 flex items-end gap-px">
                            {backtestResults.equity_curve.map((point, i) => {
                              const values = backtestResults.equity_curve.map(p => p[1]);
                              const min = Math.min(...values);
                              const max = Math.max(...values);
                              const range = max - min || 1;
                              const height = ((point[1] - min) / range) * 100;
                              const isPositive = point[1] >= backtestConfig.initial_capital;

                              return (
                                <div
                                  key={i}
                                  className={`flex-1 min-w-[2px] rounded-t ${isPositive ? 'bg-success' : 'bg-red-500'}`}
                                  style={{ height: `${Math.max(height, 2)}%` }}
                                  title={`${point[0]}: ${formatCurrency(point[1])}`}
                                />
                              );
                            })}
                          </div>
                          <div className="flex justify-between text-xs text-secondary mt-2">
                            <span>{backtestResults.equity_curve[0]?.[0]}</span>
                            <span>{backtestResults.equity_curve[backtestResults.equity_curve.length - 1]?.[0]}</span>
                          </div>
                        </div>
                      )}

                      {/* Trade List */}
                      <div className="bg-panel border border-border rounded-lg overflow-hidden">
                        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                          <h3 className="text-lg font-medium">Trades ({backtestResults.trades.length})</h3>
                          <span className="text-xs text-secondary">Click a trade to view on chart</span>
                        </div>
                        <div className="max-h-[400px] overflow-auto">
                          <table className="w-full text-sm min-w-[900px]">
                            <thead className="bg-elevated sticky top-0 z-10">
                              <tr>
                                <th className="text-left px-3 py-2 text-secondary font-medium whitespace-nowrap">Entry Date</th>
                                <th className="text-left px-3 py-2 text-secondary font-medium whitespace-nowrap">Exit Date</th>
                                {multiSymbolMode && (
                                  <th className="text-left px-3 py-2 text-secondary font-medium">Symbol</th>
                                )}
                                <th className="text-left px-3 py-2 text-secondary font-medium">Type</th>
                                <th className="text-right px-3 py-2 text-secondary font-medium">Entry</th>
                                <th className="text-right px-3 py-2 text-secondary font-medium">Exit</th>
                                <th className="text-right px-3 py-2 text-secondary font-medium">Target</th>
                                <th className="text-right px-3 py-2 text-secondary font-medium">Stop</th>
                                <th className="text-right px-3 py-2 text-secondary font-medium whitespace-nowrap">Position $</th>
                                <th className="text-right px-3 py-2 text-secondary font-medium">P&L</th>
                                <th className="text-right px-3 py-2 text-secondary font-medium">R</th>
                                <th className="text-center px-3 py-2 text-secondary font-medium">Exit Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {backtestResults.trades.map((trade, i) => (
                                <tr
                                  key={i}
                                  className="border-t border-border hover:bg-elevated/50 cursor-pointer transition-colors"
                                  onClick={async () => {
                                    // Extract zone_id (handle multi-symbol format: "SYMBOL_ZONEID")
                                    const zoneIdStr = trade.zone_id.toString();
                                    const actualZoneId = zoneIdStr.includes('_') ? zoneIdStr.split('_')[1] : zoneIdStr;
                                    // Switch to charts tab and snap to the zone
                                    setActiveTab('charts');
                                    pendingZoneSnapRef.current = actualZoneId;
                                    setZoneSearchQuery(actualZoneId);
                                    await fetchStockDataWithZoneID(actualZoneId);
                                  }}
                                  title="Click to view on chart"
                                >
                                  <td className="px-3 py-2 text-secondary whitespace-nowrap">
                                    {new Date(trade.entry_time).toLocaleDateString()}
                                  </td>
                                  <td className="px-3 py-2 text-secondary whitespace-nowrap">
                                    {trade.exit_time ? new Date(trade.exit_time).toLocaleDateString() : '-'}
                                  </td>
                                  {multiSymbolMode && (
                                    <td className="px-3 py-2 font-medium">{trade.symbol}</td>
                                  )}
                                  <td className="px-3 py-2">
                                    <span className={`px-2 py-0.5 rounded text-xs ${
                                      trade.direction === 'Long'
                                        ? 'bg-success/20 text-success'
                                        : 'bg-pink-500/20 text-pink-400'
                                    }`}>
                                      {trade.direction}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-right">${(trade.entry_price ?? 0).toFixed(2)}</td>
                                  <td className={`px-3 py-2 text-right ${
                                    (trade.exit_price ?? 0) > (trade.entry_price ?? 0)
                                      ? (trade.direction === 'Long' ? 'text-success' : 'text-red-400')
                                      : (trade.exit_price ?? 0) < (trade.entry_price ?? 0)
                                        ? (trade.direction === 'Long' ? 'text-red-400' : 'text-success')
                                        : 'text-secondary'
                                  }`}>
                                    ${(trade.exit_price ?? 0).toFixed(2)}
                                  </td>
                                  <td className="px-3 py-2 text-right text-accent">${(trade.target_price ?? 0).toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right text-red-400">${(trade.stop_loss ?? 0).toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right whitespace-nowrap">
                                    {formatCurrency(trade.capital_deployed ?? (trade.shares * trade.entry_price))}
                                  </td>
                                  <td className={`px-3 py-2 text-right font-medium ${(trade.pnl ?? 0) >= 0 ? 'text-success' : 'text-red-400'}`}>
                                    {formatCurrency(trade.pnl ?? 0)}
                                  </td>
                                  <td className={`px-3 py-2 text-right ${(trade.r_multiple ?? 0) >= 0 ? 'text-success' : 'text-red-400'}`}>
                                    {(trade.r_multiple ?? 0).toFixed(2)}R
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-0.5 rounded text-xs ${
                                      trade.exit_reason === 'Target Hit' ? 'bg-success/20 text-success' :
                                      trade.exit_reason === 'Stop Loss' ? 'bg-red-500/20 text-red-400' :
                                      'bg-gray-500/20 text-gray-400'
                                    }`}>
                                      {trade.exit_reason || trade.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CHARTS TAB - Original Chart Content */}
            {activeTab === 'charts' && (
            <>
            {/* Chart Container */}
            <div className="flex-1 p-4 pb-2">
              <div className="h-full bg-panel border border-border rounded-lg flex flex-col">
              {/* Chart Header */}
              <div className="bg-elevated p-3 border-b border-border flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search stock (e.g., AAPL, TSLA)... Press Enter"
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
                  >
                    <option>2min</option>
                    <option>3min</option>
                    <option>5min</option>
                    <option>6min</option>
                    <option>10min</option>
                    <option>13min</option>
                    <option>15min</option>
                    <option>26min</option>
                    <option>30min</option>
                    <option>39min</option>
                    <option>65min</option>
                    <option>78min</option>
                    <option>130min</option>
                    <option>195min</option>
                    <option>daily</option>
                    <option>5d</option>
                    <option>22d</option>
                    <option>65d</option>
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
                  <div className="relative">
                    <Target className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-secondary pointer-events-none" />
                    <input
                      type="text"
                      placeholder="ZoneRetestID... Press Enter"
                      value={zoneRetestIdSearchQuery}
                      onChange={(e) => setZoneRetestIdSearchQuery(e.target.value)}
                      onKeyDown={handleZoneRetestIdSearch}
                      disabled={fetching}
                      className="bg-background border border-border rounded px-3 py-1.5 pl-10 text-sm text-primary placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    />
                  </div>
                  {/* commented for now */}
                  {/* <div className="flex gap-1">
                    {['Candles', 'Line', 'Area'].map((type) => (
                      <button key={type} className="px-3 py-1 text-xs bg-background hover:bg-elevated border border-border rounded text-secondary hover:text-primary transition-colors">
                        {type}
                      </button>
                    ))}
                  </div> */}
                  <div className="flex gap-2 items-center">
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
                    {/* Volume Profile Bins Selector (only show when VP is active) */}
                    {showVolumeProfile && (
                      <>
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
                            title="Start time (ET)"
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
                            title="End time (ET)"
                          />
                        </div>
                        <span className="text-xs text-accent font-medium">(ET)</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <button className="p-1.5 hover:bg-elevated rounded transition-colors">
                    <BarChart3 className="h-4 w-4 text-secondary" />
                  </button>
                  <button className="p-1.5 hover:bg-elevated rounded transition-colors">
                    <Settings className="h-4 w-4 text-secondary" />
                  </button>
                </div>
              </div>

              {/* Chart Content */}
              <div className="flex-1 p-4 relative min-h-0">
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
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-md flex items-center justify-center">
                    <div className="text-center max-w-md p-8">
                      <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Lock className="h-8 w-8 text-accent" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2 text-primary">
                        Unlock Professional Charts
                      </h3>
                      <p className="text-secondary mb-6">
                        Upgrade to Pro to access real-time stock charts, advanced indicators, and AI-powered insights.
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

            {/* Stats Container - Separate from Chart */}
            <div className="px-4 pb-4">
              <div className="grid grid-cols-3 gap-10">
              {stockData && hoveredCandle ? [
                // Show candle data (hovered candle or last available candle)
                {
                  label: 'Dollar Volume',
                  value: hoveredCandle.dollarVolume >= 1_000_000_000
                    ? `$${(hoveredCandle.dollarVolume / 1_000_000_000).toFixed(2)}B`
                    : `$${(hoveredCandle.dollarVolume / 1_000_000).toFixed(2)}M`,
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
                  Search for a stock symbol (e.g., AAPL, TSLA) to view statistics
                </div>
              )}
              </div>
            </div>
          </>
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
                    Hey! I'm your stock trading assistant. What would you like to know about today's market?
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
                          Upgrade to Pro to chat with our AI assistant about stock markets
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
                    placeholder={isLocked ? "Upgrade to chat..." : "Ask about stocks..."}
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