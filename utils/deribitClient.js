/**
 * Deribit API Client
 * 
 * Handles authentication and API calls to Deribit for:
 * - Account information
 * - Order placement
 * - Position management
 * 
 * Uses OAuth2 client credentials flow.
 * Requires environment variables:
 * - DERIBIT_CLIENT_ID
 * - DERIBIT_CLIENT_SECRET
 */

const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';
const DERIBIT_TESTNET_BASE = 'https://test.deribit.com/api/v2';

// Token cache (in-memory, resets on serverless function restart)
let accessToken = null;
let tokenExpiry = null;

/**
 * Get OAuth2 access token from Deribit
 * Uses client credentials flow
 * 
 * @param {boolean} useTestnet - Use testnet instead of mainnet
 * @returns {Promise<string>} Access token
 */
async function getAccessToken(useTestnet = false) {
  // Check if we have a valid cached token
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const clientId = process.env.DERIBIT_CLIENT_ID;
  const clientSecret = process.env.DERIBIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('DERIBIT_CLIENT_ID and DERIBIT_CLIENT_SECRET must be set');
  }

  const baseUrl = useTestnet ? DERIBIT_TESTNET_BASE : DERIBIT_API_BASE;
  const authUrl = `${baseUrl}/public/auth`;

  try {
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Deribit auth failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.access_token) {
      throw new Error('No access token in Deribit response');
    }

    // Cache token (expires in ~1 hour, cache for 50 minutes to be safe)
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 : 3600000) - 600000;

    return accessToken;
  } catch (error) {
    console.error('[deribitClient] Auth error:', error);
    throw error;
  }
}

/**
 * Make authenticated API request to Deribit
 * 
 * @param {string} endpoint - API endpoint (e.g., '/private/get_account_summary')
 * @param {object} params - Request parameters
 * @param {boolean} useTestnet - Use testnet instead of mainnet
 * @returns {Promise<object>} API response
 */
