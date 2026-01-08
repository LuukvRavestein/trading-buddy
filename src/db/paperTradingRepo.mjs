/**
 * Paper Trading Repository
 * 
 * Supabase persistence layer for paper trading runner.
 * Handles all database operations for paper runs, configs, accounts, trades, and snapshots.
 */

import { getSupabaseClient, isSupabaseConfigured, supabaseRequest } from './supabaseClient.js';

/**
 * Create a new paper run
 * 
 * @param {object} options
 * @param {string} options.symbol - Symbol (e.g., 'BTC-PERPETUAL')
 * @param {number} options.timeframeMin - Timeframe in minutes (default: 1)
 * @param {string} options.note - Optional note
 * @returns {Promise<object>} Created paper run
 */
export async function createPaperRun({ symbol, timeframeMin = 1, note = null }) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const payload = {
    symbol,
    timeframe_min: timeframeMin,
    status: 'running',
    note,
  };

  try {
    const result = await supabaseRequest('POST', 'paper_runs', payload, {
      select: '*',
    });
    const run = result[0] || payload;
    console.log(`[paperRepo] Created paper run: ${run.id}`);
    return run;
  } catch (error) {
    console.error('[paperRepo] Failed to create paper run:', error);
    throw error;
  }
}

/**
 * Update paper run status
 * 
 * @param {string} runId - Paper run ID
 * @param {object} updateData - Update data (status, note, etc.)
 * @returns {Promise<object>} Updated paper run
 */
export async function updatePaperRun(runId, updateData) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('PATCH', `paper_runs?id=eq.${runId}`, updateData, {
      select: '*',
    });
    return result[0] || null;
  } catch (error) {
    console.error('[paperRepo] Failed to update paper run:', error);
    throw error;
  }
}

/**
 * Upsert paper configs from optimizer run
 * 
 * @param {object} options
 * @param {string} options.paperRunId - Paper run ID
 * @param {string} options.optimizerRunId - Optimizer run ID
 * @param {number} options.topN - Number of top configs to load (default: 10)
 * @returns {Promise<Array>} Created/updated paper configs
 */
