/**
 * Supabase Client for Trading Buddy Worker
 * 
 * Handles connection to Supabase database using service role key.
 * Designed for cloud worker (not serverless).
 * 
 * Environment variables:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 */

let supabaseClient = null;
let isConfigured = false;

/**
 * Initialize Supabase client
 * 
 * @returns {object|null} Supabase client or null if not configured
 */
export function getSupabaseClient() {
  // Return cached client if already initialized
  if (supabaseClient !== null) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  // Diagnostic logging
  let urlHostname = 'unknown';
  let projectRef = 'unknown';
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      urlHostname = url.hostname;
      // Extract project ref from subdomain (e.g., xxxxx.supabase.co -> xxxxx)
      const parts = urlHostname.split('.');
      if (parts.length > 0 && parts[0] !== 'www') {
        projectRef = parts[0];
      }
    } catch (e) {
      // Invalid URL format
    }
  }

  const hasServiceRoleKey = !!serviceRoleKey;
  const hasAnonKey = !!anonKey;
  let selectedKeyType = 'missing';

  if (hasServiceRoleKey) {
    selectedKeyType = 'service_role';
  } else if (hasAnonKey) {
    selectedKeyType = 'anon';
  }

  console.log('[supabase] Diagnostic info:', {
    urlHostname,
    projectRef,
    hasServiceRoleKey,
    hasAnonKey,
    selectedKeyType,
  });

  // Check if Supabase is configured
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[supabase] Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    isConfigured = false;
    return null;
  }

  try {
    isConfigured = true;
    supabaseClient = {
      url: supabaseUrl,
      key: serviceRoleKey,
    };
    
    console.log('[supabase] Supabase client initialized');
    return supabaseClient;
  } catch (error) {
    console.error('[supabase] Failed to initialize Supabase client:', error);
    isConfigured = false;
    return null;
  }
}

/**
 * Check if Supabase is configured
 * 
 * @returns {boolean}
 */
export function isSupabaseConfigured() {
  if (supabaseClient === null) {
    getSupabaseClient();
  }
  return isConfigured;
}

/**
 * Health check: Test if strategy_runs table is accessible via REST
 * 
 * @returns {Promise<object>} { success: boolean, error?: string, status?: number }
 */
export async function healthCheckStrategyRuns() {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client not initialized' };
  }

  try {
    // Extract hostname for logging
    let urlHostname = 'unknown';
    let selectedKeyType = 'service_role'; // We use service_role key
    try {
      const url = new URL(client.url);
      urlHostname = url.hostname;
    } catch (e) {
      // Invalid URL
    }

    const url = `${client.url}/rest/v1/strategy_runs?select=id&limit=1`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[supabase] Health check failed:', {
        urlHostname,
        selectedKeyType,
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 500),
      });
      return {
        success: false,
        status: response.status,
        error: errorText.substring(0, 500),
        urlHostname,
        selectedKeyType,
      };
    }

    console.log('[supabase] Health check passed: strategy_runs visible via REST', {
      urlHostname,
      selectedKeyType,
    });
    return { success: true, urlHostname, selectedKeyType };
  } catch (error) {
    console.error('[supabase] Health check error:', {
      error: error.message,
      urlHostname: client.url ? new URL(client.url).hostname : 'unknown',
      selectedKeyType: 'service_role',
    });
    return { success: false, error: error.message };
  }
}

/**
 * Make a Supabase REST API request
 * 
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {object} body - Request body
 * @param {object} options - Additional options (filters, etc.)
 * @returns {Promise<object>} Response data
 */
