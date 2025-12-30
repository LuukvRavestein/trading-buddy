/**
 * Price Data Client
 * 
 * Fetches historical price data from various sources
 * Falls back to alternative APIs if Deribit is unavailable
 */

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
  
  // Map resolution to Binance interval
  const resolutionMap = {
    '60': '1m',
    '300': '5m',
    '900': '15m',
    '3600': '1h',
    '14400': '4h',
    '86400': '1d',
  };
  const binanceInterval = resolutionMap[resolution] || '1m';

  // Try Binance first (most accurate, has OHLC data)
  try {
    console.log(`[priceDataClient] Trying Binance for ${symbol}...`);
    const binanceData = await getHistoricalPriceDataFromBinance(symbol, startTimestamp, endTimestamp, binanceInterval);
    if (binanceData && binanceData.length > 0) {
      console.log(`[priceDataClient] Successfully fetched ${binanceData.length} candles from Binance`);
      return binanceData;
    }
  } catch (error) {
    console.warn(`[priceDataClient] Binance failed: ${error.message}`);
  }

  // Fallback to CoinGecko (less accurate, only price data)
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

  // If all fail, return empty array
  console.warn(`[priceDataClient] All data sources failed for ${instrument_name}`);
  return [];
}

