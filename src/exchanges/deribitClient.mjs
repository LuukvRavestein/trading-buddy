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

// ESM module - ensure Node recognizes this as ES module
const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';
const DERIBIT_TESTNET_BASE = 'https://test.deribit.com/api/v2';
const DERIBIT_HISTORY_BASE = 'https://history.deribit.com/api/v2';

// Token cache (in-memory, persists for worker lifetime)
let accessToken = null;
let tokenExpiry = null;

/**
 * Get Deribit environment (test or live)
 * Default to 'live' (mainnet) for production use
 */
function getDeribitEnv() {
  return process.env.DERIBIT_ENV || 'live';
}

/**
 * Get base URL based on environment
 */
function getBaseUrl() {
  return getDeribitEnv() === 'test' ? DERIBIT_TESTNET_BASE : DERIBIT_API_BASE;
}

/**
 * Get history API URL (for mainnet historical data)
 */
function getHistoryBaseUrl() {
  return DERIBIT_HISTORY_BASE;
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
  // Deribit API v2 uses a single endpoint URL for all methods
  // The method name goes in the JSON-RPC request, not in the URL
  const url = `${baseUrl}`;

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
  // Try both slash and dot notation for method name
  let method = endpoint.startsWith('/') ? endpoint.substring(1) : endpoint;
  
  // Try method name with dots instead of slashes (some Deribit endpoints use dots)
  const methodVariants = [
    method, // Original: public/get_tradingview_chart_data
    method.replace(/\//g, '.'), // With dots: public.get_tradingview_chart_data
  ];
  
  let lastError = null;
  let jsonRpcRequest = null;
  
  // Try both method name formats
  const enableDebug = process.env.DERIBIT_DEBUG === '1';
  
  for (const methodName of methodVariants) {
    jsonRpcRequest = {
      jsonrpc: '2.0',
      method: methodName,
      params: params,
      id: requestIdCounter++,
    };
    
    const requestBody = JSON.stringify(jsonRpcRequest);
    
    if (enableDebug) {
      console.log('[deribitClient] 🔍 DEBUG: JSON-RPC request:', {
        url,
        method: methodName,
        jsonRpcRequest: JSON.stringify(jsonRpcRequest, null, 2),
      });
    }
    
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
        // If "Method not found", try next method variant
        if (data.error.code === -32601 || data.error.message?.includes('Method not found')) {
          lastError = new Error(`Deribit API error: ${data.error.message || JSON.stringify(data.error)}`);
          continue; // Try next method variant
        }
        
        // For other errors, log and throw immediately
        console.error(`[deribitClient] API error details:`, {
          endpoint,
          method: methodName,
          params,
          requestBody,
          status: response.status,
          error: data.error,
          fullResponse: JSON.stringify(data).substring(0, 1000),
        });
        
        const errorMsg = data.error?.message || JSON.stringify(data.error) || `HTTP ${response.status}`;
        throw new Error(`Deribit API error: ${errorMsg}`);
      }

      // Success - return result
      const result = data.result || data;
      
      if (enableDebug) {
        console.log('[deribitClient] 🔍 DEBUG: JSON-RPC response:', {
          method: methodName,
          hasResult: !!data.result,
          hasError: !!data.error,
          resultKeys: result ? Object.keys(result) : [],
          resultStatus: result?.status || 'N/A',
        });
      }
      
      return result;
    } catch (error) {
      // If it's "Method not found", try next variant
      if (error.message.includes('Method not found') || error.message.includes('-32601')) {
        lastError = error;
        continue;
      }
      // For other errors, throw immediately
      throw error;
    }
  }
  
  // If all method variants failed, throw last error
  throw lastError || new Error(`Deribit API error: All method name variants failed for ${endpoint}`);
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

  // Consistent timestamp variables: milliseconds (Deribit API expects milliseconds)
  const startMs = Number(startTs);
  const endMs = Number(endTs);

  // Debug logging (behind env var)
  const enableDebug = process.env.DERIBIT_DEBUG === '1';
  
  if (enableDebug) {
    console.log('[deribitClient] 🔍 DEBUG: Timestamp values:', {
      startMs,
      endMs,
      startDate: new Date(startMs).toISOString(),
      endDate: new Date(endMs).toISOString(),
    });
  }

  // Diagnostic mode: test both milliseconds and seconds on mainnet
  const isMainnet = getDeribitEnv() === 'live';
  const enableDiagnostics = process.env.DERIBIT_DIAGNOSTIC_MODE === 'true' && isMainnet;

  if (enableDiagnostics) {
    console.log('[deribitClient] 🔍 DIAGNOSTIC MODE: Testing both timestamp units');
    
    // Calculate seconds for diagnostic testing
    const startSeconds = Math.floor(startMs / 1000);
    const endSeconds = Math.floor(endMs / 1000);
    
    // Test with SECONDS (Deribit standard)
    const paramsSeconds = {
      instrument_name: symbol,
      start_timestamp: startSeconds,
      end_timestamp: endSeconds,
      resolution,
    };
    
    // Test with MILLISECONDS (to verify)
    const paramsMillis = {
      instrument_name: symbol,
      start_timestamp: startMs,
      end_timestamp: endMs,
      resolution,
    };

    console.log('[deribitClient] Testing with SECONDS:', {
      start_timestamp: startSeconds,
      end_timestamp: endSeconds,
      startDate: new Date(startSeconds * 1000).toISOString(),
      endDate: new Date(endSeconds * 1000).toISOString(),
    });

    console.log('[deribitClient] Testing with MILLISECONDS:', {
      start_timestamp: startMs,
      end_timestamp: endMs,
      startDate: new Date(startMs).toISOString(),
      endDate: new Date(endMs).toISOString(),
    });

    // Test seconds first
    try {
      const resultSeconds = await apiRequest('/public/get_tradingview_chart_data', paramsSeconds);
      console.log('[deribitClient] ✅ SECONDS result:', {
        status: resultSeconds.status,
        ticksCount: resultSeconds.ticks?.length || 0,
        firstTick: resultSeconds.ticks?.[0] ? new Date(resultSeconds.ticks[0]).toISOString() : null,
        lastTick: resultSeconds.ticks?.[resultSeconds.ticks?.length - 1] ? new Date(resultSeconds.ticks[resultSeconds.ticks.length - 1]).toISOString() : null,
        responseKeys: Object.keys(resultSeconds),
      });
      
      if (resultSeconds.ticks && resultSeconds.ticks.length > 0) {
        console.log('[deribitClient] ✅ SECONDS works! Using seconds for timestamps');
        return processCandleResult(resultSeconds);
      }
    } catch (error) {
      console.log('[deribitClient] ❌ SECONDS failed:', error.message);
    }

    // Test milliseconds
    try {
      const resultMillis = await apiRequest('/public/get_tradingview_chart_data', paramsMillis);
      console.log('[deribitClient] ✅ MILLISECONDS result:', {
        status: resultMillis.status,
        ticksCount: resultMillis.ticks?.length || 0,
        firstTick: resultMillis.ticks?.[0] ? new Date(resultMillis.ticks[0]).toISOString() : null,
        lastTick: resultMillis.ticks?.[resultMillis.ticks?.length - 1] ? new Date(resultMillis.ticks[resultMillis.ticks.length - 1]).toISOString() : null,
        responseKeys: Object.keys(resultMillis),
      });
      
      if (resultMillis.ticks && resultMillis.ticks.length > 0) {
        console.log('[deribitClient] ✅ MILLISECONDS works! Using milliseconds for timestamps');
        return processCandleResult(resultMillis);
      }
    } catch (error) {
      console.log('[deribitClient] ❌ MILLISECONDS failed:', error.message);
    }

    console.log('[deribitClient] ⚠️  Both timestamp units failed or returned no data');
  }

  // Standard params (use milliseconds - Deribit API expects milliseconds)
  const params = {
    instrument_name: symbol,
    start_timestamp: startMs,
    end_timestamp: endMs,
    resolution,
  };

  if (enableDebug) {
    console.log('[deribitClient] 🔍 DEBUG: Request params:', {
      symbol,
      timeframeMin,
      resolution,
      params: JSON.stringify(params, null, 2),
    });
  }

  try {
    // Try mainnet endpoints first
    if (isMainnet) {
      // Step 1: Test if API is accessible
      try {
        await apiRequest('/public/test', {});
        console.log('[deribitClient] Mainnet API is accessible (public/test OK)');
      } catch (error) {
        console.error('[deribitClient] Mainnet API test failed:', error.message);
        throw new Error(`Mainnet API not accessible: ${error.message}`);
      }
      
      // Step 2: Try get_tradingview_chart_data on mainnet
      const endpoint = '/public/get_tradingview_chart_data';
      try {
        if (enableDebug) {
          console.log('[deribitClient] 🔍 DEBUG: Making JSON-RPC request:', {
            method: endpoint,
            params: JSON.stringify(params, null, 2),
            url: getBaseUrl(),
          });
        }
        
        const result = await apiRequest(endpoint, params);
        
        if (enableDebug) {
          console.log('[deribitClient] 🔍 DEBUG: Raw response:', {
            status: result?.status || 'N/A',
            error: result?.error || null,
            ticksLength: result?.ticks?.length || 0,
            openLength: result?.open?.length || 0,
            highLength: result?.high?.length || 0,
            lowLength: result?.low?.length || 0,
            closeLength: result?.close?.length || 0,
            volumeLength: result?.volume?.length || 0,
            responseKeys: result ? Object.keys(result) : [],
            firstTick: result?.ticks?.[0] || null,
            lastTick: result?.ticks?.[result?.ticks?.length - 1] || null,
          });
        }
        
        console.log(`[deribitClient] ✅ Using chart_data API (mainnet)`);
        return processCandleResult(result);
      } catch (error) {
        // If Method not found, we'll use WebSocket fallback
        if (error.message.includes('Method not found') || error.message.includes('-32601')) {
          console.log(`[deribitClient] ⚠️  chart_data API not available (Method not found)`);
          console.log(`[deribitClient] 🔄 Falling back to WebSocket trades → candles builder`);
          throw new Error('CHART_DATA_NOT_AVAILABLE'); // Special error to trigger WebSocket fallback
        }
        // For other errors, throw immediately
        throw error;
      }
    } else {
      // For testnet, try the standard endpoint
      const endpoint = '/public/get_tradingview_chart_data';
      try {
        if (enableDebug) {
          console.log('[deribitClient] 🔍 DEBUG: Making JSON-RPC request:', {
            method: endpoint,
            params: JSON.stringify(params, null, 2),
            url: getBaseUrl(),
          });
        }
        
        const result = await apiRequest(endpoint, params);
        
        if (enableDebug) {
          console.log('[deribitClient] 🔍 DEBUG: Raw response:', {
            status: result?.status || 'N/A',
            error: result?.error || null,
            ticksLength: result?.ticks?.length || 0,
            openLength: result?.open?.length || 0,
            highLength: result?.high?.length || 0,
            lowLength: result?.low?.length || 0,
            closeLength: result?.close?.length || 0,
            volumeLength: result?.volume?.length || 0,
            responseKeys: result ? Object.keys(result) : [],
            firstTick: result?.ticks?.[0] || null,
            lastTick: result?.ticks?.[result?.ticks?.length - 1] || null,
          });
        }
        
        console.log(`[deribitClient] ✅ Using chart_data API (testnet)`);
        return processCandleResult(result);
      } catch (error) {
        console.error('[deribitClient] Testnet endpoint failed:', error.message);
        throw error;
      }
    }

    // This should not be reached for mainnet (handled above)
    // But keep for testnet fallback
    return processCandleResult(result);
  } catch (error) {
    console.error('[deribitClient] getCandles error:', error);
    throw error;
  }
}

