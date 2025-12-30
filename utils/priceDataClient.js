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

    // Deribit historical API endpoint for trades
    // Documentation: https://support.deribit.com/hc/en-us/articles/25973087226909
    const url = `${DERIBIT_HISTORY_API_BASE}/public/get_last_trades_by_instrument_and_time`;
    
    // Deribit uses POST for JSON-RPC, but historical API might use GET with query params
    // Try POST first (standard Deribit API format)
    const params = {
      instrument_name,
      start_timestamp: startSeconds,
      end_timestamp: endSeconds,
      count: 10000, // Max trades to fetch (Deribit limit)
    };

    // Try POST first (JSON-RPC format)
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'public/get_last_trades_by_instrument_and_time',
        params: params,
        id: 1,
      }),
    });

    // If POST fails, try GET with query params
    if (!response.ok) {
      const queryParams = new URLSearchParams({
        instrument_name,
        start_timestamp: startSeconds.toString(),
        end_timestamp: endSeconds.toString(),
        count: '10000',
      });
      const getUrl = `${url}?${queryParams.toString()}`;
      response = await fetch(getUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deribit historical API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    // Handle JSON-RPC response format
    const result = data.result || data;
    
    if (data.error) {
      throw new Error(`Deribit API error: ${data.error.message || data.error.code || 'Unknown error'}`);
    }

    if (!result || !result.trades || result.trades.length === 0) {
      console.warn(`[priceDataClient] No trades found for ${instrument_name} between ${new Date(startTimestamp).toISOString()} and ${new Date(endTimestamp).toISOString()}`);
      return [];
    }

    const trades = result.trades;

    // Reconstruct OHLC candles from trades
    const candles = {};
    const intervalSeconds = intervalMs / 1000;

    for (const trade of trades) {
      // Deribit trade format: {trade_id, instrument_name, price, amount, direction, timestamp}
      const tradeTime = trade.timestamp || trade.time;
      const tradePrice = trade.price;
      const tradeAmount = Math.abs(trade.amount || trade.size || 0);
      
      if (!tradeTime || !tradePrice) {
        continue; // Skip invalid trades
      }

      const candleKey = Math.floor(tradeTime / intervalSeconds) * intervalSeconds;
      
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

