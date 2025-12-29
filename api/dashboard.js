/**
 * Dashboard Page
 * 
 * Serves the monitoring dashboard HTML page
 */

const dashboardHTML = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Buddy - Dashboard</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #0a0e27;
      color: #e0e0e0;
      padding: 20px;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    
    header {
      margin-bottom: 30px;
      border-bottom: 2px solid #1a1f3a;
      padding-bottom: 20px;
    }
    
    h1 {
      color: #4ade80;
      font-size: 2.5em;
      margin-bottom: 10px;
    }
    
    .subtitle {
      color: #9ca3af;
      font-size: 0.9em;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    
    .stat-card {
      background: #1a1f3a;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 20px;
      transition: transform 0.2s, border-color 0.2s;
    }
    
    .stat-card:hover {
      transform: translateY(-2px);
      border-color: #4ade80;
    }
    
    .stat-label {
      color: #9ca3af;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    
    .stat-value {
      color: #4ade80;
      font-size: 2em;
      font-weight: bold;
    }
    
    .stat-subvalue {
      color: #6b7280;
      font-size: 0.9em;
      margin-top: 5px;
    }
    
    .controls {
      display: flex;
      gap: 15px;
      margin-bottom: 20px;
      flex-wrap: wrap;
      align-items: center;
    }
    
    .filter-btn {
      background: #1a1f3a;
      border: 1px solid #2d3748;
      color: #e0e0e0;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.9em;
    }
    
    .filter-btn:hover {
      background: #2d3748;
      border-color: #4ade80;
    }
    
    .filter-btn.active {
      background: #4ade80;
      color: #0a0e27;
      border-color: #4ade80;
    }
    
    .refresh-btn {
      background: #3b82f6;
      border: 1px solid #3b82f6;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 600;
    }
    
    .refresh-btn:hover {
      background: #2563eb;
    }
    
    .auto-refresh {
      display: flex;
      align-items: center;
      gap: 10px;
      color: #9ca3af;
      font-size: 0.9em;
    }
    
    .trades-table {
      background: #1a1f3a;
      border: 1px solid #2d3748;
      border-radius: 12px;
      overflow: hidden;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    
    thead {
      background: #0f1419;
    }
    
    th {
      padding: 15px;
      text-align: left;
      color: #9ca3af;
      font-weight: 600;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid #2d3748;
    }
    
    td {
      padding: 15px;
      border-bottom: 1px solid #2d3748;
    }
    
    tr:hover {
      background: #252b3d;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 0.8em;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .badge-success {
      background: #10b981;
      color: white;
    }
    
    .badge-error {
      background: #ef4444;
      color: white;
    }
    
    .badge-paper {
      background: #3b82f6;
      color: white;
    }
    
    .badge-live {
      background: #f59e0b;
      color: white;
    }
    
    .badge-long {
      background: #10b981;
      color: white;
    }
    
    .badge-short {
      background: #ef4444;
      color: white;
    }
    
    .price {
      font-family: 'Courier New', monospace;
      font-weight: 600;
    }
    
    .loading {
      text-align: center;
      padding: 40px;
      color: #9ca3af;
    }
    
    .error {
      background: #7f1d1d;
      border: 1px solid #991b1b;
      color: #fca5a5;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    
    .empty {
      text-align: center;
      padding: 60px 20px;
      color: #6b7280;
    }
    
    .timestamp {
      color: #6b7280;
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🚀 Trading Buddy Dashboard</h1>
      <div class="subtitle">Real-time trade monitoring</div>
    </header>
    
    <div id="error-container"></div>
    
    <div class="stats-grid" id="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Trades</div>
        <div class="stat-value" id="stat-total">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Paper Trades</div>
        <div class="stat-value" id="stat-paper">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Live Trades</div>
        <div class="stat-value" id="stat-live">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Success Rate</div>
        <div class="stat-value" id="stat-success">-</div>
        <div class="stat-subvalue" id="stat-success-detail">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Long Signals</div>
        <div class="stat-value" id="stat-long">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Short Signals</div>
        <div class="stat-value" id="stat-short">-</div>
      </div>
    </div>
    
    <div class="controls">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="paper">Paper</button>
      <button class="filter-btn" data-filter="live">Live</button>
      <button class="filter-btn" data-filter="LONG">Long Only</button>
      <button class="filter-btn" data-filter="SHORT">Short Only</button>
      <button class="refresh-btn" onclick="loadTrades()">🔄 Refresh</button>
      <div class="auto-refresh">
        <input type="checkbox" id="auto-refresh" checked>
        <label for="auto-refresh">Auto-refresh (5s)</label>
      </div>
    </div>
    
    <div class="trades-table">
      <div id="trades-container">
        <div class="loading">Loading trades...</div>
      </div>
    </div>
  </div>
  
  <script>
    let currentFilter = 'all';
    let autoRefreshInterval = null;
    
    function formatPrice(price) {
      if (!price) return '-';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }).format(price);
    }
    
    function formatDate(dateString) {
      if (!dateString) return '-';
      const date = new Date(dateString);
      return date.toLocaleString('nl-NL', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    
    function updateStats(stats) {
      document.getElementById('stat-total').textContent = stats.total || 0;
      document.getElementById('stat-paper').textContent = stats.paper || 0;
      document.getElementById('stat-live').textContent = stats.live || 0;
      document.getElementById('stat-success').textContent = stats.successRate + '%';
      document.getElementById('stat-success-detail').textContent = 
        \`\${stats.successful} successful / \${stats.rejected} rejected\`;
      document.getElementById('stat-long').textContent = stats.long || 0;
      document.getElementById('stat-short').textContent = stats.short || 0;
    }
    
    function renderTrades(trades) {
      const container = document.getElementById('trades-container');
      
      if (trades.length === 0) {
        container.innerHTML = '<div class="empty">No trades found</div>';
        return;
      }
      
      let html = '<table><thead><tr>';
      html += '<th>Time</th>';
      html += '<th>Mode</th>';
      html += '<th>Signal</th>';
      html += '<th>Instrument</th>';
      html += '<th>Side</th>';
      html += '<th>Entry Price</th>';
      html += '<th>Stop Loss</th>';
      html += '<th>Take Profit</th>';
      html += '<th>Size (USD)</th>';
      html += '<th>R:R</th>';
      html += '<th>Status</th>';
      html += '</tr></thead><tbody>';
      
      trades.forEach(trade => {
        const successClass = trade.success !== false ? 'badge-success' : 'badge-error';
        const modeClass = trade.mode === 'paper' ? 'badge-paper' : 'badge-live';
        const signalClass = trade.signal === 'LONG' ? 'badge-long' : 'badge-short';
        const rr = trade.riskCheck?.riskReward ? trade.riskCheck.riskReward.toFixed(2) : '-';
        
        html += '<tr>';
        html += \`<td class="timestamp">\${formatDate(trade.timestamp)}</td>\`;
        html += \`<td><span class="badge \${modeClass}">\${trade.mode || 'N/A'}</span></td>\`;
        html += \`<td><span class="badge \${signalClass}">\${trade.signal || 'N/A'}</span></td>\`;
        html += \`<td>\${trade.instrument || trade.symbol || 'N/A'}</td>\`;
        html += \`<td>\${trade.side || 'N/A'}</td>\`;
        html += \`<td class="price">\${formatPrice(trade.entryPrice)}</td>\`;
        html += \`<td class="price">\${formatPrice(trade.stopLoss)}</td>\`;
        html += \`<td class="price">\${formatPrice(trade.takeProfit)}</td>\`;
        html += \`<td class="price">\${formatPrice(trade.positionSizeUsd)}</td>\`;
        html += \`<td>\${rr}</td>\`;
        html += \`<td><span class="badge \${successClass}">\${trade.action || 'N/A'}</span></td>\`;
        html += '</tr>';
      });
      
      html += '</tbody></table>';
      container.innerHTML = html;
    }
    
    async function loadTrades() {
      try {
        const params = new URLSearchParams();
        if (currentFilter !== 'all') {
          if (currentFilter === 'paper' || currentFilter === 'live') {
            params.append('mode', currentFilter);
          } else {
            params.append('signal', currentFilter);
          }
        }
        params.append('limit', '100');
        
        const response = await fetch(\`/api/trades?\${params.toString()}\`);
        const data = await response.json();
        
        if (data.status === 'ok') {
          updateStats(data.stats);
          renderTrades(data.trades);
          document.getElementById('error-container').innerHTML = '';
        } else {
          throw new Error(data.reason || 'Unknown error');
        }
      } catch (error) {
        document.getElementById('error-container').innerHTML = 
          \`<div class="error">Error loading trades: \${error.message}</div>\`;
        console.error('Error loading trades:', error);
      }
    }
    
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        loadTrades();
      });
    });
    
    // Auto-refresh
    document.getElementById('auto-refresh').addEventListener('change', (e) => {
      if (e.target.checked) {
        autoRefreshInterval = setInterval(loadTrades, 5000);
      } else {
        if (autoRefreshInterval) {
          clearInterval(autoRefreshInterval);
          autoRefreshInterval = null;
        }
      }
    });
    
    // Initial load
    loadTrades();
    if (document.getElementById('auto-refresh').checked) {
      autoRefreshInterval = setInterval(loadTrades, 5000);
    }
  </script>
</body>
</html>`;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(dashboardHTML);
}