async function supabaseRequest(method, path, body = null, options = {}) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Build query string from options
  let queryString = '';
  if (options.filters) {
    const filters = Object.entries(options.filters)
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    if (filters) queryString = '?' + filters;
  }

  const url = `${client.url}/rest/v1/${path}${queryString}`;
  const headers = {
    'apikey': client.key,
    'Authorization': `Bearer ${client.key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  // Add select header if specified
  if (options.select) {
    headers['Prefer'] = `return=representation,resolution=merge-duplicates`;
    queryString = queryString ? `${queryString}&select=${options.select}` : `?select=${options.select}`;
  }

  const requestOptions = {
    method,
    headers,
  };

  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    requestOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, requestOptions);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[supabase] API error (${method} ${path}):`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 500),
      });
      throw new Error(`Supabase API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return [];
    }

    // Handle JSON responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const data = await response.json();
        return Array.isArray(data) ? data : [data];
      } catch (jsonError) {
        console.error(`[supabase] JSON parse error (${method} ${path}):`, jsonError);
        return [];
      }
    }
    
    return [];
  } catch (error) {
    console.error(`[supabase] Request error (${method} ${path}):`, error);
    throw error;
  }
}

// ============================================================================
// CANDLES OPERATIONS
// ============================================================================

/**
 * Normalize timestamp to ISO string format
 * Handles various input formats and prevents invalid dates
 * 
 * @param {string|number|Date} input - Timestamp in various formats
 * @returns {string} ISO string timestamp
 * @throws {Error} If input cannot be converted to valid timestamp
 */
function normalizeTs(input) {
  if (typeof input === 'string') {
    // Assume ISO string, but validate year range
    const date = new Date(input);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid ISO string timestamp: ${input}`);
    }
    const year = date.getFullYear();
    if (year < 2009 || year > 2100) {
      throw new Error(`Invalid year in ISO string: ${year} (from ${input})`);
    }
    return input; // Return as-is if valid
  }
  
  if (input instanceof Date) {
    return input.toISOString();
  }
  
  if (typeof input === 'number') {
    let date;
    // If number < 1e11 (100000000000), treat as seconds and convert to ms
    // Otherwise treat as milliseconds
    if (input < 1e11) {
      date = new Date(input * 1000);
    } else {
      date = new Date(input);
    }
    
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid numeric timestamp: ${input}`);
    }
    
    return date.toISOString();
  }
  
  throw new Error(`Unsupported timestamp type: ${typeof input} (value: ${input})`);
}

/**
 * Upsert candles (insert or update if exists)
 * Uses PostgREST UPSERT via ON CONFLICT
 * 
 * Normalizes all timestamps before upserting to prevent invalid date errors.
 * Skips candles with invalid timestamps (year < 2009 or > 2100).
 * 
 * @param {Array} candles - Array of candle objects with ts field
 * @returns {Promise<Array>} Upserted candles
 */
export async function upsertCandles(candles) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  if (!candles || candles.length === 0) {
    return [];
  }

  const enableDebug = process.env.SUPABASE_DEBUG === '1';
  
  // Normalize all timestamps and filter out invalid ones
  const validCandles = [];
  const skippedCandles = [];
  let minYear = Infinity;
  let maxYear = -Infinity;
  let sampleFirstTs = null;
  let sampleFirstTsType = null;
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    
    try {
      // Normalize the timestamp
      const normalizedTs = normalizeTs(candle.ts);
      const date = new Date(normalizedTs);
      const year = date.getFullYear();
      
      // Guard: validate year range (2009-2100)
      if (year < 2009 || year > 2100) {
        const timeframeMin = candle.timeframe_min || 'unknown';
        console.error(`[supabase] Invalid timestamp year: ${year} (ts: ${candle.ts}, timeframe: ${timeframeMin}). Skipping candle.`);
        skippedCandles.push({ index: i, ts: candle.ts, year, timeframeMin });
        continue; // Skip this candle
      }
      
      // Track min/max year for logging
      if (year < minYear) minYear = year;
      if (year > maxYear) maxYear = year;
      
      // Capture first candle's ts for logging
      if (i === 0) {
        sampleFirstTs = normalizedTs;
        sampleFirstTsType = typeof candle.ts;
      }
      
      // Add normalized candle
      validCandles.push({
        ...candle,
        ts: normalizedTs,
      });
    } catch (error) {
      const timeframeMin = candle.timeframe_min || 'unknown';
      console.error(`[supabase] Failed to normalize timestamp (ts: ${candle.ts}, timeframe: ${timeframeMin}):`, error.message);
      skippedCandles.push({ index: i, ts: candle.ts, error: error.message, timeframeMin });
      continue; // Skip this candle
    }
  }
  
  // Debug logging
  if (enableDebug) {
    const timeframeMin = validCandles.length > 0 
      ? validCandles[0].timeframe_min 
      : (candles.length > 0 ? candles[0].timeframe_min : 'unknown');
    
    console.log('[supabase] 🔍 DEBUG: Normalized candles before upsert:', {
      timeframeMin,
      totalInput: candles.length,
      validCount: validCandles.length,
      skippedCount: skippedCandles.length,
      sampleFirstTs,
      sampleFirstTsType,
      minYear: minYear === Infinity ? null : minYear,
      maxYear: maxYear === -Infinity ? null : maxYear,
      skippedDetails: skippedCandles.length > 0 ? skippedCandles.slice(0, 5) : [], // Show first 5 skipped
    });
  }
  
  if (validCandles.length === 0) {
    const timeframeMin = candles.length > 0 ? candles[0].timeframe_min : 'unknown';
    console.warn(`[supabase] No valid candles to upsert after normalization (timeframe: ${timeframeMin}, skipped: ${skippedCandles.length})`);
    return [];
  }

  try {
    // PostgREST UPSERT: use PATCH with Prefer: resolution=merge-duplicates
    // and specify the unique constraint columns in the URL
    const client = getSupabaseClient();
    const url = `${client.url}/rest/v1/candles?on_conflict=symbol,timeframe_min,ts`;
    
    const headers = {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(validCandles),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [data];
  } catch (error) {
    console.error('[supabase] Failed to upsert candles:', error);
    throw error;
  }
}

/**
 * Get latest candles
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {number} options.timeframeMin
 * @param {number} options.limit
 * @returns {Promise<Array>} Array of candles
 */
export async function getLatestCandles({ symbol, timeframeMin, limit = 500 }) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    // Query with explicit ordering by ts descending (newest first)
    const url = `${client.url}/rest/v1/candles?symbol=eq.${symbol}&timeframe_min=eq.${timeframeMin}&order=ts.desc&limit=${limit}&select=*`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[supabase] Failed to get latest candles: ${response.status} ${errorText}`);
      return [];
    }

    const data = await response.json();
    // Data is already ordered desc (newest first), return as-is
    // State builder will sort ascending if needed
    return data || [];
  } catch (error) {
    console.error('[supabase] Failed to get candles:', error);
    return [];
  }
}

