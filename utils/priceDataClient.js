/**
 * Price Data Client
 * 
 * Fetches historical price data from Deribit only
 * Uses Deribit Historical Trades API to reconstruct OHLC candles
 * 
 * Based on Deribit documentation:
 * https://support.deribit.com/hc/en-us/articles/25973087226909-Accessing-historical-trades-and-orders-using-API
 */

const DERIBIT_HISTORY_API_BASE = 'https://history.deribit.com/api/v2';


/**
 * Get historical trades from Deribit and reconstruct OHLC candles
 * Uses Deribit Historical API: https://history.deribit.com/api/v2/
 * 
 * Based on Deribit documentation:
 * - Endpoint: public/get_last_trades_by_instrument_and_time
 * - Parameters: instrument_name, start_timestamp, end_timestamp, count (optional)
 * 
 * @param {string} instrument_name - Instrument (e.g., 'BTC-PERPETUAL')
 * @param {number} startTimestamp - Start timestamp in milliseconds
 * @param {number} endTimestamp - End timestamp in milliseconds
 * @param {number} intervalMs - Interval in milliseconds for candles
 * @returns {Promise<array>} Array of candlestick data
 */
async function getHistoricalPriceDataFromDeribitTrades(instrument_name, startTimestamp, endTimestamp, intervalMs = 60000) {
  try {
    const startSeconds = Math.floor(startTimestamp / 1000);
    const endSeconds = Math.floor(endTimestamp / 1000);

    console.log(`[priceDataClient] Fetching Deribit trades for ${instrument_name}:`);
    console.log(`  Start: ${new Date(startTimestamp).toISOString()} (${startSeconds} seconds)`);
    console.log(`  End: ${new Date(endTimestamp).toISOString()} (${endSeconds} seconds)`);
    console.log(`  Duration: ${Math.floor((endTimestamp - startTimestamp) / 1000 / 60)} minutes`);

    // Deribit historical API endpoint for trades
    // Documentation: https://support.deribit.com/hc/en-us/articles/25973087226909
    // Based on testing: GET with query parameters works, POST does not
    
    // Normalize instrument name for Deribit Historical API
    // The historical API might use different naming than the main API
    let normalizedInstrument = instrument_name;
    if (instrument_name.includes('BTCUSD') || instrument_name.includes('BTCUSD.P')) {
      normalizedInstrument = 'BTC-PERPETUAL';
    } else if (instrument_name === 'BTC-PERPETUAL') {
      normalizedInstrument = 'BTC-PERPETUAL'; // Keep as is
    }
    
    const url = `${DERIBIT_HISTORY_API_BASE}/public/get_last_trades_by_instrument_and_time`;
    
    // Use GET with query parameters (this is what works)
    const queryParams = new URLSearchParams({
      instrument_name: normalizedInstrument,
      start_timestamp: startSeconds.toString(),
      end_timestamp: endSeconds.toString(),
      count: '10000', // Max trades to fetch (Deribit limit)
    });
    
    console.log(`[priceDataClient] Normalized instrument: ${instrument_name} -> ${normalizedInstrument}`);
    
    const fullUrl = `${url}?${queryParams.toString()}`;
    console.log(`[priceDataClient] Request URL: ${fullUrl}`);
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[priceDataClient] HTTP error: ${response.status} - ${errorText}`);
      throw new Error(`Deribit historical API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    console.log(`[priceDataClient] API response:`, JSON.stringify(data, null, 2).substring(0, 500));

    // Handle JSON-RPC response format (Deribit returns {result: {trades: [...]}, jsonrpc: "2.0"})
    if (data.error) {
      console.error(`[priceDataClient] API error:`, data.error);
      throw new Error(`Deribit API error: ${data.error.message || data.error.code || 'Unknown error'}`);
    }

    const result = data.result || data;
    
    if (!result) {
      console.warn(`[priceDataClient] No result in API response`);
      return [];
    }
    
    if (!result.trades) {
      console.warn(`[priceDataClient] No 'trades' field in result:`, Object.keys(result));
      return [];
    }
    
    if (result.trades.length === 0) {
      console.warn(`[priceDataClient] No trades found for ${instrument_name} between ${new Date(startTimestamp).toISOString()} and ${new Date(endTimestamp).toISOString()}`);
      console.warn(`[priceDataClient] Response structure:`, {
        has_result: !!data.result,
        has_trades: !!result.trades,
        trades_length: result.trades?.length || 0,
        has_more: result.has_more,
        keys: Object.keys(result),
      });
      
      // Try with a longer time range (maybe the period is too short or in the future)
      const now = Date.now();
      if (endTimestamp > now) {
        console.warn(`[priceDataClient] End timestamp is in the future, adjusting to now`);
      }
      
      return [];
    }

    const trades = result.trades;
    
    console.log(`[priceDataClient] Fetched ${trades.length} trades from Deribit (has_more: ${result.has_more || false})`);
    if (trades.length > 0) {
      console.log(`[priceDataClient] Sample trade:`, {
        timestamp: trades[0].timestamp,
        price: trades[0].price,
        amount: trades[0].amount,
        keys: Object.keys(trades[0]),
      });
    }

    // Reconstruct OHLC candles from trades
    const candles = {};
    const intervalSeconds = intervalMs / 1000;

    for (const trade of trades) {
      // Deribit trade format from historical API: 
      // {trade_id, instrument_name, price, amount, direction, timestamp, trade_seq, tick_direction, ...}
      const tradeTime = trade.timestamp || trade.time;
      const tradePrice = parseFloat(trade.price);
      const tradeAmount = Math.abs(parseFloat(trade.amount || trade.size || 0));
      
      if (!tradeTime || !tradePrice || isNaN(tradePrice)) {
        console.warn(`[priceDataClient] Skipping invalid trade:`, trade);
        continue; // Skip invalid trades
      }

      // Convert timestamp to seconds if it's in milliseconds
      const tradeTimeSeconds = tradeTime > 1000000000000 ? Math.floor(tradeTime / 1000) : tradeTime;
      const candleKey = Math.floor(tradeTimeSeconds / intervalSeconds) * intervalSeconds;
      
      if (!candles[candleKey]) {
        candles[candleKey] = {
          t: candleKey * 1000, // Convert to milliseconds
          o: tradePrice,
          h: tradePrice,
          l: tradePrice,
          c: tradePrice,
          v: tradeAmount,
        };
      } else {
        const candle = candles[candleKey];
        candle.h = Math.max(candle.h, tradePrice);
        candle.l = Math.min(candle.l, tradePrice);
        candle.c = tradePrice; // Close is last trade price in this interval
        candle.v += tradeAmount;
      }
    }

    // Convert to array and sort by timestamp
    const candleArray = Object.values(candles).sort((a, b) => a.t - b.t);
    
    console.log(`[priceDataClient] Reconstructed ${candleArray.length} candles from ${trades.length} Deribit trades`);
    
    return candleArray;
  } catch (error) {
    console.error('[priceDataClient] Deribit trades error:', error);
    throw error;
  }
}

