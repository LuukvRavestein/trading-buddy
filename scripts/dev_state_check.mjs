/**
 * Dev State Check Script
 * 
 * Loads last N candles from Supabase and prints computed state for one timeframe.
 * Useful for debugging state builder logic.
 * 
 * Usage:
 *   node scripts/dev_state_check.mjs [timeframe] [limit]
 * 
 * Example:
 *   node scripts/dev_state_check.mjs 15 200
 */

import { getLatestCandles } from '../src/db/supabaseClient.js';
import { buildTimeframeState } from '../src/analysis/stateBuilder.mjs';

const SYMBOL = process.env.SYMBOL || 'BTC-PERPETUAL';
const TIMEFRAME = parseInt(process.argv[2] || '15', 10);
const LIMIT = parseInt(process.argv[3] || '200', 10);

async function main() {
  console.log(`[dev_state_check] Loading ${LIMIT} candles for ${SYMBOL} ${TIMEFRAME}m...`);
  
  try {
    // Fetch candles
    const candles = await getLatestCandles({
      symbol: SYMBOL,
      timeframeMin: TIMEFRAME,
      limit: LIMIT,
    });
    
    if (candles.length === 0) {
      console.error('[dev_state_check] No candles found');
      process.exit(1);
    }
    
    console.log(`[dev_state_check] Loaded ${candles.length} candles`);
    console.log(`[dev_state_check] First candle: ${candles[candles.length - 1].ts}`);
    console.log(`[dev_state_check] Last candle: ${candles[0].ts}`);
    
    // Convert to stateBuilder format
    const stateCandles = candles.map(c => ({
      t: new Date(c.ts).getTime(),
      o: parseFloat(c.open),
      h: parseFloat(c.high),
      l: parseFloat(c.low),
      c: parseFloat(c.close),
      v: parseFloat(c.volume || 0),
    }));
    
    // Sort by timestamp
    stateCandles.sort((a, b) => a.t - b.t);
    
    // Build state
    const state = buildTimeframeState({
      symbol: SYMBOL,
      timeframeMin: TIMEFRAME,
      candles: stateCandles,
    });
    
    // Print state
    console.log('\n[dev_state_check] Computed State:');
    console.log(JSON.stringify(state, null, 2));
    
  } catch (error) {
    console.error('[dev_state_check] Error:', error);
    process.exit(1);
  }
}

main();