async function apiRequest(endpoint, params = {}, useTestnet = false) {
  const token = await getAccessToken(useTestnet);
  const baseUrl = useTestnet ? DERIBIT_TESTNET_BASE : DERIBIT_API_BASE;
  const url = `${baseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const errorMsg = data.error?.message || data.error || `HTTP ${response.status}`;
      throw new Error(`Deribit API error: ${errorMsg}`);
    }

    return data.result || data;
  } catch (error) {
    console.error(`[deribitClient] API request error (${endpoint}):`, error);
    throw error;
  }
}

/**
 * Get account summary (balance, equity, etc.)
 * 
 * @param {string} currency - Currency (default: 'BTC')
 * @param {boolean} useTestnet - Use testnet
 * @returns {Promise<object>} Account summary with balance, equity, available funds, etc.
 */
export async function getAccountSummary(currency = 'BTC', useTestnet = false) {
  try {
    const result = await apiRequest('/private/get_account_summary', { currency }, useTestnet);
    return result;
  } catch (error) {
    console.error('[deribitClient] getAccountSummary error:', error);
    throw error;
  }
}

/**
 * Place an order on Deribit
 * 
 * @param {object} orderParams - Order parameters
 * @param {string} orderParams.instrument_name - Instrument (e.g., 'BTC-PERPETUAL')
 * @param {string} orderParams.side - 'buy' or 'sell'
 * @param {string} orderParams.type - Order type: 'limit', 'market', 'stop_limit', etc.
 * @param {number} orderParams.amount - Order size (in contracts)
 * @param {number} [orderParams.price] - Price (required for limit orders)
 * @param {number} [orderParams.stop_price] - Stop price (for stop orders)
 * @param {string} [orderParams.time_in_force] - 'good_til_cancelled', 'fill_or_kill', etc.
 * @param {boolean} useTestnet - Use testnet
 * @returns {Promise<object>} Order result with order_id, etc.
 */
export async function placeOrder(orderParams, useTestnet = false) {
  const {
    instrument_name,
    side,
    type = 'limit',
    amount,
    price,
    stop_price,
    time_in_force = 'good_til_cancelled',
  } = orderParams;

  if (!instrument_name || !side || !amount) {
    throw new Error('Missing required order parameters: instrument_name, side, amount');
  }

  if (type === 'limit' && !price) {
    throw new Error('Price is required for limit orders');
  }

  // Deribit uses 'buy' and 'sell' endpoints
  const endpoint = side.toLowerCase() === 'buy' ? '/private/buy' : '/private/sell';

  const params = {
    instrument_name,
    amount,
    type,
    time_in_force,
  };

  if (price) params.price = price;
  if (stop_price) params.stop_price = stop_price;

  try {
    const result = await apiRequest(endpoint, params, useTestnet);
    return result;
  } catch (error) {
    console.error('[deribitClient] placeOrder error:', error);
    throw error;
  }
}

/**
 * Get open positions
 * 
 * @param {string} currency - Currency filter (default: 'BTC')
 * @param {string} kind - Instrument kind: 'future', 'option', 'spot' (optional)
 * @param {boolean} useTestnet - Use testnet
 * @returns {Promise<array>} Array of open positions
 */
export async function getOpenPositions(currency = 'BTC', kind = null, useTestnet = false) {
  const params = { currency };
  if (kind) params.kind = kind;

  try {
    const result = await apiRequest('/private/get_positions', params, useTestnet);
    // Filter out positions with size 0 (closed positions)
    return (result || []).filter(pos => Math.abs(pos.size) > 0);
  } catch (error) {
    console.error('[deribitClient] getOpenPositions error:', error);
    throw error;
  }
}

/**
 * Close a position (by placing opposite order)
 * 
 * @param {object} closeParams - Close position parameters
 * @param {string} closeParams.instrument_name - Instrument (e.g., 'BTC-PERPETUAL')
 * @param {string} closeParams.type - Order type: 'market' (recommended) or 'limit'
 * @param {number} [closeParams.price] - Price (for limit orders)
 * @param {boolean} useTestnet - Use testnet
 * @returns {Promise<object>} Order result
 */
export async function closePosition(closeParams, useTestnet = false) {
  const { instrument_name, type = 'market', price } = closeParams;

  if (!instrument_name) {
    throw new Error('instrument_name is required to close position');
  }

  try {
    // First, get current position to determine side
    const positions = await getOpenPositions(null, null, useTestnet);
    const position = positions.find(p => p.instrument_name === instrument_name);

    if (!position || Math.abs(position.size) === 0) {
      throw new Error(`No open position found for ${instrument_name}`);
    }

    // Determine opposite side
    const side = position.size > 0 ? 'sell' : 'buy';
    const amount = Math.abs(position.size);

    // Place opposite order to close
    return await placeOrder({
      instrument_name,
      side,
      type,
      amount,
      price,
    }, useTestnet);
  } catch (error) {
    console.error('[deribitClient] closePosition error:', error);
    throw error;
  }
}

/**
 * Get current price for an instrument
 * 
 * @param {string} instrument_name - Instrument (e.g., 'BTC-PERPETUAL')
 * @param {boolean} useTestnet - Use testnet
 * @returns {Promise<number>} Current mark price
 */
export async function getCurrentPrice(instrument_name, useTestnet = false) {
  try {
    const result = await apiRequest('/public/get_book_summary_by_instrument', {
      instrument_name,
    }, useTestnet);
    
    // Return mark price if available, otherwise settlement price
    return result?.mark_price || result?.settlement_price || null;
  } catch (error) {
    console.error('[deribitClient] getCurrentPrice error:', error);
    throw error;
  }
}

/**
 * Get historical price data (candlesticks) from Deribit
 * This uses Deribit's TradingView chart data endpoint
 * 
 * @param {string} instrument_name - Instrument (e.g., 'BTC-PERPETUAL')
 * @param {number} startTimestamp - Start timestamp in milliseconds
 * @param {number} endTimestamp - End timestamp in milliseconds
 * @param {string} resolution - Timeframe: '60', '300', '900', '3600', '14400', '86400' (1m, 5m, 15m, 1h, 4h, 1d)
 * @param {boolean} useTestnet - Use testnet
 * @returns {Promise<array>} Array of candlestick data: [{t: timestamp, o: open, h: high, l: low, c: close, v: volume}, ...]
 */
export async function getHistoricalPriceData(instrument_name, startTimestamp, endTimestamp, resolution = '60', useTestnet = false) {
  try {
    // Deribit expects timestamps in milliseconds
    const startSeconds = Math.floor(startTimestamp / 1000);
    const endSeconds = Math.floor(endTimestamp / 1000);

    const result = await apiRequest('/public/get_tradingview_chart_data', {
      instrument_name,
      start_timestamp: startSeconds,
      end_timestamp: endSeconds,
      resolution,
    }, useTestnet);

    // Deribit returns data in format: {ticks: [timestamps], status: "ok", volume: [volumes], open: [opens], close: [closes], high: [highs], low: [lows]}
    if (!result || !result.ticks || result.ticks.length === 0) {
      return [];
    }

    // Convert to array of candlestick objects
    const candles = [];
    for (let i = 0; i < result.ticks.length; i++) {
      candles.push({
        t: result.ticks[i] * 1000, // Convert to milliseconds
        o: result.open[i],
        h: result.high[i],
        l: result.low[i],
        c: result.close[i],
        v: result.volume[i] || 0,
      });
    }

    return candles;
  } catch (error) {
    console.error('[deribitClient] getHistoricalPriceData error:', error);
    throw error;
  }
}

