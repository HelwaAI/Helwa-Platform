/**
 * Volume Profile Calculation Module
 *
 * Provides volume profile analysis with configurable parameters.
 * Matches the Python implementation in trading_bot/src/analyzers/volume_profile.py
 *
 * Config defaults (from trading_bot/config.py):
 * - num_bins: 50
 * - hvn_percentile: 95
 * - lvn_percentile: 5
 */

// Types
export type NodeType = 'HVN' | 'LVN' | 'POC' | 'NORMAL';

export interface VolumeProfileNode {
  price_level: number;
  volume: number;
  node_type: NodeType;
  bin_index: number;
  price_range: [number, number];
}

export interface VolumeProfileResult {
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

export interface BarData {
  high: number;
  low: number;
  volume: number;
}

// Config defaults matching trading_bot/config.py VOLUME_PROFILE_CONFIG
export const VOLUME_PROFILE_CONFIG = {
  num_bins: 50,
  hvn_percentile: 95,
  lvn_percentile: 5,
};

/**
 * Calculate percentile of an array
 * Uses linear interpolation (same as numpy.percentile)
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];

  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower];

  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Binary search to find insertion point (like numpy.searchsorted)
 * side='left': find leftmost position where value can be inserted
 * side='right': find rightmost position where value can be inserted
 */
function searchsorted(arr: number[], value: number, side: 'left' | 'right' = 'left'): number {
  let lo = 0;
  let hi = arr.length;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (side === 'left') {
      if (arr[mid] < value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    } else {
      if (arr[mid] <= value) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
  }

  return lo;
}

/**
 * Create evenly spaced values (like numpy.linspace)
 */
function linspace(start: number, stop: number, num: number): number[] {
  if (num <= 1) return [start];

  const step = (stop - start) / (num - 1);
  const result: number[] = [];

  for (let i = 0; i < num; i++) {
    result.push(start + step * i);
  }

  return result;
}

/**
 * Calculate volume profile from OHLCV bar data.
 *
 * This function distributes volume across price bins weighted by price (dollar volume).
 * Matches the algorithm in trading_bot/src/analyzers/volume_profile.py:calculate_volume_profile_core()
 *
 * @param bars - Array of bar data with high, low, volume
 * @param numBins - Number of price bins (default: 50)
 * @param hvnPercentile - Percentile threshold for HVN classification (default: 95)
 * @param lvnPercentile - Percentile threshold for LVN classification (default: 5)
 * @returns VolumeProfileResult with all nodes and metadata
 */
export function calculateVolumeProfile(
  bars: BarData[],
  numBins: number = VOLUME_PROFILE_CONFIG.num_bins,
  hvnPercentile: number = VOLUME_PROFILE_CONFIG.hvn_percentile,
  lvnPercentile: number = VOLUME_PROFILE_CONFIG.lvn_percentile
): VolumeProfileResult {
  // Initialize result structure
  const result: VolumeProfileResult = {
    nodes: [],
    hvn_nodes: [],
    lvn_nodes: [],
    poc_node: null,
    hvn_threshold: 0,
    lvn_threshold: 0,
    total_volume: 0,
    price_range: [0, 0],
    bin_size: 0,
    poc_price: null,
  };

  // Handle empty data
  if (!bars || bars.length === 0) {
    return result;
  }

  // Find price range
  let priceMin = Infinity;
  let priceMax = -Infinity;

  for (const bar of bars) {
    if (bar.low < priceMin) priceMin = bar.low;
    if (bar.high > priceMax) priceMax = bar.high;
  }

  // Handle edge case where all prices are the same
  if (priceMin === priceMax) {
    priceMax = priceMin + 0.01;
  }

  // Create price bins
  const priceBins = linspace(priceMin, priceMax, numBins + 1);
  const binSize = (priceMax - priceMin) / numBins;

  result.price_range = [priceMin, priceMax];
  result.bin_size = binSize;

  // Calculate volume at each price level (dollar volume = volume * price)
  const volumeProfile: number[] = new Array(numBins).fill(0);

  for (const bar of bars) {
    const candleLow = bar.low;
    const candleHigh = bar.high;
    const candleVolume = bar.volume;

    if (candleVolume <= 0) continue;

    const lowBin = searchsorted(priceBins, candleLow, 'left');
    const highBin = searchsorted(priceBins, candleHigh, 'right');

    if (lowBin < highBin) {
      const volumePerBin = candleVolume / (highBin - lowBin);
      for (let binIdx = lowBin; binIdx < Math.min(highBin, numBins); binIdx++) {
        const binPrice = (priceBins[binIdx] + priceBins[Math.min(binIdx + 1, priceBins.length - 1)]) / 2;
        volumeProfile[binIdx] += volumePerBin * binPrice;
      }
    }
  }

  // Calculate total volume
  result.total_volume = volumeProfile.reduce((sum, v) => sum + v, 0);

  // Get non-zero volumes for percentile calculation
  const nonZeroVolumes = volumeProfile.filter(v => v > 0);

  if (nonZeroVolumes.length === 0) {
    return result;
  }

  // Calculate thresholds using config percentiles
  const hvnThreshold = percentile(nonZeroVolumes, hvnPercentile);
  const lvnThreshold = percentile(nonZeroVolumes, lvnPercentile);

  // Find POC (Point of Control) - bin with highest volume
  let pocIdx = 0;
  let maxVolume = 0;
  for (let i = 0; i < volumeProfile.length; i++) {
    if (volumeProfile[i] > maxVolume) {
      maxVolume = volumeProfile[i];
      pocIdx = i;
    }
  }

  result.hvn_threshold = hvnThreshold;
  result.lvn_threshold = lvnThreshold;

  // Create volume nodes
  for (let i = 0; i < numBins; i++) {
    const vol = volumeProfile[i];

    // Skip bins with zero volume
    if (vol <= 0) continue;

    const priceLevel = (priceBins[i] + priceBins[i + 1]) / 2;

    // Determine node type
    let nodeType: NodeType = 'NORMAL';
    if (i === pocIdx) {
      nodeType = 'POC';
    } else if (vol >= hvnThreshold) {
      nodeType = 'HVN';
    } else if (vol <= lvnThreshold) {
      nodeType = 'LVN';
    }

    const node: VolumeProfileNode = {
      price_level: priceLevel,
      volume: vol,
      node_type: nodeType,
      bin_index: i,
      price_range: [priceBins[i], priceBins[i + 1]],
    };

    result.nodes.push(node);

    // Add to typed lists
    if (nodeType === 'HVN') {
      result.hvn_nodes.push(node);
    } else if (nodeType === 'LVN') {
      result.lvn_nodes.push(node);
    } else if (nodeType === 'POC') {
      result.poc_node = node;
      result.poc_price = priceLevel;
      // POC is also an HVN (highest volume)
      result.hvn_nodes.push(node);
    }
  }

  return result;
}

/**
 * Get volume profile configuration
 * Useful for API responses to show what defaults were used
 */
export function getVolumeProfileConfig() {
  return { ...VOLUME_PROFILE_CONFIG };
}