export async function upsertPaperConfigsFromOptimizerRun({ paperRunId, optimizerRunId, topN = 10 }) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const client = getSupabaseClient();
  let optimizerConfigs = [];
  let source = 'optimizer_run_top_configs';
  let fallbackUsed = false;

  // Helper function to fetch with service_role
  const fetchWithServiceRole = async (table, queryParams) => {
    const url = `${client.url}/rest/v1/${table}?${queryParams}`;
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
      throw new Error(`Failed to fetch ${table}: ${response.status} ${errorText}`);
    }
    
    return await response.json();
  };

  // First, try optimizer_run_top_configs
  try {
    const topConfigsQuery = `run_id=eq.${optimizerRunId}&order=rank.asc&limit=${topN}&select=*`;
    optimizerConfigs = await fetchWithServiceRole('optimizer_run_top_configs', topConfigsQuery);
    
    if (optimizerConfigs && optimizerConfigs.length > 0) {
      console.log(`[paperRepo] optimizer config source: top_configs, counts=${optimizerConfigs.length}, optimizerRunId=${optimizerRunId}, topN=${topN}`);
    } else {
      // Fallback to optimizer_run_configs
      fallbackUsed = true;
      source = 'optimizer_run_configs';
      const runConfigsQuery = `run_id=eq.${optimizerRunId}&order=score.desc&limit=${topN}&select=*`;
      optimizerConfigs = await fetchWithServiceRole('optimizer_run_configs', runConfigsQuery);
      
      if (optimizerConfigs && optimizerConfigs.length > 0) {
        // Add rank based on order (1-based)
        optimizerConfigs = optimizerConfigs.map((config, index) => ({
          ...config,
          rank: index + 1,
        }));
        console.log(`[paperRepo] optimizer config source: run_configs (fallback), counts=${optimizerConfigs.length}, optimizerRunId=${optimizerRunId}, topN=${topN}`);
      }
    }
  } catch (error) {
    console.error(`[paperRepo] Error fetching from ${source}:`, error);
    // Continue to check fallback or throw
    if (!fallbackUsed) {
      fallbackUsed = true;
      source = 'optimizer_run_configs';
      try {
        const runConfigsQuery = `run_id=eq.${optimizerRunId}&order=score.desc&limit=${topN}&select=*`;
        optimizerConfigs = await fetchWithServiceRole('optimizer_run_configs', runConfigsQuery);
        if (optimizerConfigs && optimizerConfigs.length > 0) {
          optimizerConfigs = optimizerConfigs.map((config, index) => ({
            ...config,
            rank: index + 1,
          }));
          console.log(`[paperRepo] optimizer config source: run_configs (fallback), counts=${optimizerConfigs.length}, optimizerRunId=${optimizerRunId}, topN=${topN}`);
        }
      } catch (fallbackError) {
        console.error(`[paperRepo] Error fetching from fallback ${source}:`, fallbackError);
      }
    }
  }

  // If still no configs, get counts and throw clear error
  if (!optimizerConfigs || optimizerConfigs.length === 0) {
    // Get counts for error message
    let topConfigsCount = 0;
    let runConfigsCount = 0;
    
    try {
      const topConfigs = await fetchWithServiceRole('optimizer_run_top_configs', `run_id=eq.${optimizerRunId}&select=id`);
      topConfigsCount = Array.isArray(topConfigs) ? topConfigs.length : 0;
    } catch (e) {
      // Ignore
    }
    
    try {
      const runConfigs = await fetchWithServiceRole('optimizer_run_configs', `run_id=eq.${optimizerRunId}&select=id`);
      runConfigsCount = Array.isArray(runConfigs) ? runConfigs.length : 0;
    } catch (e) {
      // Ignore
    }
    
    throw new Error(
      `[paperRepo] No optimizer configs found for run_id=${optimizerRunId}. ` +
      `Counts: optimizer_run_top_configs=${topConfigsCount}, optimizer_run_configs=${runConfigsCount}. ` +
      `Please choose another optimizer run_id that has saved configs.`
    );
  }

  // Upsert paper configs
  const paperConfigs = optimizerConfigs.map(optConfig => ({
    run_id: paperRunId,
    source,
    source_run_id: optimizerRunId,
    rank: optConfig.rank || null,
    config: optConfig.config, // JSONB
    is_active: true,
  }));

  const results = [];
  for (const config of paperConfigs) {
    try {
      // Use upsert with unique constraint
      const result = await supabaseRequest('POST', 'paper_configs', config, {
        select: '*',
      });
      results.push(result[0] || config);
    } catch (error) {
      // If duplicate, try to update existing
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        console.log(`[paperRepo] Config rank ${config.rank} already exists, skipping`);
        // Fetch existing
        const existingUrl = `${client.url}/rest/v1/paper_configs?run_id=eq.${paperRunId}&rank=eq.${config.rank}&select=*`;
        const existingResponse = await fetch(existingUrl, {
          method: 'GET',
          headers: {
            'apikey': client.key,
            'Authorization': `Bearer ${client.key}`,
            'Content-Type': 'application/json',
          },
        });
        if (existingResponse.ok) {
          const existing = await existingResponse.json();
          if (existing && existing.length > 0) {
            results.push(existing[0]);
          }
        }
      } else {
        throw error;
      }
    }
  }

  console.log(`[paperRepo] Upserted ${results.length} paper configs`);
  return results;
}

/**
 * Seed paper accounts for a run
 * Creates one account per paper_config for the given run_id
 * 
 * @param {object} options
 * @param {string} options.runId - Paper run ID
 * @param {number} options.balanceStart - Starting balance (default: 1000)
 * @returns {Promise<number>} Number of accounts created/upserted
 */
