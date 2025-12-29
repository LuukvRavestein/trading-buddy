/**
 * Trades API Endpoint
 * 
 * Returns all stored trades and statistics
 */

import { getTrades, getStats } from '../utils/tradeStore.js';

export default async function handler(req, res) {
  // Allow GET requests only
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      reason: 'Method not allowed. Use GET.',
    });
  }

  try {
    const { mode, signal, limit } = req.query;

    // Get trades with filters
    const trades = getTrades({
      mode: mode || undefined,
      signal: signal || undefined,
      limit: limit ? parseInt(limit) : undefined,
    });

    // Get statistics
    const stats = getStats();

    return res.status(200).json({
      status: 'ok',
      stats,
      trades,
      count: trades.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[trades] Error:', error);
    return res.status(500).json({
      status: 'error',
      reason: `Server error: ${error.message}`,
    });
  }
}

