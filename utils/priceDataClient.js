/**
 * Price Data Client
 * 
 * Fetches historical price data from various sources
 * Falls back to alternative APIs if Deribit is unavailable
 * 
 * Sources (in order of preference):
 * 1. Binance API - Best OHLC data, free, no auth
 * 2. CoinGecko API - Price data only, free, no auth
 * 3. Deribit Historical Trades API - Reconstructs OHLC from trades (if available)
 */

const DERIBIT_HISTORY_API_BASE = 'https://history.deribit.com/api/v2';

/**
 * Get historical price data from CoinGecko API (free, no auth required)
 * 
 * @param {string} symbol - Symbol (e.g., 'BTC')
 * @param {number} startTimestamp - Start timestamp in milliseconds
 * @param {number} endTimestamp - End timestamp in milliseconds
 * @returns {Promise<array>} Array of candlestick data: [{t: timestamp, o: open, h: high, l: low, c: close, v: volume}, ...]
 */
async function getHistoricalPriceDataFromCoinGecko(symbol, startTimestamp, endTimestamp) {
  try {
    // CoinGecko uses coin IDs, map common symbols
    const coinIdMap = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'SOL': 'solana',
    };

    const coinId = coinIdMap[symbol.toUpperCase()] || 'bitcoin';
    
    // Convert to seconds for CoinGecko
    const startSeconds = Math.floor(startTimestamp / 1000);
    const endSeconds = Math.floor(endTimestamp / 1000);

    // CoinGecko market chart endpoint (free tier allows this)
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${startSeconds}&to=${endSeconds}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.prices || data.prices.length === 0) {
      return [];
    }

    // CoinGecko returns: {prices: [[timestamp, price]], market_caps: [...], total_volumes: [...]}
    // We need to convert this to OHLC format
    // Since CoinGecko only gives us prices, we'll use the price for all OHLC values
    // This is a limitation, but better than nothing
    const candles = [];
    for (let i = 0; i < data.prices.length; i++) {
      const [timestamp, price] = data.prices[i];
      const volume = data.total_volumes && data.total_volumes[i] ? data.total_volumes[i][1] : 0;
      
      candles.push({
        t: timestamp,
        o: price,
        h: price, // CoinGecko doesn't provide separate OHLC, so we use price for all
        l: price,
        c: price,
        v: volume,
      });
    }

    return candles;
  } catch (error) {
    console.error('[priceDataClient] CoinGecko error:', error);
    throw error;
  }
}

/**
 * Get historical price data from Binance API (free, no auth required)
 * More accurate than CoinGecko as it provides actual OHLC data
 * 
 * @param {string} symbol - Symbol (e.g., 'BTCUSDT')
 * @param {number} startTimestamp - Start timestamp in milliseconds
 * @param {number} endTimestamp - End timestamp in milliseconds
 * @param {string} interval - Kline interval: '1m', '5m', '15m', '1h', '4h', '1d'
 * @returns {Promise<array>} Array of candlestick data
 */
