"use client";

import {
  BarChart3, Bell, Bot, Home, LogOut, Settings, TrendingUp, Activity,
  LineChart, PieChart, Wallet, Target, Zap, Lock, Crown, ArrowRight,
  MessageSquare, Send, X
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect } from "react";

interface UserInfo {
  name: string;
  email: string;
  role: "free" | "paid" | "admin";
}

export default function DashboardPage() {
  const [chatOpen, setChatOpen] = useState(true);
  const [user, setUser] = useState<UserInfo>({ name: "User", email: "user@example.com", role: "free" });
  const [loading, setLoading] = useState(true);

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

  const isLocked = user.role === "free";

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      {/* Left Sidebar - TradingView style */}
      <aside className="w-16 bg-panel border-r border-border/30 flex flex-col items-center py-4 gap-2">
        {/* Logo */}
        <Link href="/" className="w-10 h-10 bg-gradient-to-br from-accent to-accent-dark rounded flex items-center justify-center mb-4">
          <Activity className="h-5 w-5 text-white" />
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
              <span className="text-sm font-medium text-primary">BTC/USD</span>
              <span className="text-lg font-bold text-success">$43,521.00</span>
              <span className="text-sm text-success">+2.4%</span>
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
                {/* Simulated Chart */}
                <svg className="w-full h-full opacity-40" viewBox="0 0 800 400">
                  <defs>
                    <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="rgb(245, 158, 11)" stopOpacity="0.4"/>
                      <stop offset="100%" stopColor="rgb(245, 158, 11)" stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                  {/* Grid lines */}
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <line key={i} x1="0" y1={i * 80} x2="800" y2={i * 80} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
                  ))}
                  {/* Price line */}
                  <path
                    d="M 0 300 Q 100 250, 200 280 T 400 200 T 600 160 T 800 120"
                    stroke="rgb(245, 158, 11)"
                    strokeWidth="2"
                    fill="none"
                  />
                  <path
                    d="M 0 300 Q 100 250, 200 280 T 400 200 T 600 160 T 800 120 L 800 400 L 0 400 Z"
                    fill="url(#chartGrad)"
                  />
                </svg>

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
              {[
                { label: 'Volume 24h', value: '$1.2M', change: '+12.4%', up: true },
                { label: 'High 24h', value: '$43,800', change: '+2.1%', up: true },
                { label: 'Low 24h', value: '$42,100', change: '-1.2%', up: false },
                { label: 'Market Cap', value: '$821B', change: '+5.3%', up: true },
              ].map((stat, i) => (
                <div key={i} className="bg-panel border border-border rounded-lg p-4">
                  <div className="text-xs text-secondary mb-1">{stat.label}</div>
                  <div className="text-lg font-bold text-primary mb-1">{stat.value}</div>
                  <div className={`text-xs ${stat.up ? 'text-success' : 'text-red-500'}`}>
                    {stat.change}
                  </div>
                </div>
              ))}
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
                    Hello! I'm your AI trading assistant. How can I help you today?
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
                  </>
                )}
              </div>

              {/* Chat Input */}
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
