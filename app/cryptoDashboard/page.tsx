"use client";

import {
  BarChart3, Bell, Bot, Home, LogOut, Settings, TrendingUp, Activity,
  LineChart, PieChart, Wallet, Target, Zap, Lock, Crown, ArrowRight,
  MessageSquare, Send, X, Search, Coins
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { createChart, CandlestickSeries } from "lightweight-charts";

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

  // TEMPORARILY COMMENTED OUT FOR LOCAL DEVELOPMENT
  // Uncomment lines 47-66 below to restore Azure Easy Auth
  /*
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
  */

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
      const aggregatesResponse = await fetch(`/api/crypto/aggregates?symbols=${symbol.toUpperCase()}&limit=50000`);
      const aggregatesData = await aggregatesResponse.json();

      // Fetch zones data
      const zonesResponse = await fetch(`/api/crypto/zones?symbols=${symbol.toUpperCase()}&limit=100`);
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

  // Initialize candlestick chart when cryptoData changes
  useEffect(() => {
    console.log('Chart effect triggered - cryptoData:', cryptoData?.symbol, 'zonesData:', zonesData?.symbol);
    if (!cryptoData || !chartContainerRef.current) return;

    try {
      // Create chart
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight,
      });

      // Add candlestick series
      const candlestickSeries = chart.addSeries(CandlestickSeries);

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

      // Function to update zone positions when chart changes
      const updateZonePositions = () => {
        // Clear existing zone overlays
        const existingZones = chartContainerRef.current?.querySelectorAll('.zone-overlay');
        existingZones?.forEach(el => el.remove());
      
        // Re-render zones at new positions
        if (zonesData && zonesData.zones && candleData.length > 0) {
          const timeScale = chart.timeScale();
          const chartWidth = chartContainerRef.current?.clientWidth || 0;
          
          zonesData.zones.forEach((zone: any, index: number) => {
            try {
              const topPrice = parseFloat(zone.top_price);
              const bottomPrice = parseFloat(zone.bottom_price);
      
              // Convert start_time to Unix timestamp in seconds
              const zoneStartTime = Math.floor(new Date(zone.start_time).getTime() / 1000);
              
              // Convert end_time to Unix timestamp if it exists (null means zone extends to current time)
              const zoneEndTime = zone.end_time 
                ? Math.floor(new Date(zone.end_time).getTime() / 1000)
                : null;
      
              // Convert time to pixel coordinates (X axis)
              const startX = timeScale.timeToCoordinate(zoneStartTime as any);
              const endX = zoneEndTime 
                ? timeScale.timeToCoordinate(zoneEndTime as any)
                : chartWidth; // If no end_time, extend to right edge
      
              // Convert prices to pixel coordinates (Y axis) using candlestick series
              const topY = candlestickSeries.priceToCoordinate(topPrice);
              const bottomY = candlestickSeries.priceToCoordinate(bottomPrice);
      
              // Only render if zone is visible and coordinates are valid
              if (startX !== null && topY !== null && bottomY !== null) {
                // Calculate zone width
                const zoneWidth = endX !== null 
                  ? Math.max(0, endX - startX)  // Use actual end position if available
                  : chartWidth - startX;         // Otherwise extend to chart edge
      
                // Skip if zone is completely off-screen
                if (startX > chartWidth || (endX !== null && endX < 0)) {
                  return;
                }
      
                const zoneHeight = Math.abs(bottomY - topY);
                const zoneTop = Math.min(topY, bottomY);
      
                const zoneElement = document.createElement('div');
                zoneElement.className = `zone-overlay zone-${zone.zone_type}`;
      
                // Determine color based on zone_type
                const isSupply = zone.zone_type === 'supply';
                const bgColor = isSupply ? 'rgba(236, 72, 153, 0.15)' : 'rgba(16, 185, 129, 0.15)';
                const borderColor = isSupply ? 'rgba(236, 72, 153, 0.4)' : 'rgba(16, 185, 129, 0.4)';
      
                zoneElement.style.position = 'absolute';
                zoneElement.style.left = `${Math.max(0, startX)}px`; // Clip to chart left edge
                zoneElement.style.top = `${zoneTop}px`;
                zoneElement.style.width = `${zoneWidth}px`;
                zoneElement.style.height = `${zoneHeight}px`;
                zoneElement.style.backgroundColor = bgColor;
                zoneElement.style.border = `1px solid ${borderColor}`;
                zoneElement.style.borderLeft = `2px solid ${borderColor}`;
                zoneElement.style.pointerEvents = 'none';
                zoneElement.style.zIndex = '1';
                zoneElement.style.display = 'flex';
                zoneElement.style.alignItems = 'center';
                zoneElement.style.paddingLeft = '8px';
      
                // Add zone_id text
                zoneElement.innerHTML = `<span style="color: ${borderColor}; font-size: 12px; font-weight: 500; pointer-events: none;">Zone ${zone.zone_id}</span>`;
      
                // Add tooltip on hover
                const startTimeStr = new Date(zone.start_time).toLocaleString();
                const endTimeStr = zone.end_time ? ` to ${new Date(zone.end_time).toLocaleString()}` : ' (active)';
                zoneElement.title = `${zone.zone_type.toUpperCase()} Zone - $${bottomPrice.toFixed(2)} to $${topPrice.toFixed(2)}\n${startTimeStr}${endTimeStr}`;
      
                chartContainerRef.current?.appendChild(zoneElement);
      
                // // Debug logging
                // console.log(`Zone ${zone.zone_id} rendered:`, {
                //   type: zone.zone_type,
                //   startTime: zone.start_time,
                //   endTime: zone.end_time,
                //   topPrice,
                //   bottomPrice,
                //   startX,
                //   endX,
                //   zoneWidth
                // });
              }
            } catch (zoneErr) {
              console.error(`Error rendering zone ${index}:`, zoneErr);
            }
          });
        }
      };

      // Initial zone rendering
      updateZonePositions();

      // Fit content to view
      chart.timeScale().fitContent();

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

      // Subscribe to chart changes to update zones
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        updateZonePositions();
      });

      return () => {
        window.removeEventListener('resize', handleResize);
        chart.remove();
      };
    } catch (err) {
      console.error('Error initializing chart:', err);
    }
  }, [cryptoData]);

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
            className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
              item.active
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
          {/* Center: Chart Area */}
          <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
            {/* Chart Container */}
            <div className="flex-1 bg-panel border border-border rounded-lg relative overflow-hidden min-h-[500px]">
              {/* Chart Header */}
              <div className="bg-elevated p-3 border-b border-border flex items-center justify-between">
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
                  <select className="bg-background border border-border rounded px-3 py-1.5 text-sm text-primary">
                    <option>1m</option>
                    <option>5m</option>
                    <option>15m</option>
                    <option>1h</option>
                    <option>4h</option>
                    <option>1d</option>
                  </select>
                  <div className="flex gap-1">
                    {['Candles', 'Line', 'Area'].map((type) => (
                      <button key={type} className="px-3 py-1 text-xs bg-background hover:bg-elevated border border-border rounded text-secondary hover:text-primary transition-colors">
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="p-1.5 hover:bg-elevated rounded transition-colors">
                    <BarChart3 className="h-4 w-4 text-secondary" />
                  </button>
                  <button className="p-1.5 hover:bg-elevated rounded transition-colors">
                    <Settings className="h-4 w-4 text-secondary" />
                  </button>
                </div>
              </div>

              {/* Chart Content */}
              <div className="h-full p-6 relative">
                {/* Lightweight Charts Container */}
                <div
                  ref={chartContainerRef}
                  className="w-full h-full"
                />

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

            {/* Bottom Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              {cryptoData ? [
                { label: 'Volume 24h', value: `${(Number(cryptoData.volume_24h) / 1_000_000).toFixed(1)}M`, change: `Shares`, up: true },
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