/**
 * Process candle result from Deribit API
 */
function processCandleResult(result) {
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
  // Deribit ticks[] are already in milliseconds (e.g., 1767182340000)
  const candles = [];
  const enableDebug = process.env.DERIBIT_DEBUG === '1';
  
  for (let i = 0; i < result.ticks.length; i++) {
    const tickMs = Number(result.ticks[i]);
    
    // Guard: validate timestamp is reasonable (year between 2009 and 2100)
    const date = new Date(tickMs);
    const year = date.getFullYear();
    
    if (year < 2009 || year > 2100) {
      console.error(`[deribitClient] Invalid timestamp detected: tickMs=${tickMs}, year=${year}, ISO=${date.toISOString()}. Skipping candle.`);
      continue; // Skip this candle
    }
    
    candles.push({
      t: tickMs, // ticks are already in milliseconds, do NOT multiply by 1000
      o: result.open[i],
      h: result.high[i],
      l: result.low[i],
      c: result.close[i],
      v: result.volume[i] || 0,
    });
  }

  // Log first and last tick (once per timeframe) for debugging
  if (candles.length > 0) {
    const firstTickMs = candles[0].t;
    const lastTickMs = candles[candles.length - 1].t;
    const firstTsIso = new Date(firstTickMs).toISOString();
    const lastTsIso = new Date(lastTickMs).toISOString();
    
    console.log('[deribitClient] First and last candle timestamps:', {
      firstTickMs,
      firstTsIso,
      lastTickMs,
      lastTsIso,
      totalCandles: candles.length,
    });
  }

  console.log(`[deribitClient] Successfully fetched ${candles.length} candles`);
  return candles;
}

/**
 * Get candles from Deribit history API (for mainnet)
 * Uses get_last_trades_by_currency and reconstructs OHLC candles
 */
async function getCandlesFromHistory(symbol, timeframeMin, startTs, endTs, resolution) {
  // For now, we'll use a workaround: try to get trades and reconstruct candles
  // Or use a third-party data source
  
  // TODO: Implement proper history API call
  // For now, throw an informative error
  throw new Error(
    'Deribit mainnet does not support get_tradingview_chart_data. ' +
    'Please use testnet (DERIBIT_ENV=test) or implement history.deribit.com API integration.'
  );
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

