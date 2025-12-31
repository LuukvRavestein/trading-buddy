/**
 * Deribit API Client
 * 
 * Handles authentication and API calls to Deribit.
 * Designed for cloud worker (not serverless).
 * 
 * Environment variables:
 * - DERIBIT_CLIENT_ID
 * - DERIBIT_CLIENT_SECRET
 * - DERIBIT_ENV (default: 'test')
 */

const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';
const DERIBIT_TESTNET_BASE = 'https://test.deribit.com/api/v2';

// Token cache (in-memory, persists for worker lifetime)
let accessToken = null;
let tokenExpiry = null;

/**
 * Get Deribit environment (test or live)
 */
function getDeribitEnv() {
  return process.env.DERIBIT_ENV || 'test';
}

/**
 * Get base URL based on environment
 */
function getBaseUrl() {
  return getDeribitEnv() === 'test' ? DERIBIT_TESTNET_BASE : DERIBIT_API_BASE;
}

/**
 * Get OAuth2 access token from Deribit
 * Uses client credentials flow
 * 
 * @returns {Promise<string>} Access token
 */
async function getAccessToken() {
  // Check if we have a valid cached token
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const clientId = process.env.DERIBIT_CLIENT_ID;
  const clientSecret = process.env.DERIBIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('DERIBIT_CLIENT_ID and DERIBIT_CLIENT_SECRET must be set');
  }

  const baseUrl = getBaseUrl();
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
 * @param {string} endpoint - API endpoint (e.g., '/public/get_tradingview_chart_data')
 * @param {object} params - Request parameters
 * @returns {Promise<object>} API response
 */
// JSON-RPC 2.0 request ID counter
let requestIdCounter = 1;

async function apiRequest(endpoint, params = {}) {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  // Public endpoints don't need auth
  const isPublic = endpoint.startsWith('/public/');
  
  let headers = {
    'Content-Type': 'application/json',
  };

  if (!isPublic) {
    const token = await getAccessToken();
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Deribit uses JSON-RPC 2.0 format for all API calls
  // Convert endpoint to method name (remove leading slash)
  const method = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
  
  const jsonRpcRequest = {
    jsonrpc: '2.0',
    method: method,
    params: params,
    id: requestIdCounter++,
  };

  const requestBody = JSON.stringify(jsonRpcRequest);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: requestBody,
    });

    let data;
    try {
      data = await response.json();
    } catch (jsonError) {
      const text = await response.text();
      console.error(`[deribitClient] Failed to parse JSON response:`, {
        endpoint,
        status: response.status,
        responseText: text.substring(0, 500),
      });
      throw new Error(`Invalid JSON response from Deribit: ${text.substring(0, 200)}`);
    }

    // JSON-RPC 2.0 error handling
    if (data.error) {
      // Log full error details for debugging
      console.error(`[deribitClient] API error details:`, {
        endpoint,
        method,
        params,
        requestBody,
        status: response.status,
        error: data.error,
        fullResponse: JSON.stringify(data).substring(0, 1000),
      });
      
      const errorMsg = data.error?.message || JSON.stringify(data.error) || `HTTP ${response.status}`;
      throw new Error(`Deribit API error: ${errorMsg}`);
    }

    // JSON-RPC 2.0 success response contains result
    return data.result || data;
  } catch (error) {
    console.error(`[deribitClient] API request error (${endpoint}):`, error);
    throw error;
  }
}

/**
 * Get candles from Deribit
 * Uses the TradingView-style chart data endpoint
 * 
 * @param {object} options
 * @param {string} options.symbol - Instrument name (e.g., 'BTC-PERPETUAL')
 * @param {number} options.timeframeMin - Timeframe in minutes (1, 5, 15, 60, etc.)
 * @param {number} options.startTs - Start timestamp (milliseconds)
 * @param {number} options.endTs - End timestamp (milliseconds)
 * @returns {Promise<Array>} Array of candle objects {t, o, h, l, c, v}
 */
export async function getCandles({ symbol, timeframeMin, startTs, endTs }) {
  if (!symbol || !timeframeMin || !startTs || !endTs) {
    throw new Error('Missing required parameters: symbol, timeframeMin, startTs, endTs');
  }

  // Convert timeframe to Deribit resolution
  // Deribit uses: 1, 3, 5, 15, 30, 60, 120, 180, 360, 720, "1D", "1W"
  const resolutionMap = {
    1: '1',
    3: '3',
    5: '5',
    15: '15',
    30: '30',
    60: '60',
    120: '120',
    180: '180',
    360: '360',
    720: '720',
    1440: '1D',
    10080: '1W',
  };

  const resolution = resolutionMap[timeframeMin];
  if (!resolution) {
    throw new Error(`Unsupported timeframe: ${timeframeMin} minutes`);
  }

  // Convert timestamps to seconds (Deribit uses seconds)
  const startSeconds = Math.floor(startTs / 1000);
  const endSeconds = Math.floor(endTs / 1000);

  try {
    // Deribit API expects specific parameter format
    // Try the standard format first
    const params = {
      instrument_name: symbol,
      start_timestamp: startSeconds,
      end_timestamp: endSeconds,
      resolution,
    };

    console.log(`[deribitClient] Fetching candles:`, {
      symbol,
      timeframeMin,
      resolution,
      startSeconds,
      endSeconds,
      startDate: new Date(startTs).toISOString(),
      endDate: new Date(endTs).toISOString(),
    });

    const result = await apiRequest('/public/get_tradingview_chart_data', params);

    // Deribit returns data in format: {ticks: [timestamps], status: "ok", volume: [volumes], open: [opens], close: [closes], high: [highs], low: [lows]}
    if (!result) {
      console.warn('[deribitClient] No result returned from Deribit');
      return [];
    }

    if (!result.ticks || result.ticks.length === 0) {
      // Log warning only if status is not 'no_data' (which is expected for testnet)
      if (result.status !== 'no_data') {
        console.warn('[deribitClient] No ticks in result:', { result });
      } else {
        // "no_data" is normal for testnet or when requesting unavailable periods
        console.log(`[deribitClient] No data available for period (status: no_data)`);
      }
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

    console.log(`[deribitClient] Successfully fetched ${candles.length} candles`);
    return candles;
  } catch (error) {
    console.error('[deribitClient] getCandles error:', error);
    throw error;
  }
}

/**
 * Get account summary (for future use in live trading)
 * 
 * @param {string} currency - Currency (default: 'BTC')
 * @returns {Promise<object>} Account summary
 */
export async function getAccountSummary(currency = 'BTC') {
  try {
    return await apiRequest('/private/get_account_summary', { currency });
  } catch (error) {
    console.error('[deribitClient] getAccountSummary error:', error);
    throw error;
  }
}

/**
 * Place an order (for future use in live trading)
 * 
 * @param {object} orderParams - Order parameters
 * @returns {Promise<object>} Order result
 */
export async function placeOrder(orderParams) {
  try {
    const { instrument_name, side, type = 'limit', amount, price, time_in_force = 'good_til_cancelled' } = orderParams;

    if (!instrument_name || !side || !amount) {
      throw new Error('Missing required order parameters: instrument_name, side, amount');
    }

    if (type === 'limit' && !price) {
      throw new Error('Price is required for limit orders');
    }

    const endpoint = side.toLowerCase() === 'buy' ? '/private/buy' : '/private/sell';

    const params = {
      instrument_name,
      amount,
      type,
      time_in_force,
    };

    if (price) params.price = price;

    return await apiRequest(endpoint, params);
  } catch (error) {
    console.error('[deribitClient] placeOrder error:', error);
    throw error;
  }
}

