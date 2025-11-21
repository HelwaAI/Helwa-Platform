# Dashboard Stock Aggregates Integration Guide

This guide shows how to integrate real-time stock aggregates from your PostgreSQL database into the Next.js trading dashboard.

## Overview

The integration connects your production trading system's PostgreSQL database to a Next.js dashboard with:
- **Real-time stock data** from `stocks.minute_aggregates` table
- **Auto-refresh** every 15 seconds (matching production orchestrator)
- **Universe integration** showing current trading universe
- **Live statistics** (Volume, High/Low, VWAP, Price Changes)
- **Fast updates** with efficient database queries

## Architecture

```
PostgreSQL Database (stocks schema)
    ↓
API Route (/api/stocks/aggregates)
    ↓
Next.js Dashboard Component
    ↓
Auto-refresh every 15 seconds
```

## Implementation

### 1. API Endpoint Setup

Create the API route to fetch stock data from PostgreSQL.

**File: `app/api/stocks/aggregates/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import pkg from 'pg';
const { Pool } = pkg;

// Create PostgreSQL connection pool
const pool = new Pool({
  host: process.env.POSTGRES_HOST || '4.246.103.56',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'helwaadmin',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'trading_data',
  ssl: false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get('symbols')?.split(',') || [];
  const limit = parseInt(searchParams.get('limit') || '50');

  try {
    // Query stock aggregates from your stocks schema
    const query = `
      SELECT
        s.symbol,
        s.name as company_name,
        ma.timestamp,
        ma.open,
        ma.high,
        ma.low,
        ma.close,
        ma.volume,
        ma.dollar_volume,
        ma.vwap,
        ma.trade_count
      FROM stocks.minute_aggregates ma
      JOIN stocks.symbols s ON ma.symbol_id = s.id
      WHERE
        ${symbols.length > 0 ? 's.symbol = ANY($1) AND' : ''}
        ma.timestamp >= NOW() - INTERVAL '24 hours'
      ORDER BY ma.timestamp DESC
      LIMIT $${symbols.length > 0 ? '2' : '1'}
    `;

    const params = symbols.length > 0 ? [symbols, limit] : [limit];
    const result = await pool.query(query, params);

    // Group by symbol for easier frontend processing
    const groupedData: Record<string, any[]> = {};
    result.rows.forEach(row => {
      if (!groupedData[row.symbol]) {
        groupedData[row.symbol] = [];
      }
      groupedData[row.symbol].push(row);
    });

    // Calculate summary stats for each symbol
    const summaries = Object.entries(groupedData).map(([symbol, data]) => {
      const latest = data[0];
      const earliest = data[data.length - 1];
      const change = latest.close - earliest.open;
      const changePercent = (change / earliest.open) * 100;

      return {
        symbol,
        company_name: latest.company_name,
        latest_price: latest.close,
        change,
        change_percent: changePercent,
        volume_24h: data.reduce((sum, d) => sum + d.volume, 0),
        dollar_volume_24h: data.reduce((sum, d) => sum + d.dollar_volume, 0),
        high_24h: Math.max(...data.map(d => d.high)),
        low_24h: Math.min(...data.map(d => d.low)),
        vwap: latest.vwap,
        bars: data.reverse(), // Chronological order for charts
        last_updated: latest.timestamp,
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

// Endpoint for current universe symbols
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const action = body.action;

    if (action === 'get_universe') {
      // Get current universe from your system
      const query = `
        SELECT DISTINCT s.symbol, s.name
        FROM stocks.symbols s
        JOIN stocks.universe_history uh ON s.id = uh.symbol_id
        WHERE uh.action = 'added'
        AND NOT EXISTS (
          SELECT 1 FROM stocks.universe_history uh2
          WHERE uh2.symbol_id = s.id
          AND uh2.action = 'removed'
          AND uh2.created_at > uh.created_at
        )
        ORDER BY s.symbol
      `;

      const result = await pool.query(query);

      return NextResponse.json({
        success: true,
        symbols: result.rows,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
```

### 2. Dashboard Component

Update your dashboard page to fetch and display stock aggregates.

**File: `app/dashboard/page.tsx`**