export async function seedPaperAccountsForRun({ runId, balanceStart = 1000 }) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    // Fetch all paper_config ids for this run
    const client = getSupabaseClient();
    const configsUrl = `${client.url}/rest/v1/paper_configs?run_id=eq.${runId}&select=id`;
    
    const configsResponse = await fetch(configsUrl, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });

    if (!configsResponse.ok) {
      const errorText = await configsResponse.text();
      throw new Error(`Failed to fetch paper configs: ${configsResponse.status} ${errorText}`);
    }

    const configs = await configsResponse.json();
    
    if (!configs || configs.length === 0) {
      console.log(`[paperRepo] No paper configs found for runId=${runId}, skipping account seeding`);
      return 0;
    }

    // Build account rows
    const accounts = configs.map(config => ({
      run_id: runId,
      paper_config_id: config.id,
      balance_start: balanceStart,
      balance: balanceStart,
      equity: balanceStart,
      max_equity: balanceStart,
      max_drawdown_pct: 0,
      open_position: null,
      trades_count: 0,
      wins_count: 0,
      losses_count: 0,
      profit_factor: 1,
      last_candle_ts: null,
    }));

    // Upsert accounts using on_conflict
    const url = `${client.url}/rest/v1/paper_accounts?on_conflict=run_id,paper_config_id`;
    
    const headers = {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(accounts),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const result = await response.json();
    const insertedOrUpserted = Array.isArray(result) ? result.length : (result ? 1 : 0);
    
    console.log(`[paperRepo] Seeding paper accounts: runId=${runId}, configs=${configs.length}, insertedOrUpserted=${insertedOrUpserted}`);
    
    return insertedOrUpserted;
  } catch (error) {
    console.error('[paperRepo] Failed to seed paper accounts:', error);
    throw error;
  }
}

/**
 * Get active paper accounts for a run
 * 
 * @param {string} paperRunId - Paper run ID
 * @returns {Promise<Array>} Active paper accounts with config info
 */
export async function getActivePaperAccounts({ paperRunId }) {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    const client = getSupabaseClient();
    // Join paper_accounts with paper_configs where is_active=true
    const url = `${client.url}/rest/v1/paper_accounts?run_id=eq.${paperRunId}&paper_configs.is_active=eq.true&select=*,paper_configs(*)`;
    
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
      console.error(`[paperRepo] Failed to get active accounts: ${response.status} ${errorText}`);
      return [];
    }

    const data = await response.json();
    
    // Filter to only accounts with active configs
    const activeAccounts = data.filter(acc => acc.paper_configs && acc.paper_configs.is_active);
    
    return activeAccounts;
  } catch (error) {
    console.error('[paperRepo] Failed to get active accounts:', error);
    return [];
  }
}

/**
 * Create or update paper account
 * 
 * @param {object} account - Account data
 * @returns {Promise<object>} Created/updated account
 */
export async function upsertPaperAccount(account) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    // Check if account exists
    const client = getSupabaseClient();
    const checkUrl = `${client.url}/rest/v1/paper_accounts?run_id=eq.${account.run_id}&paper_config_id=eq.${account.paper_config_id}&select=id&limit=1`;
    const checkResponse = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'apikey': client.key,
        'Authorization': `Bearer ${client.key}`,
        'Content-Type': 'application/json',
      },
    });

    if (checkResponse.ok) {
      const existing = await checkResponse.json();
      if (existing && existing.length > 0) {
        // Update existing
        const result = await supabaseRequest('PATCH', `paper_accounts?id=eq.${existing[0].id}`, account, {
          select: '*',
        });
        return result[0] || account;
      }
    }

    // Create new
    const result = await supabaseRequest('POST', 'paper_accounts', account, {
      select: '*',
    });
    return result[0] || account;
  } catch (error) {
    console.error('[paperRepo] Failed to upsert account:', error);
    throw error;
  }
}

/**
 * Update account checkpoint (last_candle_ts + account stats)
 * 
 * @param {object} account - Account with updated fields
 * @returns {Promise<object>} Updated account
 */
