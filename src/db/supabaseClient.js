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
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Check if Supabase is configured
  if (!supabaseUrl || !supabaseKey) {
    console.warn('[supabase] Supabase not configured. Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    isConfigured = false;
    return null;
  }

  try {
    isConfigured = true;
    supabaseClient = {
      url: supabaseUrl,
      key: supabaseKey,
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
 * Upsert candles (insert or update if exists)
 * 
 * @param {Array} candles - Array of candle objects
 * @returns {Promise<Array>} Upserted candles
 */
export async function upsertCandles(candles) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('POST', 'candles', candles, {
      select: '*',
    });
    return result;
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
    const result = await supabaseRequest('GET', 'candles', null, {
      filters: {
        symbol: `eq.${symbol}`,
        timeframe_min: `eq.${timeframeMin}`,
      },
      order: 'ts.desc',
      limit: limit,
      select: '*',
    });
    return result || [];
  } catch (error) {
    console.error('[supabase] Failed to get candles:', error);
    return [];
  }
}

// ============================================================================
// TIMEFRAME_STATE OPERATIONS
// ============================================================================

/**
 * Upsert timeframe state
 * 
 * @param {object} state - State object
 * @returns {Promise<object>} Upserted state
 */
export async function upsertTimeframeState(state) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('POST', 'timeframe_state', state, {
      select: '*',
    });
    return result[0] || state;
  } catch (error) {
    console.error('[supabase] Failed to upsert timeframe state:', error);
    throw error;
  }
}

/**
 * Get latest timeframe state
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
    const result = await supabaseRequest('GET', 'timeframe_state', null, {
      filters: {
        symbol: `eq.${symbol}`,
        timeframe_min: `eq.${timeframeMin}`,
      },
      order: 'ts.desc',
      limit: 1,
      select: '*',
    });
    return result && result.length > 0 ? result[0] : null;
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