/**
 * Get latest single candle for a symbol and timeframe
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {number} options.timeframeMin
 * @returns {Promise<object|null>} Latest candle or null
 */
export async function getLatestCandle({ symbol, timeframeMin }) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const url = `${client.url}/rest/v1/candles?symbol=eq.${symbol}&timeframe_min=eq.${timeframeMin}&order=ts.desc&limit=1&select=*`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[supabase] Failed to get latest candle: ${response.status} ${errorText}`);
      return null;
    }

    const data = await response.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('[supabase] Failed to get latest candle:', error);
    return null;
  }
}

/**
 * Get next candle after a timestamp
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {number} options.timeframeMin
 * @param {string|Date} options.afterTs - ISO string or Date
 * @returns {Promise<object|null>} Next candle or null
 */
export async function getNextCandle({ symbol, timeframeMin = 1, afterTs }) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const afterTsIso = afterTs instanceof Date ? afterTs.toISOString() : afterTs;
    const result = await supabaseRequest('GET', 'candles', null, {
      filters: {
        symbol: `eq.${symbol}`,
        timeframe_min: `eq.${timeframeMin}`,
        ts: `gt.${afterTsIso}`,
      },
      order: 'ts.asc',
      limit: 1,
      select: '*',
    });
    return result && result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error('[supabase] Failed to get next candle:', error);
    return null;
  }
}

/**
 * Get candles between two timestamps
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {number} options.timeframeMin
 * @param {string|Date} options.startTs - ISO string or Date
 * @param {string|Date} options.endTs - ISO string or Date
 * @param {number} options.limit - Max candles to return
 * @returns {Promise<Array>} Array of candles
 */
export async function getCandlesBetween({ symbol, timeframeMin = 1, startTs, endTs, limit = 10000 }) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const startTsIso = startTs instanceof Date ? startTs.toISOString() : startTs;
    const endTsIso = endTs instanceof Date ? endTs.toISOString() : endTs;
    
    const client = getSupabaseClient();
    // Build URL with filters - Supabase uses & for multiple filters
    const url = `${client.url}/rest/v1/candles?symbol=eq.${symbol}&timeframe_min=eq.${timeframeMin}&ts=gte.${startTsIso}&ts=lte.${endTsIso}&order=ts.asc&limit=${limit}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[supabase] Failed to get candles between: ${response.status} ${errorText}`);
      return [];
    }
    
    const result = await response.json();
    
    // Filter manually to ensure we're within range (in case of timezone issues)
    if (result && result.length > 0) {
      const start = new Date(startTsIso);
      const end = new Date(endTsIso);
      return result.filter(c => {
        const candleTs = new Date(c.ts);
        return candleTs >= start && candleTs <= end;
      });
    }
    
    return result || [];
  } catch (error) {
    console.error('[supabase] Failed to get candles between:', error);
    return [];
  }
}

// ============================================================================
// TIMEFRAME_STATE OPERATIONS
// ============================================================================

/**
 * Upsert timeframe state
 * Uses PostgREST UPSERT via ON CONFLICT
 * 
 * @param {object} state - State object
 * @returns {Promise<object>} Upserted state
 */
export async function upsertTimeframeState(state) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    // Ensure timeframe_min is integer
    const stateToUpsert = {
      ...state,
      timeframe_min: parseInt(state.timeframe_min, 10),
    };
    
    // Verify required fields
    if (!stateToUpsert.symbol || !stateToUpsert.timeframe_min || !stateToUpsert.ts) {
      throw new Error(`Missing required fields: symbol=${stateToUpsert.symbol}, timeframe_min=${stateToUpsert.timeframe_min}, ts=${stateToUpsert.ts}`);
    }
    
    const client = getSupabaseClient();
    const url = `${client.url}/rest/v1/timeframe_state?on_conflict=symbol,timeframe_min,ts`;
    
    const headers = {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(stateToUpsert),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[supabase] Upsert failed for state:`, {
        symbol: stateToUpsert.symbol,
        timeframe_min: stateToUpsert.timeframe_min,
        ts: stateToUpsert.ts,
        error: errorText.substring(0, 500),
      });
      throw new Error(`Supabase API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    const result = Array.isArray(data) ? data[0] : data;
    
    console.log(`[supabase] ✅ Upserted timeframe_state:`, {
      symbol: result.symbol,
      timeframe_min: result.timeframe_min,
      ts: result.ts,
    });
    
    return result;
  } catch (error) {
    console.error('[supabase] Failed to upsert timeframe state:', error);
    throw error;
  }
}

/**
 * Get latest timeframe state
 * ALWAYS orders by ts descending to get the most recent state
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {number} options.timeframeMin
 * @returns {Promise<object|null>} Latest state or null
 */
export async function getLatestTimeframeState({ symbol, timeframeMin }) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    // Query with explicit ordering by ts descending (NOT created_at)
    const url = `${client.url}/rest/v1/timeframe_state?symbol=eq.${symbol}&timeframe_min=eq.${timeframeMin}&order=ts.desc&limit=1&select=*`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[supabase] Failed to get latest timeframe state: ${response.status} ${errorText}`);
      return null;
    }

    const data = await response.json();
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    console.error('[supabase] Failed to get timeframe state:', error);
    return null;
  }
}

