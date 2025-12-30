/**
 * Test Deribit API Connection
 * 
 * Tests various Deribit API endpoints to see which ones work
 */

const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2';
const DERIBIT_TESTNET_BASE = 'https://test.deribit.com/api/v2';

async function testDeribitEndpoint(endpoint, params = {}, useTestnet = false) {
  const baseUrl = useTestnet ? DERIBIT_TESTNET_BASE : DERIBIT_API_BASE;
  const url = `${baseUrl}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    const data = await response.json();
    
    return {
      success: !data.error && response.ok,
      status: response.status,
      data: data,
      error: data.error || null,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const useTestnet = process.env.DERIBIT_USE_TESTNET === 'true';
  const results = {};

  // Test 1: Public endpoints (no auth needed)
  console.log('Testing public endpoints...');
  
  // Test get_book_summary (we know this works)
  results.getBookSummary = await testDeribitEndpoint(
    '/public/get_book_summary_by_instrument',
    { instrument_name: 'BTC-PERPETUAL' },
    useTestnet
  );

  // Test various possible names for chart data
  const chartEndpoints = [
    '/public/get_tradingview_chart_data',
    '/public/get_chart_data',
    '/public/tradingview_chart_data',
    '/public/chart_data',
  ];

  for (const endpoint of chartEndpoints) {
    const testParams = {
      instrument_name: 'BTC-PERPETUAL',
      start_timestamp: Math.floor((Date.now() - 3600000) / 1000), // 1 hour ago
      end_timestamp: Math.floor(Date.now() / 1000),
      resolution: '60',
    };
    
    results[endpoint] = await testDeribitEndpoint(endpoint, testParams, useTestnet);
  }

  // Test with different parameter names
  const altParams = [
    {
      instrument_name: 'BTC-PERPETUAL',
      start: Math.floor((Date.now() - 3600000) / 1000),
      end: Math.floor(Date.now() / 1000),
      resolution: '60',
    },
    {
      instrument: 'BTC-PERPETUAL',
      start_timestamp: Math.floor((Date.now() - 3600000) / 1000),
      end_timestamp: Math.floor(Date.now() / 1000),
      resolution: '60',
    },
  ];

  for (let i = 0; i < altParams.length; i++) {
    results[`/public/get_tradingview_chart_data_alt${i + 1}`] = await testDeribitEndpoint(
      '/public/get_tradingview_chart_data',
      altParams[i],
      useTestnet
    );
  }

  return res.status(200).json({
    status: 'ok',
    useTestnet,
    results,
    timestamp: new Date().toISOString(),
  });
}