/**
 * Get historical price data from Deribit only
 * Uses Deribit Historical Trades API to reconstruct OHLC candles
 * 
 * @param {string} instrument_name - Instrument (e.g., 'BTC-PERPETUAL')
 * @param {number} startTimestamp - Start timestamp in milliseconds
 * @param {number} endTimestamp - End timestamp in milliseconds
 * @param {string} resolution - Timeframe: '60', '300', '900', '3600', '14400', '86400' (1m, 5m, 15m, 1h, 4h, 1d)
 * @returns {Promise<array>} Array of candlestick data
 */
export async function getHistoricalPriceData(instrument_name, startTimestamp, endTimestamp, resolution = '60') {
  // Map resolution to milliseconds
  const resolutionMap = {
    '60': 60000,      // 1 minute
    '300': 300000,    // 5 minutes
    '900': 900000,    // 15 minutes
    '3600': 3600000,  // 1 hour
    '14400': 14400000, // 4 hours
    '86400': 86400000, // 1 day
  };
  const intervalMs = resolutionMap[resolution] || 60000;

  // Use Deribit historical trades API
  try {
    console.log(`[priceDataClient] Fetching Deribit historical trades for ${instrument_name}...`);
    const deribitData = await getHistoricalPriceDataFromDeribitTrades(instrument_name, startTimestamp, endTimestamp, intervalMs);
    if (deribitData && deribitData.length > 0) {
      console.log(`[priceDataClient] Successfully fetched ${deribitData.length} candles from Deribit`);
      return deribitData;
    } else {
      console.warn(`[priceDataClient] No data returned from Deribit for ${instrument_name}`);
      return [];
    }
  } catch (error) {
    console.error(`[priceDataClient] Deribit historical trades failed: ${error.message}`);
    throw error; // Re-throw so caller knows it failed
  }
}