```typescript
"use client";

import {
  BarChart3, Bell, Bot, Home, LogOut, Settings, TrendingUp, Activity,
  LineChart, PieChart, Wallet, Target, Zap, Lock, Crown, ArrowRight,
  MessageSquare, Send, X, RefreshCw
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

interface StockAggregate {
  symbol: string;
  company_name: string;
  latest_price: number;
  change: number;
  change_percent: number;
  volume_24h: number;
  dollar_volume_24h: number;
  high_24h: number;
  low_24h: number;
  vwap: number;
  bars: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    dollar_volume: number;
  }>;
  last_updated: string;
}

interface UserInfo {
  name: string;
  email: string;
  role: "free" | "paid" | "admin";
}

export default function DashboardPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [user, setUser] = useState<UserInfo>({ name: "User", email: "user@example.com", role: "free" });
  const [loading, setLoading] = useState(true);
  const [stockData, setStockData] = useState<StockAggregate[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("AAPL");
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Fetch user info
  useEffect(() => {
    fetch('/.auth/me')
      .then(res => res.json())
      .then(data => {
        if (data && data[0]) {
          const claims = data[0].user_claims || [];
          const name = claims.find((c: any) => c.typ === 'name')?.val || 'User';
          const email = claims.find((c: any) => c.typ.includes('emailaddress'))?.val || 'user@example.com';
          setUser({ name, email, role: "free" });
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  // Fetch stock aggregates
  const fetchStockData = async () => {
    try {
      setRefreshing(true);
      // Fetch universe symbols first
      const universeRes = await fetch('/api/stocks/aggregates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_universe' }),
      });
      const universeData = await universeRes.json();

      if (universeData.success && universeData.symbols.length > 0) {
        const symbols = universeData.symbols.map((s: any) => s.symbol).slice(0, 10); // Top 10

        // Fetch aggregates for these symbols
        const res = await fetch(`/api/stocks/aggregates?symbols=${symbols.join(',')}&limit=100`);
        const data = await res.json();

        if (data.success) {
          setStockData(data.data);
          if (!selectedSymbol && data.data.length > 0) {
            setSelectedSymbol(data.data[0].symbol);
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch stock data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchStockData();
  }, []);

  // Auto-refresh every 15 seconds (matching your production system)
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchStockData();
    }, 15000); // 15 seconds

    return () => clearInterval(interval);
  }, [autoRefresh]);

  const isLocked = user.role === "free";
  const selectedStock = stockData.find(s => s.symbol === selectedSymbol);

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Left Sidebar - TradingView style */}
      <aside className="w-16 bg-panel border-r border-border/30 flex flex-col items-center py-4 gap-2">
        <Link href="/" className="w-10 h-10 bg-gradient-to-br from-accent to-accent-dark rounded flex items-center justify-center mb-4">
          <Activity className="h-5 w-5 text-white" />
        </Link>

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
                {selectedStock?.symbol || 'Loading...'}
              </span>
              <span className="text-lg font-bold text-success">
                ${selectedStock?.latest_price.toFixed(2) || '0.00'}
              </span>
              <span className={`text-sm ${selectedStock && selectedStock.change >= 0 ? 'text-success' : 'text-red-500'}`}>
                {selectedStock ? `${selectedStock.change >= 0 ? '+' : ''}${selectedStock.change_percent.toFixed(2)}%` : '0.00%'}
              </span>
            </div>

            {/* Refresh Controls */}
            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={fetchStockData}
                disabled={refreshing}
                className="p-1.5 hover:bg-elevated rounded transition-colors disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw className={`h-4 w-4 text-secondary ${refreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  autoRefresh
                    ? 'bg-success/10 text-success border border-success/30'
                    : 'bg-elevated text-secondary border border-border'
                }`}
              >
                Auto {autoRefresh ? 'ON' : 'OFF'}
              </button>
              <span className="text-xs text-secondary">
                {selectedStock?.last_updated ? new Date(selectedStock.last_updated).toLocaleTimeString() : ''}
              </span>
            </div>
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
                <div className="font-medium text-primary">{user.name}</div>
                <div className="text-xs text-secondary">{user.email}</div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Dashboard Grid */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Stock List */}
          <div className="w-64 bg-panel border-r border-border overflow-y-auto">
            <div className="p-3 border-b border-border">
              <h3 className="text-sm font-medium text-primary mb-2">Active Universe</h3>
              <div className="text-xs text-secondary">{stockData.length} stocks</div>
            </div>
            <div className="divide-y divide-border">
              {stockData.map((stock) => (
                <button
                  key={stock.symbol}
                  onClick={() => setSelectedSymbol(stock.symbol)}
                  className={`w-full p-3 text-left hover:bg-elevated transition-colors ${
                    selectedSymbol === stock.symbol ? 'bg-accent/5 border-l-2 border-accent' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-primary text-sm">{stock.symbol}</span>
                    <span className={`text-xs font-medium ${stock.change >= 0 ? 'text-success' : 'text-red-500'}`}>
                      {stock.change >= 0 ? '+' : ''}{stock.change_percent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-secondary truncate mr-2">{stock.company_name}</span>
                    <span className="text-xs font-medium text-primary">${stock.latest_price.toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-secondary mt-1">
                    Vol: ${(stock.dollar_volume_24h / 1_000_000).toFixed(1)}M
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Center: Chart Area */}
          <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
            {/* Chart Container */}
            <div className="flex-1 bg-panel border border-border rounded-lg relative overflow-hidden min-h-[500px]">
              {/* Chart Header */}
              <div className="bg-elevated p-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-4">
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

              {/* Chart Content - Embed your Plotly charts here */}
              <div className="h-full p-6 relative">
                {selectedStock && selectedStock.bars.length > 0 ? (
                  <div className="w-full h-full">
                    {/* You can embed your existing Plotly/multi-stock dashboard charts here */}
                    <iframe
                      src={`/charts/${selectedSymbol}_15min.html`}
                      className="w-full h-full border-0"
                      title={`${selectedSymbol} Chart`}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-secondary">
                    Loading chart data...
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
                        Upgrade to Pro to access real-time charts, advanced indicators, and AI-powered insights.
                      </p>
                      <Link
                        href="/#pricing"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium transition-all"
                      >
                        <Crown className="h-5 w-5" />
                        Upgrade to Pro - $49/mo
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Stats Grid */}
            <div className="grid grid-cols-4 gap-4">
              {selectedStock ? [
                { label: 'Volume 24h', value: `$${(selectedStock.dollar_volume_24h / 1_000_000).toFixed(1)}M`, change: `${selectedStock.volume_24h.toLocaleString()} shares`, up: true },
                { label: 'High 24h', value: `$${selectedStock.high_24h.toFixed(2)}`, change: `+${((selectedStock.high_24h - selectedStock.latest_price) / selectedStock.latest_price * 100).toFixed(2)}%`, up: selectedStock.high_24h > selectedStock.latest_price },
                { label: 'Low 24h', value: `$${selectedStock.low_24h.toFixed(2)}`, change: `${((selectedStock.low_24h - selectedStock.latest_price) / selectedStock.latest_price * 100).toFixed(2)}%`, up: selectedStock.low_24h < selectedStock.latest_price },
                { label: 'VWAP', value: `$${selectedStock.vwap.toFixed(2)}`, change: `Avg price`, up: true },
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
                  Select a stock to view statistics
                </div>
              )}
            </div>
          </div>

          {/* Right: AI Chat Panel */}
          {chatOpen && (
            <div className="w-80 bg-panel border-l border-border flex flex-col relative">
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

              <div className="flex-1 p-4 overflow-y-auto space-y-4 relative">
                <div className="flex gap-2">
                  <div className="w-6 h-6 bg-accent/20 rounded flex items-center justify-center flex-shrink-0">
                    <Bot className="h-3 w-3 text-accent" />
                  </div>
                  <div className="bg-elevated rounded-lg p-3 text-sm text-primary max-w-[85%]">
                    Hello! I'm your AI trading assistant. How can I help you today?
                  </div>
                </div>

                {isLocked && (
                  <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center p-6">
                    <div className="text-center">
                      <div className="w-12 h-12 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Lock className="h-6 w-6 text-accent" />
                      </div>
                      <h4 className="text-lg font-bold mb-2 text-primary">AI Chat Locked</h4>
                      <p className="text-sm text-secondary mb-4">
                        Upgrade to Pro to chat with our AI assistant
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
                )}
              </div>

              <div className="p-4 border-t border-border">
                <div className={`flex gap-2 ${isLocked ? 'opacity-40 pointer-events-none' : ''}`}>
                  <input
                    type="text"
                    placeholder={isLocked ? "Upgrade to chat..." : "Ask me anything..."}
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
```

### 3. Environment Variables

Add to your `.env.local` file:

```bash
POSTGRES_HOST=4.246.103.56
POSTGRES_PORT=5432
POSTGRES_USER=helwaadmin
POSTGRES_PASSWORD=UmmahRocket666
POSTGRES_DB=trading_data
```

### 4. Install Dependencies

```bash
npm install pg
npm install --save-dev @types/pg
```

## Key Features

### Real-time Data
- **Auto-refresh**: Updates every 15 seconds (matching production orchestrator)
- **Manual refresh**: Click refresh button anytime
- **Toggle auto-refresh**: Turn on/off as needed

### Stock Universe Integration
- **Current universe**: Shows stocks from `stocks.universe_history`
- **Live updates**: Reflects changes from `StockUniverseManager`
- **Click to select**: Choose any stock from the universe

### Live Statistics
- **Volume 24h**: Total dollar volume and share count
- **High/Low 24h**: Intraday range with percentage changes
- **VWAP**: Volume-weighted average price
- **Price Change**: Real-time price with change percentage

### Performance Optimization
- **Efficient queries**: Single query fetches all needed data
- **Grouped results**: Data pre-processed on backend
- **Connection pooling**: Reuses database connections
- **Minimal re-renders**: React state optimized

## Chart Integration

The dashboard is ready to embed your existing Plotly HTML charts:

```typescript
<iframe
  src={`/charts/${selectedSymbol}_15min.html`}
  className="w-full h-full border-0"
  title={`${selectedSymbol} Chart`}
/>
```

**Chart location**: Place your generated HTML charts in the `public/charts/` directory with naming pattern `{SYMBOL}_{TIMEFRAME}.html`

**Example**:
- `public/charts/AAPL_15min.html`
- `public/charts/MSFT_15min.html`
- `public/charts/GOOGL_5min.html`

## Database Schema

The integration uses these tables from your `stocks` schema:

```sql
-- Stock aggregates (minute-level data)
stocks.minute_aggregates
  ├── symbol_id (FK → stocks.symbols.id)
  ├── timestamp
  ├── open, high, low, close
  ├── volume, dollar_volume
  ├── vwap
  └── trade_count

-- Symbol metadata
stocks.symbols
  ├── id
  ├── symbol
  └── name

-- Universe tracking
stocks.universe_history
  ├── symbol_id (FK → stocks.symbols.id)
  ├── action ('added' or 'removed')
  └── created_at
```

## Data Flow

```
1. Frontend component mounts
   ↓
2. Fetch current universe (POST /api/stocks/aggregates)
   ↓
3. Get top 10 symbols from universe
   ↓
4. Fetch aggregates for these symbols (GET /api/stocks/aggregates?symbols=...)
   ↓
5. Calculate summary stats (24h volume, high/low, change%)
   ↓
6. Display in UI
   ↓
7. Auto-refresh every 15 seconds
   ↓
8. Repeat steps 2-6
```

## Performance Notes

- **Query optimization**: Uses single JOIN for symbol lookup
- **24-hour window**: Only fetches recent data (reduces query time)
- **Top 10 limit**: Prevents UI overload, focuses on most active stocks
- **Connection pool**: Max 20 connections, 30s idle timeout
- **Frontend caching**: React state holds data between refreshes

## Customization

### Change refresh interval:
```typescript
const interval = setInterval(() => {
  fetchStockData();
}, 30000); // 30 seconds instead of 15
```

### Change number of stocks shown:
```typescript
const symbols = universeData.symbols.map((s: any) => s.symbol).slice(0, 20); // Show 20 stocks
```

### Add more statistics:
```typescript
{
  symbol,
  company_name: latest.company_name,
  latest_price: latest.close,
  // Add custom stats here
  avg_trade_size: data.reduce((sum, d) => sum + d.volume, 0) / data.length,
  total_trades: data.reduce((sum, d) => sum + d.trade_count, 0),
}
```

## Troubleshooting

### No data showing
- Check database connection in Azure
- Verify environment variables in `.env.local`
- Check console for API errors
- Ensure `stocks.minute_aggregates` has recent data

### Slow performance
- Reduce number of symbols fetched
- Increase refresh interval
- Add database indexes on `timestamp` and `symbol_id`

### Charts not loading
- Verify chart files exist in `public/charts/`
- Check chart filename matches pattern `{SYMBOL}_{TIMEFRAME}.html`
- Ensure charts are generated from your Python system

## Integration with Production System

This dashboard integrates seamlessly with your production trading system:

- **Shared database**: Uses same PostgreSQL database as production orchestrator
- **Same refresh rate**: 15-second intervals match production minute data updates
- **Universe sync**: Shows same stocks as `StockUniverseManager`
- **Real-time accuracy**: Data is as fresh as production system's minute aggregates

## Next Steps

1. **Deploy API route** to production environment
2. **Test with production database** (verify connectivity)
3. **Add WebSocket support** for sub-second updates (optional)
4. **Integrate Plotly charts** from your existing dashboard generator
5. **Add user authentication** to restrict access
6. **Monitor performance** and optimize queries as needed

## Related Documentation

- `src/visualization/templates/multi_stock_dashboard.html` - Existing Plotly dashboard
- `production_orchestrator.py:1279-1320` - Minute data update loop
- `database/schema/stocks_tables.sql` - Database schema
- `CLAUDE.md` - Full system architecture