async function getHistoricalPriceDataFromBinance(symbol, startTimestamp, endTimestamp, interval = '1m') {
  try {
    // Binance uses symbol like BTCUSDT
    let binanceSymbol = symbol.toUpperCase();
    if (!binanceSymbol.includes('USDT')) {
      binanceSymbol = binanceSymbol.replace('-PERPETUAL', '') + 'USDT';
    }

    const startSeconds = Math.floor(startTimestamp / 1000) * 1000; // Binance wants milliseconds
    const endSeconds = Math.floor(endTimestamp / 1000) * 1000;

    const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&startTime=${startSeconds}&endTime=${endSeconds}&limit=1000`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Binance API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    if (!data || data.length === 0) {
      return [];
    }

    // Binance returns: [[openTime, open, high, low, close, volume, closeTime, ...], ...]
    const candles = data.map(kline => ({
      t: kline[0], // Open time
      o: parseFloat(kline[1]), // Open
      h: parseFloat(kline[2]), // High
      l: parseFloat(kline[3]), // Low
      c: parseFloat(kline[4]), // Close
      v: parseFloat(kline[5]), // Volume
    }));

    return candles;
  } catch (error) {
    console.error('[priceDataClient] Binance error:', error);
    throw error;
  }
}

/**
 * Get historical trades from Deribit and reconstruct OHLC candles
 * Note: This is less efficient than direct OHLC data, but uses Deribit's actual trade data
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
    const url = `${DERIBIT_HISTORY_API_BASE}/public/get_last_trades_by_instrument_and_time`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    // Note: Deribit historical API might require different parameters or authentication
    // This is a placeholder - may need adjustment based on actual API behavior
    const params = new URLSearchParams({
      instrument_name,
      start_timestamp: startSeconds.toString(),
      end_timestamp: endSeconds.toString(),
      include_old: 'true',
      count: '10000', // Max trades to fetch
    });

    const fullUrl = `${url}?${params.toString()}`;
    const finalResponse = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!finalResponse.ok) {
      throw new Error(`Deribit historical API error: ${finalResponse.status}`);
    }

    const data = await finalResponse.json();

    if (data.error || !data.result || !data.result.trades || data.result.trades.length === 0) {
      return [];
    }

    const trades = data.result.trades;

    // Reconstruct OHLC candles from trades
    const candles = {};
    const intervalSeconds = intervalMs / 1000;

    for (const trade of trades) {
      const tradeTime = trade.timestamp;
      const candleKey = Math.floor(tradeTime / intervalSeconds) * intervalSeconds;
      
      if (!candles[candleKey]) {
        candles[candleKey] = {
          t: candleKey * 1000, // Convert to milliseconds
          o: trade.price,
          h: trade.price,
          l: trade.price,
          c: trade.price,
          v: trade.amount || 0,
        };
      } else {
        const candle = candles[candleKey];
        candle.h = Math.max(candle.h, trade.price);
        candle.l = Math.min(candle.l, trade.price);
        candle.c = trade.price; // Close is last trade price
        candle.v += trade.amount || 0;
      }
    }

    // Convert to array and sort by timestamp
    return Object.values(candles).sort((a, b) => a.t - b.t);
  } catch (error) {
    console.error('[priceDataClient] Deribit trades error:', error);
    throw error;
  }
}

/**
 * Get historical price data with automatic fallback
 * Tries multiple sources in order of preference
 * 
 * @param {string} instrument_name - Instrument (e.g., 'BTC-PERPETUAL')
 * @param {number} startTimestamp - Start timestamp in milliseconds
 * @param {number} endTimestamp - End timestamp in milliseconds
 * @param {string} resolution - Timeframe: '60', '300', '900', '3600', '14400', '86400' (1m, 5m, 15m, 1h, 4h, 1d)
 * @returns {Promise<array>} Array of candlestick data
 */
export async function getHistoricalPriceData(instrument_name, startTimestamp, endTimestamp, resolution = '60') {
  // Extract symbol from instrument name (e.g., 'BTC-PERPETUAL' -> 'BTC')
  const symbol = instrument_name.replace('-PERPETUAL', '').replace('-', '').toUpperCase();
  
  // Map resolution to Binance interval and milliseconds
  const resolutionMap = {
    '60': { binance: '1m', ms: 60000 },
    '300': { binance: '5m', ms: 300000 },
    '900': { binance: '15m', ms: 900000 },
    '3600': { binance: '1h', ms: 3600000 },
    '14400': { binance: '4h', ms: 14400000 },
    '86400': { binance: '1d', ms: 86400000 },
  };
  const resolutionInfo = resolutionMap[resolution] || { binance: '1m', ms: 60000 };

  // Try Binance first (most accurate, has OHLC data, fastest)
  try {
    console.log(`[priceDataClient] Trying Binance for ${symbol}...`);
    const binanceData = await getHistoricalPriceDataFromBinance(symbol, startTimestamp, endTimestamp, resolutionInfo.binance);
    if (binanceData && binanceData.length > 0) {
      console.log(`[priceDataClient] Successfully fetched ${binanceData.length} candles from Binance`);
      return binanceData;
    }
  } catch (error) {
    console.warn(`[priceDataClient] Binance failed: ${error.message}`);
  }

  // Fallback to CoinGecko (less accurate, only price data, but reliable)
  try {
    console.log(`[priceDataClient] Trying CoinGecko for ${symbol}...`);
    const coinGeckoData = await getHistoricalPriceDataFromCoinGecko(symbol, startTimestamp, endTimestamp);
    if (coinGeckoData && coinGeckoData.length > 0) {
      console.log(`[priceDataClient] Successfully fetched ${coinGeckoData.length} candles from CoinGecko`);
      return coinGeckoData;
    }
  } catch (error) {
    console.warn(`[priceDataClient] CoinGecko failed: ${error.message}`);
  }

  // Last resort: Try Deribit historical trades API (slower, reconstructs OHLC from trades)
  // Note: This may not work without proper authentication or API access
  try {
    console.log(`[priceDataClient] Trying Deribit historical trades for ${instrument_name}...`);
    const deribitData = await getHistoricalPriceDataFromDeribitTrades(instrument_name, startTimestamp, endTimestamp, resolutionInfo.ms);
    if (deribitData && deribitData.length > 0) {
      console.log(`[priceDataClient] Successfully fetched ${deribitData.length} candles from Deribit trades`);
      return deribitData;
    }
  } catch (error) {
    console.warn(`[priceDataClient] Deribit historical trades failed: ${error.message}`);
  }

  // If all fail, return empty array
  console.warn(`[priceDataClient] All data sources failed for ${instrument_name}`);
  return [];
}