// ============================================================================
// TRADE_PROPOSALS OPERATIONS
// ============================================================================

/**
 * Insert trade proposal
 * 
 * @param {object} proposal - Proposal object
 * @returns {Promise<object>} Inserted proposal
 */
export async function insertTradeProposal(proposal) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('POST', 'trade_proposals', proposal, {
      select: '*',
    });
    return result[0] || proposal;
  } catch (error) {
    console.error('[supabase] Failed to insert trade proposal:', error);
    throw error;
  }
}

/**
 * Update trade proposal
 * 
 * @param {string} proposalId - Proposal ID
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated proposal
 */
export async function updateTradeProposal(proposalId, updateData) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('PATCH', `trade_proposals?id=eq.${proposalId}`, updateData, {
      select: '*',
    });
    return result[0] || null;
  } catch (error) {
    console.error('[supabase] Failed to update trade proposal:', error);
    throw error;
  }
}

// ============================================================================
// PAPER STATS OPERATIONS
// ============================================================================

/**
 * Insert or upsert daily stats
 * 
 * @param {Array} statsRows - Array of daily stat objects
 * @returns {Promise<Array>} Upserted stats
 */
export async function insertOrUpsertDailyStats(statsRows) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  if (!statsRows || statsRows.length === 0) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    const url = `${client.url}/rest/v1/paper_stats_daily?on_conflict=symbol,date`;
    
    const headers = {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(statsRows),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [data];
  } catch (error) {
    console.error('[supabase] Failed to upsert daily stats:', error);
    throw error;
  }
}

