import { ArrowRight, Bot, Zap, Target, Shield, Activity, LineChart, Cpu, Play, Menu, Search, Globe, User } from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation Bar - Exact TradingView Style */}
      <nav className="fixed top-0 w-full z-50">
        <div className="max-w-[2000px] mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            {/* Left Section: Logo + Search */}
            <div className="flex items-center gap-4 flex-1">
              {/* Logo + Wordmark */}
              <Link href="/" className="flex items-center gap-2 flex-shrink-0">
                <div className="w-6 h-6 bg-white rounded flex items-center justify-center">
                  <Activity className="h-4 w-4 text-black" strokeWidth={3} />
                </div>
                <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
                  Helwa AI
                </span>
              </Link>

              {/* Wide Pill-Shaped Search Bar */}
              <div className="hidden lg:flex items-center flex-1 max-w-xl">
                <div className="relative w-full">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" strokeWidth={2} />
                  <input
                    type="text"
                    placeholder="Search (⌘K)"
                    className="w-full pl-11 pr-4 py-2 bg-black/30 backdrop-blur-sm border-0 rounded-full text-sm text-white placeholder:text-white/40 focus:outline-none focus:bg-black/40 transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* Center Section: Primary Nav Links */}
            <div className="hidden xl:flex items-center gap-6 mx-8">
              <Link href="#platform" className="text-white text-sm font-medium hover:text-white/80 transition-colors whitespace-nowrap">
                Platform
              </Link>
              <Link href="#features" className="text-white text-sm font-medium hover:text-white/80 transition-colors whitespace-nowrap">
                Features
              </Link>
              <Link href="#alerts" className="text-white text-sm font-medium hover:text-white/80 transition-colors whitespace-nowrap">
                Alerts
              </Link>
              <Link href="#pricing" className="text-white text-sm font-medium hover:text-white/80 transition-colors whitespace-nowrap">
                Pricing
              </Link>
              <Link href="#docs" className="text-white text-sm font-medium hover:text-white/80 transition-colors whitespace-nowrap">
                Docs
              </Link>
            </div>

            {/* Right Section: Language + Account + CTA */}
            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Language Selector */}
              <button className="hidden md:flex items-center gap-1.5 px-2 py-1 hover:bg-white/10 rounded transition-colors">
                <Globe className="h-4 w-4 text-white" strokeWidth={1.5} />
                <span className="text-sm text-white font-medium">EN</span>
              </button>

              {/* Account Icon */}
              <button className="p-2 hover:bg-white/10 rounded transition-colors">
                <User className="h-4 w-4 text-white" strokeWidth={1.5} />
              </button>

              {/* Gradient CTA Button */}
              <Link
                href="/signup"
                className="px-5 py-2 bg-gradient-to-r from-[#2962FF] to-[#7C4DFF] hover:from-[#1E53E5] hover:to-[#6A3FE6] text-white text-sm font-semibold rounded-full transition-all shadow-lg shadow-blue-500/20"
              >
                Get started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section - TradingView Style Full Screen */}
      <section className="relative h-screen w-full overflow-hidden">
        {/* Background Image - Optimized */}
        <div className="absolute inset-0 bg-black">
          <Image
            src="/images/nasa-hubble-space-telescope-lhG1L6E3YDo-unsplash.jpg"
            alt="Helwa AI Trading Platform"
            fill
            className="object-cover"
            priority
            quality={85}
            sizes="100vw"
            placeholder="blur"
            blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q=="
          />

          {/* Dark Vignette Overlay - Creates shadow effect while keeping image sharp */}
          <div className="absolute inset-0 bg-gradient-radial from-transparent via-black/30 to-black/80"></div>

          {/* Bottom shadow for text contrast */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/40"></div>

          {/* Subtle honey glow accent */}
          <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent"></div>
        </div>

        {/* Hero Content - Centered, High Contrast */}
        <div className="relative z-10 h-full flex items-center justify-center">
          <div className="max-w-5xl mx-auto px-6 lg:px-8 text-center pt-8">
            {/* Main Headline - Two Lines, Bold, High Contrast */}
            <h1 className="text-6xl md:text-7xl lg:text-8xl font-black leading-[1.1] tracking-tight mb-6">
              <span className="block text-white drop-shadow-2xl">
                Machine Learning Meets
              </span>
              <span className="block text-white drop-shadow-2xl">
                Market Momentum
              </span>
            </h1>

            {/* Subheadline - Clean, Medium Weight */}
            <p className="text-xl md:text-2xl text-white/90 font-medium mb-10 drop-shadow-lg">
              AI-powered trading alerts that predict market movements before they happen.
            </p>

            {/* Primary CTA Button - Rounded, High Contrast */}
            <div className="mb-4">
              <Link
                href="/signup"
                className="inline-block px-10 py-4 bg-white hover:bg-white/90 text-background text-lg font-bold rounded-full transition-all shadow-2xl hover:scale-105"
              >
                Get started for free
              </Link>
            </div>

            {/* Small disclaimer text */}
            <p className="text-sm text-white/70 font-medium">
              $0 forever, no credit card needed
            </p>
          </div>
        </div>

        {/* Bottom-Right Profile Card - TradingView Style */}
        <div className="absolute bottom-12 right-12 z-20 hidden lg:block">
          <div className="bg-background/80 backdrop-blur-md border border-border/50 rounded-2xl p-6 shadow-2xl max-w-sm">
            {/* Profile Section */}
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-accent to-accent-dark flex items-center justify-center text-white font-bold text-xl overflow-hidden">
                <Image
                  src="/images/honey-backgroundlandingpage.jpg"
                  alt="Founder"
                  width={56}
                  height={56}
                  className="object-cover"
                />
              </div>
              <div>
                <h3 className="text-base font-bold text-primary">Arbaaz Iqbal</h3>
                <p className="text-sm text-secondary">Founder & Quant Researcher</p>
              </div>
            </div>

            {/* Watch Explainer Button */}
            <Link
              href="#explainer"
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-elevated hover:bg-elevated/80 border border-border/50 rounded-lg transition-all group"
            >
              <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <Play className="h-4 w-4 text-accent fill-accent" />
              </div>
              <span className="text-sm font-semibold text-primary">Watch explainer</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Stats Section - Social Proof */}
      <section className="py-24 px-6 lg:px-8 bg-background">
        <div className="max-w-[1400px] mx-auto">
          <div className="grid md:grid-cols-3 gap-12">
            {[
              { number: '10K+', label: 'Active Traders' },
              { number: '95%', label: 'Prediction Accuracy' },
              { number: '<50ms', label: 'Alert Latency' },
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="text-5xl lg:text-6xl font-black text-primary mb-3">{stat.number}</div>
                <div className="text-lg text-secondary font-medium">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works - Process Section */}
      <section className="py-32 px-6 lg:px-8 bg-panel/30">
        <div className="max-w-[1400px] mx-auto">
          <div className="text-center max-w-3xl mx-auto mb-20">
            <h2 className="text-5xl lg:text-6xl font-black mb-6 text-primary tracking-tight">
              How It Works
            </h2>
            <p className="text-xl text-secondary">
              Get started in minutes and start receiving predictive alerts
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-12">
            {[
              {
                step: '01',
                title: 'Connect Your Assets',
                desc: 'Link your exchange accounts or track specific tickers. We support all major exchanges and thousands of assets.'
              },
              {
                step: '02',
                title: 'Set Your Strategy',
                desc: 'Choose your risk tolerance, time horizon, and alert preferences. Our models adapt to your trading style.'
              },
              {
                step: '03',
                title: 'Receive Smart Alerts',
                desc: 'Get real-time notifications before significant price movements. Each alert includes confidence scores and reasoning.'
              },
            ].map((item, i) => (
              <div key={i} className="relative">
                <div className="mb-6">
                  <div className="text-7xl font-black text-accent/20">{item.step}</div>
                </div>
                <h3 className="text-2xl font-bold mb-4 text-primary">{item.title}</h3>
                <p className="text-base text-secondary leading-relaxed">{item.desc}</p>

                {i < 2 && (
                  <div className="hidden md:block absolute top-12 -right-6 w-12">
                    <ArrowRight className="h-6 w-6 text-accent/30" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features - Modern grid with hover effects */}
      <section id="features" className="py-32 px-6 lg:px-8 relative">
        <div className="max-w-[1600px] mx-auto">
          <div className="text-center max-w-4xl mx-auto mb-20">
            <h2 className="text-5xl lg:text-6xl font-black mb-6 text-primary tracking-tight">
              Professional Trading Tools
            </h2>
            <p className="text-xl text-secondary font-light">
              Everything you need to trade with confidence
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: LineChart, title: 'Real-Time Analytics', desc: 'Advanced charting with institutional-grade data feeds and analytics', gradient: 'from-accent/20 to-accent/5' },
              { icon: Target, title: 'Predictive Models', desc: 'Proprietary algorithms trained on billions of market data points', gradient: 'from-accent/20 to-accent/5' },
              { icon: Zap, title: 'Instant Alerts', desc: 'Sub-50ms notifications delivered to all your devices simultaneously', gradient: 'from-accent/20 to-accent/5' },
              { icon: Shield, title: 'Risk Controls', desc: 'Automated position sizing and portfolio risk management tools', gradient: 'from-accent/20 to-accent/5' },
              { icon: Activity, title: 'Backtesting', desc: 'Test strategies against years of historical data with realistic fills', gradient: 'from-accent/20 to-accent/5' },
              { icon: Cpu, title: 'Full API Access', desc: 'REST and WebSocket APIs for custom integrations and automation', gradient: 'from-accent/20 to-accent/5' },
            ].map((feature, i) => (
              <div key={i} className="group relative bg-panel border border-border hover:border-accent/50 rounded-2xl p-8 transition-all duration-300 hover:shadow-2xl hover:shadow-accent/10 hover:-translate-y-1">
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300`}></div>

                <div className="relative z-10">
                  <div className="inline-flex p-3 rounded-xl bg-accent/10 mb-6 group-hover:bg-accent/20 group-hover:scale-110 transition-all duration-300">
                    <feature.icon className="h-6 w-6 text-accent" />
                  </div>
                  <h3 className="text-2xl font-bold mb-3 text-primary">{feature.title}</h3>
                  <p className="text-base text-secondary leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-32 px-6 lg:px-8 bg-panel/20">
        <div className="max-w-[1400px] mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-5xl lg:text-6xl font-black mb-6 text-primary tracking-tight">
              Simple, Transparent Pricing
            </h2>
            <p className="text-xl text-secondary">
              Start free, scale as you grow
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Free Tier */}
            <div className="bg-panel border border-border rounded-2xl p-10 hover:border-border/80 transition-all">
              <div className="mb-8">
                <h3 className="text-xl font-bold text-primary mb-3">Free</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black text-primary">$0</span>
                  <span className="text-secondary font-medium">/month</span>
                </div>
              </div>
              <ul className="space-y-4 mb-10">
                {['View live charts', 'Basic indicators', 'Limited AI insights', 'Community support'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-base text-secondary">
                    <div className="w-5 h-5 rounded-full bg-elevated border border-border flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-secondary"></div>
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="block text-center px-6 py-3.5 bg-elevated hover:bg-elevated/80 text-primary border border-border rounded-xl font-bold transition-all text-base">
                Get Started
              </Link>
            </div>

            {/* Pro Tier */}
            <div className="bg-panel border-2 border-accent rounded-2xl p-10 relative transform hover:scale-105 transition-all shadow-2xl shadow-accent/10">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-accent text-white text-sm font-bold rounded-full">
                Most Popular
              </div>
              <div className="mb-8">
                <h3 className="text-xl font-bold text-primary mb-3">Pro</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black text-primary">$49</span>
                  <span className="text-secondary font-medium">/month</span>
                </div>
              </div>
              <ul className="space-y-4 mb-10">
                {['Unlimited charts', 'Advanced indicators', 'Full AI analysis', 'Priority support', 'API access', 'Backtesting engine'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-base text-primary">
                    <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-white"></div>
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="block text-center px-6 py-3.5 bg-accent hover:bg-accent-dark text-white rounded-xl font-bold transition-all shadow-lg shadow-accent/20 text-base">
                Upgrade to Pro
              </Link>
            </div>

            {/* Enterprise */}
            <div className="bg-panel border border-border rounded-2xl p-10 hover:border-border/80 transition-all">
              <div className="mb-8">
                <h3 className="text-xl font-bold text-primary mb-3">Enterprise</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black text-primary">Custom</span>
                </div>
              </div>
              <ul className="space-y-4 mb-10">
                {['Everything in Pro', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'Volume discounts'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-base text-secondary">
                    <div className="w-5 h-5 rounded-full bg-elevated border border-border flex items-center justify-center flex-shrink-0">
                      <div className="w-2 h-2 rounded-full bg-secondary"></div>
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/contact" className="block text-center px-6 py-3.5 bg-elevated hover:bg-elevated/80 text-primary border border-border rounded-xl font-bold transition-all text-base">
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-32 px-6 lg:px-8 bg-background">
        <div className="max-w-[1000px] mx-auto">
          <div className="text-center mb-20">
            <h2 className="text-5xl lg:text-6xl font-black mb-6 text-primary tracking-tight">
              Frequently Asked Questions
            </h2>
            <p className="text-xl text-secondary">
              Everything you need to know about Helwa AI
            </p>
          </div>

          <div className="space-y-6">
            {[
              {
                q: 'How accurate are the predictions?',
                a: 'Our models maintain a 95% accuracy rate for short-term price movements. We continuously refine our algorithms based on real market data and performance metrics.'
              },
              {
                q: 'Which exchanges and assets are supported?',
                a: 'We support all major exchanges including Binance, Coinbase, Kraken, and more. Our platform tracks thousands of cryptocurrencies, stocks, and forex pairs.'
              },
              {
                q: 'How quickly do I receive alerts?',
                a: 'Alerts are delivered in under 50 milliseconds from detection. We use optimized infrastructure to ensure you get notified before significant price movements occur.'
              },
              {
                q: 'Can I backtest my own strategies?',
                a: 'Yes! Pro and Enterprise plans include full backtesting capabilities. Test your strategies against years of historical data with realistic transaction costs and slippage.'
              },
              {
                q: 'Is my data secure?',
                a: 'Absolutely. We use bank-level encryption for all data. Your API keys are encrypted at rest and we never have withdrawal permissions on your accounts.'
              },
              {
                q: 'Do I need trading experience?',
                a: 'No. Our platform is designed for both beginners and professionals. We provide educational resources and clear explanations with every alert.'
              },
            ].map((faq, i) => (
              <div key={i} className="bg-panel border border-border rounded-2xl p-8 hover:border-accent/30 transition-all">
                <h3 className="text-xl font-bold text-primary mb-3">{faq.q}</h3>
                <p className="text-base text-secondary leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6 lg:px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent"></div>
        <div className="max-w-5xl mx-auto text-center relative z-10">
          <div className="bg-gradient-to-br from-accent/10 via-accent/5 to-transparent border border-accent/30 rounded-3xl p-16 backdrop-blur-sm shadow-2xl shadow-accent/10">
            <h2 className="text-5xl lg:text-6xl font-black mb-6 text-primary tracking-tight">
              Ready to start trading?
            </h2>
            <p className="text-2xl text-secondary mb-12 font-light">
              Join thousands of traders using Helwa AI
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 px-10 py-5 bg-accent hover:bg-accent-dark text-white rounded-xl font-bold transition-all shadow-2xl shadow-accent/30 hover:shadow-accent/40 hover:scale-105 text-lg"
            >
              Get Started Free
              <ArrowRight className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/30 bg-panel/50 py-16 px-6 lg:px-8">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-accent to-accent-dark rounded-lg flex items-center justify-center">
                <Activity className="h-4 w-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="text-2xl font-bold text-primary tracking-tight">
                Helwa<span className="text-accent">.ai</span>
              </span>
            </div>
            <div className="text-base text-secondary font-medium">
              © 2025 Helwa.ai. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
