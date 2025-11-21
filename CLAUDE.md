# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Helwa.ai** is an AI-powered trading platform landing page and dashboard built with Next.js 16. The application features a honey-themed design with authentication via Azure Easy Auth, pricing tiers, and a locked dashboard experience for free users.

## Technology Stack

- **Framework**: Next.js 16.0.3 with App Router
- **Language**: TypeScript 5.9.3
- **Styling**: Tailwind CSS 3.4.18 with custom honey/amber color theme
- **Icons**: lucide-react
- **Authentication**: Azure Easy Auth (Azure AD)
- **Build Output**: Standalone (configured in next.config.js)

## Common Development Commands

```bash
# Start development server (runs on http://localhost:3000)
npm run dev

# Build production bundle
npm run build

# Start production server
npm start

# Run Next.js linter
npm lint
```

## Project Architecture

### Directory Structure

```
/app                    # Next.js App Router pages
  /dashboard           # Protected dashboard page (requires login)
  /login              # Azure AD login page
  /signup             # Azure AD signup page
  /page.tsx           # Landing page (home)
  /layout.tsx         # Root layout with global styles
  /globals.css        # Global Tailwind directives
/public                # Static assets (images, etc.)
/images                # Product images for landing page and dashboard

# Configuration files
next.config.js         # Next.js config (standalone output, no powered-by header)
tsconfig.json          # TypeScript configuration (strict mode enabled)
tailwind.config.ts     # Tailwind theme with custom honey colors
postcss.config.mjs     # PostCSS with Tailwind and Autoprefixer
package.json           # Project dependencies and scripts
```

### Architecture Pattern: Static Landing + Protected Dashboard

The application has two main sections:

1. **Public Landing Page** (`/app/page.tsx`)
   - Marketing site with hero, features, pricing, FAQ sections
   - No authentication required
   - Responsive design with Tailwind CSS
   - Uses Next.js Image for optimized images
   - Contains call-to-action buttons linking to signup/login

2. **Protected Dashboard** (`/app/dashboard/page.tsx`)
   - Requires Azure Easy Auth login (`.auth/me` endpoint)
   - TradingView-inspired layout with sidebar navigation
   - Three-column layout: left sidebar (nav), center (chart area), right (AI chat panel)
   - Feature-locked experience: Free users see unlock overlays, Pro users get full access
   - Fetches user info from Azure Easy Auth endpoint at `/auth/me`
   - Client-side rendered with React hooks for state management

3. **Authentication Pages** (`/app/login/page.tsx`, `/app/signup/page.tsx`)
   - Both redirect to Azure AD via `/.auth/login/aad` endpoint
   - Single sign-on/sign-up flow (Azure handles both)
   - Simple form pages with Microsoft branding

## Design System & Theming

### Color Palette (Honey-Inspired Dark Theme)

The `tailwind.config.ts` defines custom colors:

- **background**: `#0A0806` (Deep dark brown)
- **panel**: `#1A1410` (Dark chocolate)
- **elevated**: `#251C15` (Warm dark brown)
- **primary**: `#FFF8E7` (Cream text)
- **secondary**: `#E8D5B5` (Light honey gold)
- **accent**: `#F59E0B` (Vibrant amber/gold) - Used for CTAs and highlights
- **success**: `#10B981` (Emerald green)

Custom utilities include:
- Honey gradients: `bg-honey-gradient`, `bg-honey-radial`
- Honey shadows: `shadow-honey`, `shadow-honey-lg`, `shadow-honey-xl`
- Honeycomb pattern: `bg-honeycomb`
- Custom animations: `animate-honey-drip`, `animate-honeycomb-pulse`, `animate-shimmer`

## Authentication Flow

The application uses **Azure Easy Auth** for authentication:

1. Login/Signup redirects to `/.auth/login/aad?post_login_redirect_uri=/dashboard`
2. Azure AD handles the authentication flow
3. After login, user info is available at `/.auth/me` endpoint (JSON with user claims)
4. Dashboard extracts user name and email from claims for display
5. Logout redirects to `/.auth/logout`

### Key Implementation Details

- Authentication happens server-side via Azure Easy Auth middleware
- User info fetched client-side in `useEffect` hook in dashboard
- User role is set to "free" by default (Pro tier detection can be added later)
- Free users see unlock overlays on charts and AI chat features

## Pricing Model

