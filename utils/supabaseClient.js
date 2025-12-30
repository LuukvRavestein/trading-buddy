/**
 * Supabase Client
 * 
 * Handles connection to Supabase database for persistent trade storage.
 * Falls back to in-memory storage if Supabase is not configured.
 * 
 * Environment variables:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY for server-side)
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
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Check if Supabase is configured
  if (!supabaseUrl || !supabaseKey) {
    console.warn('[supabase] Supabase not configured. Using in-memory storage.');
    isConfigured = false;
    return null;
  }

  try {
    // Dynamic import to avoid errors if @supabase/supabase-js is not installed
    // For now, we'll use fetch directly, or you can install: npm install @supabase/supabase-js
    // For Vercel, we'll use the REST API directly to avoid dependency issues
    
    isConfigured = true;
    supabaseClient = {
      url: supabaseUrl,
      key: supabaseKey,
      // We'll use REST API directly
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
 * @returns {Promise<object>} Response data
 */
async function supabaseRequest(method, path, body = null) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase not configured');
  }

  const url = `${client.url}/rest/v1/${path}`;
  const headers = {
    'apikey': client.key,
    'Authorization': `Bearer ${client.key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  const options = {
    method,
    headers,
  };

  if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase API error: ${response.status} ${errorText}`);
    }

    // Handle empty responses
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      return Array.isArray(data) ? data : [data];
    }
    
    return [];
  } catch (error) {
    console.error(`[supabase] Request error (${method} ${path}):`, error);
    throw error;
  }
}

/**
 * Insert a trade into Supabase
 * 
 * @param {object} trade - Trade object
 * @returns {Promise<object>} Inserted trade
 */
export async function insertTrade(trade) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const result = await supabaseRequest('POST', 'trades', trade);
    return result[0] || trade;
  } catch (error) {
    console.error('[supabase] Failed to insert trade:', error);
    throw error;
  }
}

/**
 * Get trades from Supabase
 * 
 * @param {object} options - Query options
 * @returns {Promise<array>} Array of trades
 */
export async function getTradesFromSupabase(options = {}) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    let path = 'trades?order=created_at.desc';
    
    // Add filters using PostgREST syntax
    if (options.mode) {
      path += `&mode=eq.${encodeURIComponent(options.mode)}`;
    }
    if (options.signal) {
      path += `&signal=eq.${encodeURIComponent(options.signal.toUpperCase())}`;
    }
    if (options.limit) {
      path += `&limit=${options.limit}`;
    } else {
      path += '&limit=1000';
    }

    const result = await supabaseRequest('GET', path);
    return result || [];
  } catch (error) {
    console.error('[supabase] Failed to get trades:', error);
    throw error;
  }
}

/**
 * Update a trade in Supabase
 * 
 * @param {string} tradeId - Trade ID
 * @param {object} updateData - Data to update
 * @returns {Promise<object>} Updated trade
 */
export async function updateTrade(tradeId, updateData) {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const result = await supabaseRequest('PATCH', `trades?id=eq.${tradeId}`, updateData);
    return result[0] || null;
  } catch (error) {
    console.error('[supabase] Failed to update trade:', error);
    throw error;
  }
}

/**
 * Get trade statistics from Supabase
 * 
 * @returns {Promise<object>} Statistics
 */
export async function getStatsFromSupabase() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    // Get all trades for stats calculation
    const allTrades = await getTradesFromSupabase({ limit: 10000 });
    
    const stats = {
      total: allTrades.length,
      paper: allTrades.filter(t => t.mode === 'paper').length,
      live: allTrades.filter(t => t.mode === 'live').length,
      long: allTrades.filter(t => t.signal === 'LONG').length,
      short: allTrades.filter(t => t.signal === 'SHORT').length,
      successful: allTrades.filter(t => t.success !== false).length,
      rejected: allTrades.filter(t => t.success === false).length,
    };
    
    stats.successRate = stats.total > 0 
      ? ((stats.successful / stats.total) * 100).toFixed(1) 
      : '0';
    
    return stats;
  } catch (error) {
    console.error('[supabase] Failed to get stats:', error);
    throw error;
  }
}

