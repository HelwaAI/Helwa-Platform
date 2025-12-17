"use client";

import { useEffect, useState } from 'react';
import { TrendingUp, Calendar } from 'lucide-react';
import Link from 'next/link';

interface TopPerformer {
  symbol: string;
  zone_id: number;
  bounce_close: number;
  return_5d: number;
  bounce_day: string;
  zone_type: string;
}

export default function TopPerformers() {
  const [performers, setPerformers] = useState<TopPerformer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTopPerformers() {
      try {
        const response = await fetch('/api/stocks/top-performers');
        const result = await response.json();

        if (result.success) {
          setPerformers(result.data);
        } else {
          setError(result.error);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchTopPerformers();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent"></div>
      </div>
    );
  }

  if (error || performers.length === 0) {
    return null; // Silently fail - don't show error on landing page
  }
  // Showing Top 3 alerts.
  return (
    <section className="py-24 px-6 lg:px-8 bg-panel/20 border-y border-border/30">
      <div className="max-w-[1400px] mx-auto">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/30 rounded-full mb-6">
            <TrendingUp className="h-4 w-4 text-accent" />
            <span className="text-sm font-bold text-accent">Live Performance</span>
          </div>
          <h2 className="text-4xl lg:text-5xl font-black mb-4 text-primary tracking-tight">
            Top Performers
          </h2>
          <p className="text-lg text-secondary">
            Alerts from the past month
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {performers.map((performer, index) => {
            // Parse numeric values from API response (PostgreSQL returns as strings)
            const bounceClose = parseFloat(performer.bounce_close as any);
            const return5d = parseFloat(performer.return_5d as any);
            const returnPercent = return5d.toFixed(2);
            const bounceDate = new Date(performer.bounce_day).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            });

            return (
              <Link
                key={performer.symbol}
                href={`/dashboard?zoneId=${performer.zone_id}`}
                className="block relative bg-panel border border-border hover:border-accent/50 rounded-2xl p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-accent/10 group overflow-hidden cursor-pointer hover:scale-[1.02]"
              >
                {/* Gradient overlay on hover */}
                <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

                {/* Rank badge */}
                <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                  <span className="text-sm font-bold text-accent">#{index + 1}</span>
                </div>

                <div className="relative z-10">
                  {/* Symbol */}
                  <div className="mb-4">
                    <h3 className="text-3xl font-black text-primary mb-1">{performer.symbol}</h3>
                    <div className="flex items-center gap-2 text-sm text-secondary">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>Alerted {bounceDate}</span>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="space-y-4 mb-6">
                    <div className="flex justify-between items-center pb-3 border-b border-border/50">
                      <span className="text-sm text-secondary font-medium">Entry Price</span>
                      <span className="text-lg font-bold text-primary">
                        ${bounceClose.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center">
                      <span className="text-sm text-secondary font-medium">5-Day Return</span>
                      <div className="flex items-center gap-1.5">
                        <TrendingUp className="h-4 w-4 text-success" />
                        <span className="text-2xl font-black text-success">
                          +{returnPercent}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Zone type badge */}
                  <div className="inline-flex items-center px-3 py-1.5 bg-success/10 border border-success/30 rounded-lg">
                    <span className="text-xs font-bold text-success uppercase tracking-wide">
                      {performer.zone_type} Zone
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Disclaimer */}
        <div className="mt-12 text-center">
          <p className="text-sm text-secondary/70">
            Past performance does not guarantee future results. Data refreshed from live trading signals.
          </p>
        </div>
      </div>
    </section>
  );
}