// ============================================================================
// PAPER_TRADES OPERATIONS
// ============================================================================

/**
 * Insert paper trade
 * 
 * @param {object} trade - Trade object
 * @returns {Promise<object>} Inserted trade
 */
export async function insertPaperTrade(trade) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('POST', 'paper_trades', trade, {
      select: '*',
    });
    return result[0] || trade;
  } catch (error) {
    console.error('[supabase] Failed to insert paper trade:', error);
    throw error;
  }
}

/**
 * Update paper trade
 * 
 * @param {string} tradeId - Trade ID
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated trade
 */
export async function updatePaperTrade(tradeId, updateData) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('PATCH', `paper_trades?id=eq.${tradeId}`, updateData, {
      select: '*',
    });
    return result[0] || null;
  } catch (error) {
    console.error('[supabase] Failed to update paper trade:', error);
    throw error;
  }
}

// ============================================================================
// BACKTEST OPERATIONS
// ============================================================================

/**
 * Create a new strategy run
 * 
 * @param {object} runData - Run data
 * @returns {Promise<object>} Created run
 */
export async function createStrategyRun(runData) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('POST', 'strategy_runs', runData, {
      select: '*',
    });
    return result[0] || runData;
  } catch (error) {
    console.error('[supabase] Failed to create strategy run:', error);
    throw error;
  }
}

/**
 * Update strategy run
 * 
 * @param {string} runId - Run ID
 * @param {object} updateData - Data to update (status, results, error, completed_at)
 * @returns {Promise<object>} Updated run
 */
export async function updateStrategyRun(runId, updateData) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    // Ensure results is always a JSON object (not null)
    if (updateData.results === null || updateData.results === undefined) {
      updateData.results = {};
    }
    
    // Set completed_at if status is 'done' or 'failed'
    if ((updateData.status === 'done' || updateData.status === 'failed') && !updateData.completed_at) {
      updateData.completed_at = new Date().toISOString();
    }
    
    const result = await supabaseRequest('PATCH', `strategy_runs?id=eq.${runId}`, updateData, {
      select: '*',
    });
    return result[0] || null;
  } catch (error) {
    console.error('[supabase] Failed to update strategy run:', error);
    throw error;
  }
}

/**
 * Insert strategy trade
 * 
 * @param {object} trade - Trade object
 * @returns {Promise<object>} Inserted trade
 */
export async function insertStrategyTrade(trade) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('POST', 'strategy_trades', trade, {
      select: '*',
    });
    return result[0] || trade;
  } catch (error) {
    console.error('[supabase] Failed to insert strategy trade:', error);
    throw error;
  }
}

/**
 * Get candles for a time range using RPC function (more efficient for large datasets)
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {number} options.timeframeMin
 * @param {string} options.startTs - ISO timestamp
 * @param {string} options.endTs - ISO timestamp
 * @returns {Promise<Array>} Array of candles
 */
/**
 * Call RPC get_candles_range for a single time window
 */