Three-tier system (configured in landing page):

1. **Free**: View live charts, basic indicators, limited AI insights, community support ($0)
2. **Pro**: Unlimited charts, advanced indicators, full AI analysis, priority support, API access, backtesting ($49/month)
3. **Enterprise**: Everything in Pro + dedicated support, custom integrations, SLA guarantee (Custom pricing)

The dashboard enforces these tiers via the `isLocked` variable (currently Free users only have limited access).

## Key Files & Their Purpose

- `app/page.tsx`: Landing page - 460 lines, includes hero, features, pricing, FAQ, CTA sections
- `app/dashboard/page.tsx`: Protected dashboard - 330 lines, TradingView-style layout with sidebar, charts, and AI chat
- `app/login/page.tsx`: Login page - Simple Azure AD integration
- `app/signup/page.tsx`: Signup page - Simple Azure AD integration
- `tailwind.config.ts`: Design system - Custom colors, gradients, animations
- `next.config.js`: Build configuration - Standalone output, security headers

## Crypto Dashboard Implementation

### Charts & Zones Feature (`/app/cryptoDashboard/page.tsx`)

A comprehensive crypto trading dashboard with candlestick charts and price zones.

#### Candlestick Chart Implementation
- **Library**: lightweight-charts (TradingView-compatible)
- **Data Source**: `/api/crypto/aggregates` endpoint (minute-level OHLCV bars)
- **Timestamp Conversion**: ISO 8601 strings converted to Unix timestamps in seconds
  - Formula: `Math.floor(new Date(timestamp).getTime() / 1000)`
- **Chart Features**:
  - Real-time candlestick rendering
  - Zoom, pan, and scroll support
  - Auto-fit content to visible data
  - Window resize handling

#### Supply/Demand Zones Visualization
- **Data Source**: `/api/crypto/zones` endpoint
- **Zone Structure**: Horizontal rectangular overlays between `top_price` and `bottom_price`
- **Implementation**: HTML div overlays positioned absolutely over chart
- **Timestamp**: Zones start at `created_at` (converted to Unix seconds) and extend to right edge of chart
- **Color Coding**:
  - **Supply zones**: Pink `rgba(236, 72, 153, 0.15)` with pink borders
  - **Demand zones**: Light green `rgba(16, 185, 129, 0.15)` with green borders
- **Dynamic Updates**: Zones automatically reposition when user:
  - Zooms in/out
  - Pans left/right
  - Scrolls the chart
  - Resizes the window
- **User Interaction**:
  - Zones have tooltips showing zone type and price range
  - Non-interactive (`pointerEvents: none`) to avoid blocking chart interaction

#### API Integration
- **Aggregates API** (`/api/crypto/aggregates`):
  - Returns minute-level OHLCV data for candlestick rendering
  - Query: `symbols` (crypto ticker), `limit` (number of bars, default 50000)
  - Returns: symbol, company_name, latest_price, bars array, and 24h stats

- **Zones API** (`/api/crypto/zones`):
  - Returns supply/demand zones for a crypto symbol
  - Query: `symbols` (crypto ticker), `limit` (zones to fetch)
  - Returns: zone_id, zone_type (supply/demand), top_price, bottom_price, created_at, updated_at

#### Chart State Management
- `cryptoData`: Stores aggregate bars and price statistics
- `zonesData`: Stores supply/demand zones for current symbol
- `chartContainerRef`: Reference to chart DOM container
- Search functionality: Enter ticker symbol to fetch and render new chart

## Important Notes

- The crypto dashboard is a **new feature** with real charting using lightweight-charts library
- Supply/Demand zones are rendered as HTML overlays (not native chart elements) for precise positioning
- The AI chat panel is **UI-only** - backend integration needed
- User role detection is **not yet implemented** - all users default to "free" tier
- Images are optimized with Next.js Image component for production use
- The application is configured for **standalone output** in Node.js environments (suitable for containerization)

## Development Tips

- Use `className` (not `class`) for Tailwind in TSX files
- Leverage the custom color tokens (use `text-accent`, `bg-panel`, etc.) for consistency
- Use `"use client"` directive in interactive components (dashboard pages use this)
- Image imports and Next.js Image component for static/optimized images
- Icons from lucide-react are imported and used directly as React components
- The sidebar and dashboard layout are responsive but primarily designed for desktop
