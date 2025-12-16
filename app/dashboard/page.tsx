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

export default function DashboardPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [user, setUser] = useState<UserInfo>({ name: "User", email: "user-admin@helwa.ai", role: "admin" });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stockData, setStockData] = useState<StockAggregate | null>(null);
  const [zonesData, setZonesData] = useState<any>(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const drawingToolbarRef = useRef<HTMLDivElement>(null);
  const drawingToolRef = useRef<RectangleDrawingTool | null>(null);
  const zonePrimitivesRef = useRef<ZonePrimitive[]>([]);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const pendingZoneSnapRef = useRef<string | null>(null);
  const [timeframe, setTimeframe] = useState("2m");
  const [limit, setLimit] = useState(5850);
  const [hours, setHours] = useState(720);
  const [zoneSearchQuery, setZoneSearchQuery] = useState("");
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
      fetchStockData(searchQuery);
    }
  }, [timeframe, limit, hours]);

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

      // Fetch aggregates data
      const aggregatesResponse = await fetch(`/api/stocks/aggregates?symbols=${symbol.toUpperCase()}&limit=${lim}&timeframe=${tf}&hours=${hrs}`);
      const aggregatesData = await aggregatesResponse.json();

      // Fetch zones data
      const zonesResponse = await fetch(`/api/stocks/zones?symbols=${symbol.toUpperCase()}&timeframe=${tf}`);
      const zonesDataResponse = await zonesResponse.json();

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
      } else {
        setError(`No data found for ${symbol}`);
        setStockData(null);
        setZonesData(null);
      }
    } catch (err: any) {
      setError(`Error fetching data: ${err.message}`);
      setStockData(null);
      setZonesData(null);
    } finally {
      setFetching(false);
    }
  };

  // fetch stock data based on zone_id
  const fetchStockDataWithZoneID = async (zoneId: string) => {
    if (!zoneId.trim()) {
      setStockData(null);
      setZonesData(null);
      setError(null);
      return;
    }

    try {
      setFetching(true);
      setError(null);

      // Step 1: Fetch zone search data to get symbol and timeframe
      const zoneSearchResponse = await fetch(`/api/stocks/searchzoneid?zone_id=${zoneId}`);
      const zoneSearchData = await zoneSearchResponse.json();
      console.log("ZONE SEARCH TEST: ", zoneSearchData);

      if (!zoneSearchData.success) {
        setError(zoneSearchData.error || `Zone ${zoneId} not found`);
        setStockData(null);
        setZonesData(null);
        setFetching(false);
        return;
      }

      const { symbol, timeframe: timeframeLabel } = zoneSearchData.data;
      console.log(`Zone ${zoneId} found: Symbol=${symbol}, Timeframe=${timeframeLabel}`);

      // Step 2: Get limit and hours from timeframe using the same maps as handleTimeframeChange
      const timeframeMap: Record<string, string> = {
        "2min": "2m", "3min": "3m", "5min": "5m", "6min": "6m", "10min": "10m",
        "13min": "13m", "15min": "15m", "26min": "26m", "30min": "30m", "39min": "39m",
        "65min": "65m", "78min": "78m", "130min": "130m", "195min": "195m",
        "daily": "1d", "5d": "5d", "22d": "22d", "65d": "65d",
      };
      const limitMap: Record<string, number> = {
        "2min": 5850, "3min": 3900, "5min": 2340, "6min": 3900, "10min": 1755,
        "13min": 1800, "15min": 1560, "26min": 1350, "30min": 1170, "39min": 1800,
        "65min": 1080, "78min": 900, "130min": 1095, "195min": 730,
        "daily": 1095, "5d": 438, "22d": 249, "65d": 85,
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

      console.log(`Updated UI: symbol=${symbol}, timeframe=${timeframeValue}, limit=${newLimit}, hours=${newHours}`);

      // Step 4: Call the existing fetchStockData function with the new values
      // Pass the values directly since state updates are async
      await fetchStockData(symbol, timeframeValue, newLimit, newHours);

    } catch (err: any) {
      setError(`Error fetching data: ${err.message}`);
      setStockData(null);
      setZonesData(null);
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
    const limitMap: Record<string, number> = {
      "2min": 5850,
      "3min": 3900,
      "5min": 2340,
      "6min": 3900,
      "10min": 1755,
      "13min": 1800,
      "15min": 1560,
      "26min": 1350,
      "30min": 1170,
      "39min": 1800,
      "65min": 1080,
      "78min": 900,
      "130min": 1095,
      "195min": 730,
      "daily": 1095,
      "5d": 438,
      "22d": 249,
      "65d": 85,
    };
    const hoursMap: Record<string, number> = {
      "2min": 720,
      "3min": 720,
      "5min": 720,
      "6min": 1440,
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

      // Step 1: Fetch all data for this zone (symbol, timeframe, aggregates, zones)
      await fetchStockDataWithZoneID(zoneId);

      // Step 2: Set pending zone to snap to
      // The useEffect watching zonesData will handle the actual snapping
      pendingZoneSnapRef.current = zoneId;
      console.log(`Set pending zone snap to ${zoneId}`);

      // Clear the search query
      setZoneSearchQuery('');
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

      // Fit content to view
      chart.timeScale().fitContent();

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

            // Attach primitive to the series
            candlestickSeries.attachPrimitive(zonePrimitive);
            zonePrimitivesRef.current.push(zonePrimitive);
          } catch (err) {
            console.error(`Error creating zone primitive:`, err);
          }
        });
      }

      // Add crosshair move handler for zone tooltips
      chart.subscribeCrosshairMove((param) => {
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

              // Clear the pending snap
              pendingZoneSnapRef.current = null;
            } catch (err) {
              console.error('Error snapping to zone:', err);
              pendingZoneSnapRef.current = null;
            }
          }, 200);
        } else {
          console.warn(`Zone ${zoneId} not found in zones data`);
          pendingZoneSnapRef.current = null;
        }
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

        chart.remove();
        chartInstanceRef.current = null;
      };
    } catch (err) {
      console.error('Error initializing chart:', err);
    }
  }, [stockData, zonesData]);

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
          {/* Center: Chart and Stats Area */}
          <div className="flex-1 flex flex-col">
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
                  <div className="flex gap-1">
                    {['Candles', 'Line', 'Area'].map((type) => (
                      <button key={type} className="px-3 py-1 text-xs bg-background hover:bg-elevated border border-border rounded text-secondary hover:text-primary transition-colors">
                        {type}
                      </button>
                    ))}
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
              {stockData ? [
                { label: 'Volume 24h', value: `${((Number(stockData.volume_24h) || 0) / 1_000_000).toFixed(1)}M`, change: `Shares`, up: true },
                { label: 'High 24h', value: `$${Number(stockData.high_24h).toFixed(2)}`, change: `+${((Number(stockData.high_24h) - Number(stockData.latest_price)) / Number(stockData.latest_price) * 100).toFixed(2)}%`, up: Number(stockData.high_24h) > Number(stockData.latest_price) },
                { label: 'Low 24h', value: `$${Number(stockData.low_24h).toFixed(2)}`, change: `${((Number(stockData.low_24h) - Number(stockData.latest_price)) / Number(stockData.latest_price) * 100).toFixed(2)}%`, up: Number(stockData.low_24h) < Number(stockData.latest_price) },
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