async function getCandlesInRangeRPCSingle({ symbol, timeframeMin, startTs, endTs }) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const client = getSupabaseClient();
    const url = `${client.url}/rest/v1/rpc/get_candles_range`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        p_symbol: symbol,
        p_timeframe_min: timeframeMin,
        p_start_ts: startTs,
        p_end_ts: endTs,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[supabase] RPC get_candles_range failed: ${response.status} ${errorText}`);
      return null; // Return null to indicate failure (not empty array)
    }

    const data = await response.json();
    return data || [];
  } catch (error) {
    console.error('[supabase] RPC get_candles_range error:', error);
    return null; // Return null to indicate failure
  }
}

/**
 * Get candles via RPC with time-slicing pagination
 * PostgREST may limit RPC responses to 1000 rows, so we paginate by time windows
 */
async function getCandlesInRangeRPC({ symbol, timeframeMin, startTs, endTs, batchLimit = 5000 }) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const startMs = new Date(startTs).getTime();
  const endMs = new Date(endTs).getTime();
  const tfMs = timeframeMin * 60 * 1000;
  
  // Calculate window size: use conservative limit to stay under PostgREST 1000 row limit
  // Use 800 candles max per window to be safe (PostgREST default is often 1000)
  const safeBatchLimit = Math.min(batchLimit, 800);
  const maxWindowMinutes = 60 * 24 * 7; // Cap at 7 days
  const windowMinutes = Math.min(safeBatchLimit * timeframeMin, maxWindowMinutes);
  const windowMs = windowMinutes * 60 * 1000;
  
  const allCandles = [];
  let cursorMs = startMs;
  let page = 0;
  const seenTimestamps = new Set(); // For deduplication
  
  console.log(`[supabase] RPC pagination: ${symbol} ${timeframeMin}m from ${startTs} to ${endTs} (window: ${windowMinutes} minutes)`);
  
  while (cursorMs < endMs) {
    page++;
    const windowEndMs = Math.min(cursorMs + windowMs, endMs);
    const windowStartIso = new Date(cursorMs).toISOString();
    const windowEndIso = new Date(windowEndMs).toISOString();
    
    try {
      const pageCandles = await getCandlesInRangeRPCSingle({
        symbol,
        timeframeMin,
        startTs: windowStartIso,
        endTs: windowEndIso,
      });
      
      if (pageCandles === null) {
        // RPC failed for this window, move forward
        console.warn(`[supabase] RPC failed for window ${windowStartIso} to ${windowEndIso}, moving forward`);
        cursorMs = windowEndMs + tfMs;
        continue;
      }
      
      if (pageCandles.length === 0) {
        // No candles in this window, move forward
        cursorMs = windowEndMs + tfMs;
        continue;
      }
      
      // Deduplicate: filter out candles we've already seen
      const newCandles = pageCandles.filter(c => {
        const tsKey = `${c.ts}`;
        if (seenTimestamps.has(tsKey)) {
          return false;
        }
        seenTimestamps.add(tsKey);
        return true;
      });
      
      allCandles.push(...newCandles);
      
      // Update cursor: use last candle timestamp + timeframe
      const lastCandle = pageCandles[pageCandles.length - 1];
      const lastTsMs = new Date(lastCandle.ts).getTime();
      cursorMs = lastTsMs + tfMs;
      
      console.log(`[supabase] RPC page ${page}: ${pageCandles.length} candles (${newCandles.length} new), total: ${allCandles.length}, lastTs: ${lastCandle.ts}`);
      
      // If we got fewer than expected, we might have reached the end
      if (pageCandles.length < safeBatchLimit * 0.5) {
        // Likely at the end, check if we should continue
        if (lastTsMs >= endMs - tfMs) {
          break;
        }
      }
      
      // If we got exactly 1000 (or close to it), PostgREST might be limiting
      // Make next window smaller to ensure we get all candles
      if (pageCandles.length >= 950 && pageCandles.length <= 1000) {
        console.warn(`[supabase] RPC returned ~1000 candles (${pageCandles.length}), PostgREST limit may be active. Next window will be smaller.`);
        // Reduce window size for next iteration
        const reducedWindowMs = Math.min(windowMs * 0.8, tfMs * 400); // 80% of current or 400 candles max
        cursorMs = lastTsMs + tfMs;
        // Note: windowMs is recalculated each iteration, so this warning is informational
      }
      
      // Safety: prevent infinite loops
      if (page > 1000) {
        console.warn(`[supabase] Stopped RPC pagination after 1000 pages (safety limit)`);
        break;
      }
    } catch (error) {
      console.error(`[supabase] RPC pagination error on page ${page}:`, error.message);
      // Move cursor forward on error
      cursorMs = windowEndMs + tfMs;
      continue;
    }
  }
  
  // Sort by timestamp ascending
  allCandles.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  
  console.log(`[supabase] RPC pagination complete: ${allCandles.length} total candles across ${page} page(s)`);
  
  return allCandles;
}

/**
 * Get candles for a time range with pagination
 * 
 * @param {object} options
 * @param {string} options.symbol
 * @param {number} options.timeframeMin
 * @param {string} options.startTs - ISO timestamp
 * @param {string} options.endTs - ISO timestamp
 * @param {number} options.chunkSize - Number of rows per page (default: 5000)
 * @param {boolean} options.useRpc - Use RPC function instead of REST (default: true)
 * @returns {Promise<Array>} Array of candles
 */
export async function getCandlesInRange({ symbol, timeframeMin, startTs, endTs, chunkSize = 5000, useRpc = true }) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  // Calculate expected count (rough estimate)
  const startMs = new Date(startTs).getTime();
  const endMs = new Date(endTs).getTime();
  const minutesBetween = (endMs - startMs) / (60 * 1000);
  const expectedCount = Math.floor(minutesBetween / timeframeMin);
  
  // Try RPC first (more efficient for large datasets)
  if (useRpc) {
    try {
      const rpcCandles = await getCandlesInRangeRPC({ symbol, timeframeMin, startTs, endTs, batchLimit: chunkSize });
      if (rpcCandles !== null) {
        // RPC succeeded - validate count
        const actualCount = rpcCandles.length;
        const minExpected = Math.floor(expectedCount * 0.8); // Allow 20% tolerance for gaps
        
        console.log(`[supabase] RPC fetched ${symbol} ${timeframeMin}m: ${actualCount} candles (expected ~${expectedCount}, min: ${minExpected})`);
        
        if (actualCount < minExpected) {
          const errorMsg = `RPC candle count too low: got ${actualCount}, expected at least ${minExpected} (${expectedCount} total). This may indicate missing data or pagination failure.`;
          console.error(`[supabase] ❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }
        
        return rpcCandles;
      }
      // RPC failed, fall through to REST pagination
      console.warn(`[supabase] RPC get_candles_range failed, falling back to REST pagination`);
    } catch (rpcError) {
      // If it's a validation error, throw it
      if (rpcError.message && rpcError.message.includes('candle count too low')) {
        throw rpcError;
      }
      console.warn(`[supabase] RPC get_candles_range error, falling back to REST pagination:`, rpcError.message);
      // Fall through to REST pagination
    }
  }

  // REST pagination fallback
  try {
    const client = getSupabaseClient();
    const allCandles = [];
    let offset = 0;
    let page = 0;
    let hasMore = true;
    
    console.log(`[supabase] Fetching candles via REST: ${symbol} ${timeframeMin}m from ${startTs} to ${endTs} (expected ~${expectedCount} candles)`);
    
    while (hasMore) {
      page++;
      const url = `${client.url}/rest/v1/candles?symbol=eq.${symbol}&timeframe_min=eq.${timeframeMin}&ts=gte.${startTs}&ts=lte.${endTs}&order=ts.asc&limit=${chunkSize}&offset=${offset}&select=*`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': client.key,
          'Authorization': `Bearer ${client.key}`,
          'Content-Type': 'application/json',
          'Prefer': 'count=exact', // Get total count in Content-Range header
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[supabase] Failed to get candles in range (page ${page}): ${response.status} ${errorText}`);
        break;
      }

      const data = await response.json();
      const pageCandles = data || [];
      
      // Append to array (memory-safe: O(n) total)
      allCandles.push(...pageCandles);
      
      // Check if we got fewer than chunk size (last page)
      hasMore = pageCandles.length === chunkSize;
      offset += pageCandles.length;
      
      console.log(`[supabase] Fetched page ${page}: ${pageCandles.length} candles (total: ${allCandles.length})`);
      
      // Safety: prevent infinite loops
      if (page > 1000) {
        console.warn(`[supabase] Stopped pagination after 1000 pages (safety limit)`);
        break;
      }
    }
    
    // Validate count - throw error if too low (not just warn)
    const actualCount = allCandles.length;
    const minExpected = Math.floor(expectedCount * 0.8); // Allow 20% tolerance for gaps
    
    if (actualCount < minExpected) {
      const errorMsg = `REST candle count too low: got ${actualCount}, expected at least ${minExpected} (${expectedCount} total) for ${timeframeMin}m timeframe. This may indicate missing data or pagination failure.`;
      console.error(`[supabase] ❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    console.log(`[supabase] Completed fetching ${symbol} ${timeframeMin}m: ${actualCount} candles across ${page} page(s) (expected ~${expectedCount})`);
    
    return allCandles;
  } catch (error) {
    console.error('[supabase] Failed to get candles in range:', error);
    return [];
  }
}

