"use client";

import { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Settings,
  TrendingUp,
  TrendingDown,
  DollarSign,
  BarChart2,
  Calendar,
  ArrowLeft,
  RefreshCw,
  Download,
  Target,
  Shield,
  Percent,
  Activity,
  Clock
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface BacktestConfig {
  symbol: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  risk_per_trade: number;
  max_positions: number;
  min_risk_reward: number;
  holding_period: number;
}

interface Trade {
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
  trades: Trade[];
  equity_curve: Array<[string, number]>;
}

interface SymbolOption {
  symbol: string;
  id: number;
  name: string;
}

export default function BacktestPage() {
  const router = useRouter();
  const [config, setConfig] = useState<BacktestConfig>({
    symbol: 'AAPL',
    start_date: '',
    end_date: '',
    initial_capital: 100000,
    risk_per_trade: 0.02,
    max_positions: 5,
    min_risk_reward: 3.0,
    holding_period: 5,
  });

  const [symbols, setSymbols] = useState<SymbolOption[]>([]);
  const [dateRange, setDateRange] = useState<{ min: string; max: string } | null>(null);
  const [results, setResults] = useState<BacktestResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<string>('');

  // Navigate to dashboard and snap to zone
  const navigateToTrade = (trade: Trade) => {
    // Build URL with zone snap parameters
    // Dashboard expects 'zoneId' (camelCase) to auto-trigger zone search
    const params = new URLSearchParams({
      zoneId: trade.zone_id.toString(),
    });
    router.push(`/dashboard?${params.toString()}`);
  };

  // Fetch available symbols on mount
  useEffect(() => {
    fetchSymbols();
  }, []);

  // Fetch date range when symbol changes
  useEffect(() => {
    if (config.symbol) {
      fetchDateRange(config.symbol);
    }
  }, [config.symbol]);

  const fetchSymbols = async () => {
    try {
      const response = await fetch('/api/stocks/backtest?action=symbols');
      const data = await response.json();
      if (data.success) {
        setSymbols(data.symbols);
      }
    } catch (err) {
      console.error('Failed to fetch symbols:', err);
    }
  };

  const fetchDateRange = async (symbol: string) => {
    try {
      const response = await fetch(`/api/stocks/backtest?action=date-range&symbol=${symbol}`);
      const data = await response.json();
      if (data.success) {
        setDateRange({ min: data.min_date, max: data.max_date });
        // Set default dates
        if (!config.start_date || !config.end_date) {
          setConfig(prev => ({
            ...prev,
            start_date: data.min_date,
            end_date: data.max_date
          }));
        }
      } else {
        setDateRange(null);
      }
    } catch (err) {
      console.error('Failed to fetch date range:', err);
      setDateRange(null);
    }
  };

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch('/api/stocks/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await response.json();

      if (data.success) {
        setResults(data.results);
        setEngine(data.engine);
      } else {
        setError(data.error || 'Backtest failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to run backtest');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  return (
    <div className="min-h-screen bg-background text-primary">
      {/* Header */}
      <header className="border-b border-elevated px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-secondary hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <BarChart2 className="w-6 h-6 text-accent" />
              Retest Strategy Backtester
            </h1>
          </div>
          <div className="text-sm text-secondary">
            {engine && <span className="px-2 py-1 bg-elevated rounded">Engine: {engine}</span>}
          </div>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row">
        {/* Configuration Panel */}
        <aside className="w-full lg:w-80 border-b lg:border-b-0 lg:border-r border-elevated p-4 lg:p-6 space-y-4 lg:space-y-6 lg:min-h-[calc(100vh-65px)] lg:sticky lg:top-0 lg:overflow-y-auto">
          <div className="space-y-4">
            <h2 className="text-lg font-medium flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Configuration
            </h2>

            {/* Symbol Selection */}
            <div>
              <label className="block text-sm text-secondary mb-1">Symbol</label>
              <select
                value={config.symbol}
                onChange={(e) => setConfig({ ...config, symbol: e.target.value })}
                className="w-full bg-elevated border border-panel rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
              >
                {symbols.map((s) => (
                  <option key={s.symbol} value={s.symbol}>
                    {s.symbol} - {s.name}
                  </option>
                ))}
              </select>
              {dateRange && (
                <p className="text-xs text-secondary mt-1">
                  Data: {dateRange.min} to {dateRange.max}
                </p>
              )}
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-secondary mb-1">Start Date</label>
                <input
                  type="date"
                  value={config.start_date}
                  onChange={(e) => setConfig({ ...config, start_date: e.target.value })}
                  className="w-full bg-elevated border border-panel rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-sm text-secondary mb-1">End Date</label>
                <input
                  type="date"
                  value={config.end_date}
                  onChange={(e) => setConfig({ ...config, end_date: e.target.value })}
                  className="w-full bg-elevated border border-panel rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
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
                  value={config.initial_capital}
                  onChange={(e) => setConfig({ ...config, initial_capital: Number(e.target.value) })}
                  className="w-full bg-elevated border border-panel rounded pl-9 pr-3 py-2 text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Risk Per Trade */}
            <div>
              <label className="block text-sm text-secondary mb-1">Risk Per Trade</label>
              <div className="relative">
                <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="1"
                  value={config.risk_per_trade}
                  onChange={(e) => setConfig({ ...config, risk_per_trade: Number(e.target.value) })}
                  className="w-full bg-elevated border border-panel rounded pl-9 pr-3 py-2 text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <p className="text-xs text-secondary mt-1">{(config.risk_per_trade * 100).toFixed(0)}% of capital</p>
            </div>

            {/* Min Risk/Reward */}
            <div>
              <label className="block text-sm text-secondary mb-1">Min Risk/Reward</label>
              <div className="relative">
                <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
                <input
                  type="number"
                  step="0.5"
                  min="1"
                  max="10"
                  value={config.min_risk_reward}
                  onChange={(e) => setConfig({ ...config, min_risk_reward: Number(e.target.value) })}
                  className="w-full bg-elevated border border-panel rounded pl-9 pr-3 py-2 text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <p className="text-xs text-secondary mt-1">{config.min_risk_reward}:1 ratio</p>
            </div>

            {/* Holding Period */}
            <div>
              <label className="block text-sm text-secondary mb-1">Holding Period (Days)</label>
              <select
                value={config.holding_period}
                onChange={(e) => setConfig({ ...config, holding_period: Number(e.target.value) })}
                className="w-full bg-elevated border border-panel rounded px-3 py-2 text-primary focus:outline-none focus:border-accent"
              >
                <option value={1}>1 Day</option>
                <option value={2}>2 Days</option>
                <option value={3}>3 Days</option>
                <option value={5}>5 Days</option>
                <option value={10}>10 Days</option>
                <option value={20}>20 Days</option>
              </select>
            </div>

            {/* Run Button */}
            <button
              onClick={runBacktest}
              disabled={loading || !config.symbol || !config.start_date || !config.end_date}
              className="w-full bg-accent hover:bg-amber-600 text-background font-medium py-3 rounded flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5" />
                  Run Backtest
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Results Panel */}
        <main className="flex-1 p-4 lg:p-6 overflow-x-hidden">
          {error && (
            <div className="bg-red-900/20 border border-red-500/50 text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {!results && !loading && (
            <div className="flex flex-col items-center justify-center h-96 text-secondary">
              <BarChart2 className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-lg">Configure and run a backtest to see results</p>
              <p className="text-sm mt-2">Select a symbol and date range, then click "Run Backtest"</p>
            </div>
          )}

          {results && (
            <div className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  title="Total Trades"
                  value={results.total_trades.toString()}
                  icon={<Activity className="w-5 h-5" />}
                />
                <StatCard
                  title="Win Rate"
                  value={formatPercent(results.win_rate * 100)}
                  subtitle={`${results.winning_trades}W / ${results.losing_trades}L`}
                  icon={<Target className="w-5 h-5" />}
                  positive={results.win_rate >= 0.5}
                />
                <StatCard
                  title="Total P&L"
                  value={formatCurrency(results.total_pnl)}
                  subtitle={formatPercent(results.total_return_pct)}
                  icon={<DollarSign className="w-5 h-5" />}
                  positive={results.total_pnl >= 0}
                />
                <StatCard
                  title="Final Capital"
                  value={formatCurrency(results.final_capital)}
                  icon={<TrendingUp className="w-5 h-5" />}
                  positive={results.final_capital >= config.initial_capital}
                />
              </div>

              {/* Performance Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <MetricCard
                  title="Profit Factor"
                  value={results.profit_factor === Infinity ? "Inf" : results.profit_factor.toFixed(2)}
                  description="Gross profit / Gross loss"
                />
                <MetricCard
                  title="Sharpe Ratio"
                  value={results.sharpe_ratio.toFixed(2)}
                  description="Risk-adjusted return"
                />
                <MetricCard
                  title="Avg R-Multiple"
                  value={results.avg_r_multiple.toFixed(2) + "R"}
                  description="Average risk multiple per trade"
                />
                <MetricCard
                  title="Avg Win"
                  value={formatCurrency(results.avg_win)}
                  positive
                />
                <MetricCard
                  title="Avg Loss"
                  value={formatCurrency(results.avg_loss)}
                  positive={false}
                />
                <MetricCard
                  title="Max Drawdown"
                  value={formatPercent(results.max_drawdown_pct)}
                  description={formatCurrency(results.max_drawdown)}
                  positive={false}
                />
              </div>

              {/* Equity Curve */}
              {results.equity_curve.length > 0 && (
                <div className="bg-panel rounded-lg p-4">
                  <h3 className="text-lg font-medium mb-4">Equity Curve</h3>
                  <div className="h-64 flex items-end gap-px">
                    {results.equity_curve.map((point, i) => {
                      const min = Math.min(...results.equity_curve.map(p => p[1]));
                      const max = Math.max(...results.equity_curve.map(p => p[1]));
                      const range = max - min || 1;
                      const height = ((point[1] - min) / range) * 100;
                      const isPositive = point[1] >= config.initial_capital;

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
                    <span>{results.equity_curve[0]?.[0]}</span>
                    <span>{results.equity_curve[results.equity_curve.length - 1]?.[0]}</span>
                  </div>
                </div>
              )}

              {/* Trade List */}
              <div className="bg-panel rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-elevated flex items-center justify-between">
                  <h3 className="text-lg font-medium">Trades ({results.trades.length})</h3>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-secondary">Click a trade to view on chart</span>
                    <button className="text-secondary hover:text-primary flex items-center gap-1 text-sm">
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                  </div>
                </div>
                <div className="max-h-[500px] overflow-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="bg-elevated sticky top-0 z-10">
                      <tr>
                        <th className="text-left px-3 py-2 text-secondary font-medium whitespace-nowrap">Entry Date</th>
                        <th className="text-left px-3 py-2 text-secondary font-medium whitespace-nowrap">Exit Date</th>
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
                      {results.trades.map((trade, i) => (
                        <tr
                          key={i}
                          className="border-t border-elevated hover:bg-elevated/50 cursor-pointer transition-colors"
                          onClick={() => navigateToTrade(trade)}
                          title="Click to view on chart"
                        >
                          <td className="px-3 py-2 text-secondary whitespace-nowrap">
                            {new Date(trade.entry_time).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2 text-secondary whitespace-nowrap">
                            {trade.exit_time ? new Date(trade.exit_time).toLocaleDateString() : '-'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              trade.direction === 'Long'
                                ? 'bg-success/20 text-success'
                                : 'bg-pink-500/20 text-pink-400'
                            }`}>
                              {trade.direction}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">${trade.entry_price.toFixed(2)}</td>
                          <td className={`px-3 py-2 text-right ${
                            trade.exit_price > trade.entry_price
                              ? (trade.direction === 'Long' ? 'text-success' : 'text-red-400')
                              : trade.exit_price < trade.entry_price
                                ? (trade.direction === 'Long' ? 'text-red-400' : 'text-success')
                                : 'text-secondary'
                          }`}>
                            ${trade.exit_price.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right text-accent">${trade.target_price.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-red-400">${trade.stop_loss.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {formatCurrency(trade.capital_deployed || trade.shares * trade.entry_price)}
                          </td>
                          <td className={`px-3 py-2 text-right font-medium ${trade.pnl >= 0 ? 'text-success' : 'text-red-400'}`}>
                            {formatCurrency(trade.pnl)}
                          </td>
                          <td className={`px-3 py-2 text-right ${trade.r_multiple >= 0 ? 'text-success' : 'text-red-400'}`}>
                            {trade.r_multiple.toFixed(2)}R
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
        </main>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({
  title,
  value,
  subtitle,
  icon,
  positive
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  positive?: boolean;
}) {
  return (
    <div className="bg-panel rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-secondary text-sm">{title}</span>
        <span className={positive !== undefined ? (positive ? 'text-success' : 'text-red-400') : 'text-accent'}>
          {icon}
        </span>
      </div>
      <div className={`text-2xl font-semibold ${
        positive !== undefined ? (positive ? 'text-success' : 'text-red-400') : 'text-primary'
      }`}>
        {value}
      </div>
      {subtitle && <div className="text-sm text-secondary mt-1">{subtitle}</div>}
    </div>
  );
}

// Metric Card Component
function MetricCard({
  title,
  value,
  description,
  positive
}: {
  title: string;
  value: string;
  description?: string;
  positive?: boolean;
}) {
  return (
    <div className="bg-elevated rounded-lg p-4">
      <div className="text-secondary text-sm mb-1">{title}</div>
      <div className={`text-xl font-medium ${
        positive !== undefined ? (positive ? 'text-success' : 'text-red-400') : 'text-primary'
      }`}>
        {value}
      </div>
      {description && <div className="text-xs text-secondary mt-1">{description}</div>}
    </div>
  );
}
