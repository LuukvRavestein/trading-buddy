/**
 * Deribit WebSocket Client
 * 
 * Fallback for when chart_data API is not available on mainnet.
 * Subscribes to trades and builds candles in real-time.
 */

// Import ws module (Node.js WebSocket library)
// Use dynamic import to handle ESM
let wsModule;
try {
  wsModule = await import('ws');
} catch (error) {
  console.error('[deribitWS] Failed to import ws module:', error);
  throw new Error('ws module not installed. Run: npm install ws');
}
const WebSocket = wsModule.default;

const DERIBIT_WS_BASE = 'wss://www.deribit.com/ws/api/v2';
const DERIBIT_WS_TESTNET = 'wss://test.deribit.com/ws/api/v2';

// WebSocket connection state
let ws = null;
let wsConnected = false;
let wsReconnectTimer = null;
let tradeSubscriptions = new Map(); // symbol -> callback

/**
 * Get WebSocket URL based on environment
 */
function getWebSocketUrl() {
  const env = process.env.DERIBIT_ENV || 'live';
  return env === 'test' ? DERIBIT_WS_TESTNET : DERIBIT_WS_BASE;
}

/**
 * Initialize WebSocket connection
 */
async function connectWebSocket() {
  if (ws && wsConnected) {
    return ws;
  }

  return new Promise((resolve, reject) => {
    const url = getWebSocketUrl();
    console.log(`[deribitWS] Connecting to ${url}...`);

    ws = new WebSocket(url);

    ws.on('open', () => {
      wsConnected = true;
      console.log('[deribitWS] ✅ WebSocket connected');
      
      // Resubscribe to all active subscriptions
      for (const [symbol, callback] of tradeSubscriptions.entries()) {
        subscribeToTrades(symbol, callback);
      }
      
      resolve(ws);
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleWebSocketMessage(message);
      } catch (error) {
        console.error('[deribitWS] Error parsing message:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('[deribitWS] WebSocket error:', error);
      wsConnected = false;
      reject(error);
    });

    ws.on('close', () => {
      console.log('[deribitWS] WebSocket closed, reconnecting...');
      wsConnected = false;
      
      // Reconnect after 5 seconds
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
      }
      wsReconnectTimer = setTimeout(() => {
        connectWebSocket().catch(console.error);
      }, 5000);
    });
  });
}

/**
 * Handle incoming WebSocket messages
 */
function handleWebSocketMessage(message) {
  // Handle trade notifications
  if (message.params && message.params.data) {
    const trades = Array.isArray(message.params.data) 
      ? message.params.data 
      : [message.params.data];
    
    for (const trade of trades) {
      if (trade.instrument_name && tradeSubscriptions.has(trade.instrument_name)) {
        const callback = tradeSubscriptions.get(trade.instrument_name);
        callback(trade);
      }
    }
  }
}

/**
 * Subscribe to trades for a symbol
 * 
 * @param {string} symbol - Instrument name (e.g., 'BTC-PERPETUAL')
 * @param {function} callback - Callback function(trade) called for each trade
 */
export async function subscribeToTrades(symbol, callback) {
  if (!ws || !wsConnected) {
    await connectWebSocket();
  }

  // Store callback
  tradeSubscriptions.set(symbol, callback);

  // Subscribe to trades
  const subscribeMessage = {
    jsonrpc: '2.0',
    method: 'public/subscribe',
    params: {
      channels: [`trades.${symbol}.raw`],
    },
    id: Date.now(),
  };

  ws.send(JSON.stringify(subscribeMessage));
  console.log(`[deribitWS] Subscribed to trades for ${symbol}`);
}

/**
 * Unsubscribe from trades for a symbol
 */
export async function unsubscribeFromTrades(symbol) {
  if (!ws || !wsConnected) {
    return;
  }

  const unsubscribeMessage = {
    jsonrpc: '2.0',
    method: 'public/unsubscribe',
    params: {
      channels: [`trades.${symbol}.raw`],
    },
    id: Date.now(),
  };

  ws.send(JSON.stringify(unsubscribeMessage));
  tradeSubscriptions.delete(symbol);
  console.log(`[deribitWS] Unsubscribed from trades for ${symbol}`);
}

/**
 * Close WebSocket connection
 */
export function closeWebSocket() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
  }
  
  if (ws) {
    ws.close();
    ws = null;
    wsConnected = false;
  }
  
  tradeSubscriptions.clear();
  console.log('[deribitWS] WebSocket closed');
}

