"use client";

import {
  BarChart3, Bell, Bot, Home, LogOut, Settings, TrendingUp, Activity,
  LineChart, PieChart, Wallet, Target, Zap, Lock, Crown, ArrowRight,
  MessageSquare, Send, X, Search, Coins
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

// ============================================================================
// Main Component
// ============================================================================

export default function CryptoDashboardPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [user, setUser] = useState<UserInfo>({ name: "User", email: "user@example.com", role: "free" });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [cryptoData, setCryptoData] = useState<CryptoAggregate | null>(null);
  const [zonesData, setZonesData] = useState<any>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const drawingToolbarRef = useRef<HTMLDivElement>(null);
  const drawingToolRef = useRef<RectangleDrawingTool | null>(null);
  const zonePrimitivesRef = useRef<ZonePrimitive[]>([]);
  const [timeframe, setTimeframe] = useState("5m");
  const [limit, setLimit] = useState(8640);
  const [hours, setHours] = useState(720);
  // TEMPORARILY COMMENTED OUT FOR LOCAL DEVELOPMENT
  // Uncomment lines 47-66 below to restore Azure Easy Auth
  console.log("Timeframe: ", timeframe);
  console.log("Limit: ", limit);
  console.log("Hours: ", hours);

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

  // Effect to refetch data when timeframe settings change
  useEffect(() => {
    if (searchQuery.trim()) {
      fetchCryptoData(searchQuery);
    }
  }, [timeframe, limit, hours]);

  // Fetch crypto data based on symbol
  const fetchCryptoData = async (symbol: string) => {
    if (!symbol.trim()) {
      setCryptoData(null);
      setZonesData(null);
      setError(null);
      return;
    }

    try {
      setFetching(true);
      setError(null);

      // Fetch aggregates data
      const aggregatesResponse = await fetch(`/api/crypto/aggregates?symbols=${symbol.toUpperCase()}&limit=${limit}&timeframe=${timeframe}&hours=${hours}`);
      const aggregatesData = await aggregatesResponse.json();

      // Fetch zones data
      const zonesResponse = await fetch(`/api/crypto/zones?symbols=${symbol.toUpperCase()}&limit=100&timeframe=${timeframe}`);
      const zonesDataResponse = await zonesResponse.json();


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
        setError(`No data found for ${symbol}`);
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
    const limitMap: Record<string, number> = {
      "5min": 8640,
      "15min": 5760,
      "30min": 4320,
      "1h": 2160,
      "2h": 1080,
      "4h": 1080,
      "8h": 1095,
      "Daily": 1095,
      "7d": 104,
      "31d": 35,
      "93d": 19,
      "65min": 3988,
      "130min": 4044,
      "195min": 2696,
      "390min": 4044,
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
    setTimeframe(timeframeMap[selected] || selected);
    setLimit(limitMap[selected] || 8640);
    setHours(hoursMap[selected] || 720);
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

        // Drawing tool cleanup - COMMENTED OUT
        // if (drawingToolRef.current) {
        //   drawingToolRef.current.remove();
        //   drawingToolRef.current = null;
        // }
        chart.remove();
      };
    } catch (err) {
      console.error('Error initializing chart:', err);
    }
  }, [cryptoData, zonesData]);

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
          { icon: Home, label: "Dashboard", active: true },
          { icon: LineChart, label: "Charts" },
          { icon: TrendingUp, label: "Trades" },
          { icon: Target, label: "Strategies" },
          { icon: PieChart, label: "Portfolio" },
          { icon: Bell, label: "Alerts" },
        ].map((item, i) => (
          <button
            key={i}
            className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${item.active
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
          {/* Center: Chart and Stats Area */}
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
                    defaultValue="5min"
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
                  {/* <div className="flex gap-1">
                    {['Candles', 'Line', 'Area'].map((type) => (
                      <button key={type} className="px-3 py-1 text-xs bg-background hover:bg-elevated border border-border rounded text-secondary hover:text-primary transition-colors">
                        {type}
                      </button>
                    ))}
                  </div> */}
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
              <div className="flex-1 p-4 relative min-h-0">
                {/* Lightweight Charts Container */}
                <div
                  ref={chartContainerRef}
                  className="w-full h-full"
                />

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

            {/* Stats Container - Separate from Chart */}
            <div className="px-4 pb-4">
              <div className="grid grid-cols-3 gap-10">
              {cryptoData ? [
                { label: 'Volume 24h', value: `${((Number(cryptoData.volume_24h) || 0) / 1_000_000).toFixed(1)}M`, change: `Shares`, up: true },
                { label: 'High 24h', value: `$${Number(cryptoData.high_24h).toFixed(2)}`, change: `+${((Number(cryptoData.high_24h) - Number(cryptoData.latest_price)) / Number(cryptoData.latest_price) * 100).toFixed(2)}%`, up: Number(cryptoData.high_24h) > Number(cryptoData.latest_price) },
                { label: 'Low 24h', value: `$${Number(cryptoData.low_24h).toFixed(2)}`, change: `${((Number(cryptoData.low_24h) - Number(cryptoData.latest_price)) / Number(cryptoData.latest_price) * 100).toFixed(2)}%`, up: Number(cryptoData.low_24h) < Number(cryptoData.latest_price) },
              ].map((stat, i) => (
                <div key={i} className="bg-panel border border-border rounded-lg p-4">
                  <div className="text-xs text-secondary mb-1">{stat.label}</div>
                  <div className="text-lg font-bold text-primary mb-1">{stat.value}</div>
                  <div className="text-xs text-secondary">
                    {stat.change}
                  </div>
                </div>
              )) : (
                <div className="col-span-4 text-center text-secondary py-8">
                  Search for a crypto symbol (e.g., BTC, ETH) to view statistics
                </div>
              )}
              </div>
            </div>
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
