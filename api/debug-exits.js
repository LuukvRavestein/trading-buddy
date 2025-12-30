/**
 * Debug endpoint to check exit alert status
 * 
 * Helps diagnose why exit alerts might not be working
 */

import { getTrades } from '../utils/tradeStore.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      reason: 'Method not allowed. Use GET.',
    });
  }

  try {
    const allTrades = await getTrades({ limit: 100 });
    
    // Analyze trades
    const analysis = {
      total: allTrades.length,
      withExitData: allTrades.filter(t => t.exitPrice || t.exitType).length,
      withoutExitData: allTrades.filter(t => !t.exitPrice && !t.exitType && t.success !== false).length,
      rejected: allTrades.filter(t => t.success === false || t.action === 'rejected').length,
      validated: allTrades.filter(t => t.validated === true).length,
      recentTrades: allTrades.slice(0, 10).map(t => ({
        id: t.id,
        timestamp: t.timestamp,
        signal: t.signal,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice || null,
        exitType: t.exitType || null,
        validated: t.validated || false,
        validatedBy: t.validatedBy || null,
        action: t.action,
        success: t.success,
      })),
    };

    return res.status(200).json({
      status: 'ok',
      analysis,
      message: 'Use this to check if exit alerts are being received and processed correctly.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[debug-exits] Error:', error);
    return res.status(500).json({
      status: 'error',
      reason: `Server error: ${error.message}`,
    });
  }
}

