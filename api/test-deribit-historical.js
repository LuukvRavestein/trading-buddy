/**
 * Test Deribit Historical API
 * 
 * Tests the Deribit Historical Trades API to see if it works correctly
 */

const DERIBIT_HISTORY_API_BASE = 'https://history.deribit.com/api/v2';

async function testDeribitHistoricalAPI(instrument_name, startTimestamp, endTimestamp) {
  const startSeconds = Math.floor(startTimestamp / 1000);
  const endSeconds = Math.floor(endTimestamp / 1000);

  const results = {
    instrument_name,
    startTimestamp: new Date(startTimestamp).toISOString(),
    endTimestamp: new Date(endTimestamp).toISOString(),
    tests: [],
  };

  // Test 1: POST with JSON-RPC format
  try {
    const url = `${DERIBIT_HISTORY_API_BASE}/public/get_last_trades_by_instrument_and_time`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'public/get_last_trades_by_instrument_and_time',
        params: {
          instrument_name,
          start_timestamp: startSeconds,
          end_timestamp: endSeconds,
          count: 100,
        },
        id: 1,
      }),
    });

    const data = await response.json();
    results.tests.push({
      method: 'POST (JSON-RPC)',
      success: !data.error && response.ok,
      status: response.status,
      data: data,
      error: data.error || null,
    });
  } catch (error) {
    results.tests.push({
      method: 'POST (JSON-RPC)',
      success: false,
      error: error.message,
    });
  }

  // Test 2: GET with query parameters
  try {
    const params = new URLSearchParams({
      instrument_name,
      start_timestamp: startSeconds.toString(),
      end_timestamp: endSeconds.toString(),
      count: '100',
    });
    const url = `${DERIBIT_HISTORY_API_BASE}/public/get_last_trades_by_instrument_and_time?${params.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const data = await response.json();
    results.tests.push({
      method: 'GET (Query Params)',
      success: !data.error && response.ok,
      status: response.status,
      data: data,
      error: data.error || null,
    });
  } catch (error) {
    results.tests.push({
      method: 'GET (Query Params)',
      success: false,
      error: error.message,
    });
  }

  // Test 3: POST without JSON-RPC wrapper
  try {
    const url = `${DERIBIT_HISTORY_API_BASE}/public/get_last_trades_by_instrument_and_time`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        instrument_name,
        start_timestamp: startSeconds,
        end_timestamp: endSeconds,
        count: 100,
      }),
    });

    const data = await response.json();
    results.tests.push({
      method: 'POST (Direct Params)',
      success: !data.error && response.ok,
      status: response.status,
      data: data,
      error: data.error || null,
    });
  } catch (error) {
    results.tests.push({
      method: 'POST (Direct Params)',
      success: false,
      error: error.message,
    });
  }

  return results;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Test with recent data (last hour)
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    const results = await testDeribitHistoricalAPI('BTC-PERPETUAL', oneHourAgo, now);

    return res.status(200).json({
      status: 'ok',
      message: 'Deribit Historical API test results',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      error: error.message,
    });
  }
}