export async function upsertAccountCheckpoint(account) {
  return upsertPaperAccount(account);
}

/**
 * Insert trade open
 * 
 * @param {object} trade - Trade data
 * @returns {Promise<object>} Inserted trade
 */
export async function insertTradeOpen(trade) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('POST', 'paper_trades', trade, {
      select: '*',
    });
    return result[0] || trade;
  } catch (error) {
    // If duplicate (idempotency), return existing
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      console.log(`[paperRepo] Trade already exists (idempotency): ${trade.opened_ts}`);
      // Fetch existing
      const client = getSupabaseClient();
      const url = `${client.url}/rest/v1/paper_trades?run_id=eq.${trade.run_id}&paper_config_id=eq.${trade.paper_config_id}&opened_ts=eq.${trade.opened_ts}&side=eq.${trade.side}&entry=eq.${trade.entry}&select=*&limit=1`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': client.key,
          'Authorization': `Bearer ${client.key}`,
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        const existing = await response.json();
        if (existing && existing.length > 0) {
          return existing[0];
        }
      }
    }
    throw error;
  }
}

/**
 * Update trade close
 * 
 * @param {string} tradeId - Trade ID
 * @param {object} updateData - Update data (closed_ts, exit, pnl_pct, pnl_abs, fees_abs, result)
 * @returns {Promise<object>} Updated trade
 */
export async function updateTradeClose(tradeId, updateData) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('PATCH', `paper_trades?id=eq.${tradeId}`, updateData, {
      select: '*',
    });
    return result[0] || null;
  } catch (error) {
    console.error('[paperRepo] Failed to update trade close:', error);
    throw error;
  }
}

/**
 * Upsert equity snapshot
 * 
 * @param {object} snapshot - Snapshot data
 * @returns {Promise<object>} Created/updated snapshot
 */
export async function upsertEquitySnapshot(snapshot) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    // Use upsert with unique constraint
    const client = getSupabaseClient();
    const url = `${client.url}/rest/v1/paper_equity_snapshots?on_conflict=run_id,paper_config_id,ts`;
    
    const headers = {
      'apikey': client.key,
      'Authorization': `Bearer ${client.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation,resolution=merge-duplicates',
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Supabase API error: ${response.status} ${errorText.substring(0, 200)}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data[0] : data;
  } catch (error) {
    console.error('[paperRepo] Failed to upsert equity snapshot:', error);
    throw error;
  }
}

/**
 * Kill config (set is_active=false + kill_reason)
 * 
 * @param {string} paperConfigId - Paper config ID
 * @param {string} reason - Kill reason
 * @returns {Promise<object>} Updated config
 */
export async function killConfig(paperConfigId, reason) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  try {
    const result = await supabaseRequest('PATCH', `paper_configs?id=eq.${paperConfigId}`, {
      is_active: false,
      kill_reason: reason,
    }, {
      select: '*',
    });
    return result[0] || null;
  } catch (error) {
    console.error('[paperRepo] Failed to kill config:', error);
    throw error;
  }
}

/**
 * Log event
 * 
 * @param {object} options
 * @param {string} options.runId - Paper run ID
 * @param {string} options.paperConfigId - Paper config ID (optional)
 * @param {string} options.level - Event level (info|warn|error)
 * @param {string} options.message - Event message
 * @param {object} options.payload - Optional payload (JSONB)
 * @returns {Promise<object>} Created event
 */
export async function logEvent({ runId, paperConfigId = null, level, message, payload = null }) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const event = {
    run_id: runId,
    paper_config_id: paperConfigId,
    level,
    message,
    payload,
  };

  try {
    const result = await supabaseRequest('POST', 'paper_events', event, {
      select: '*',
    });
    return result[0] || event;
  } catch (error) {
    console.error('[paperRepo] Failed to log event:', error);
    // Don't throw - event logging should not break the runner
    return event;
  }
}

