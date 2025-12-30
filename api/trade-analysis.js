/**
 * Trade Analysis Viewer
 * 
 * HTML page to view trade analysis results
 */

const analysisHTML = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Buddy - Trade Analysis</title>
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

    .summary-grid {
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

    .analysis-card {
      background: #1a1f3a;
      border: 1px solid #2d3748;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .analysis-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid #2d3748;
    }

    .trade-info {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
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

    .badge-warning {
      background: #f59e0b;
      color: white;
    }

    .badge-info {
      background: #3b82f6;
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

    .outcome-section {
      margin-top: 15px;
    }

    .outcome-success {
      color: #10b981;
      font-weight: 600;
    }

    .outcome-failure {
      color: #ef4444;
      font-weight: 600;
    }

    .outcome-unknown {
      color: #9ca3af;
      font-weight: 600;
    }

    .issues-list, .warnings-list, .positives-list {
      margin-top: 10px;
      padding-left: 20px;
    }

    .issues-list li {
      color: #ef4444;
      margin: 5px 0;
    }

    .warnings-list li {
      color: #f59e0b;
      margin: 5px 0;
    }

    .positives-list li {
      color: #10b981;
      margin: 5px 0;
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

    .refresh-btn {
      background: #3b82f6;
      border: 1px solid #3b82f6;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 600;
      margin-bottom: 20px;
    }

    .refresh-btn:hover {
      background: #2563eb;
    }

    .price {
      font-family: 'Courier New', monospace;
      font-weight: 600;
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
      <h1>📊 Trade Analysis</h1>
      <div class="subtitle">Analysis of paper mode trades</div>
    </header>

    <div id="error-container"></div>
    <button class="refresh-btn" onclick="loadAnalysis()">🔄 Refresh Analysis</button>

    <div id="summary-container"></div>
    <div id="analyses-container"></div>
  </div>

  <script src="https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
  <script>
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

    function renderSummary(summary, currentMarketPrice, instrument) {
      const container = document.getElementById('summary-container');
      
      let html = '<div class="summary-grid">';
      
      html += '<div class="stat-card">';
      html += '<div class="stat-label">Total Trades</div>';
      html += \`<div class="stat-value">\${summary.total}</div>\`;
      html += '</div>';

      html += '<div class="stat-card">';
      html += '<div class="stat-label">Would Have Succeeded</div>';
      html += \`<div class="stat-value">\${summary.wouldHaveSucceeded}</div>\`;
      html += \`<div class="stat-subvalue">\${summary.successRate}% success rate</div>\`;
      html += '</div>';

      html += '<div class="stat-card">';
      html += '<div class="stat-label">Would Have Failed</div>';
      html += \`<div class="stat-value">\${summary.wouldHaveFailed}</div>\`;
      html += '</div>';

      html += '<div class="stat-card">';
      html += '<div class="stat-label">Unknown</div>';
      html += \`<div class="stat-value">\${summary.unknown}</div>\`;
      html += '</div>';

      html += '<div class="stat-card">';
      html += '<div class="stat-label">High Confidence</div>';
      html += \`<div class="stat-value">\${summary.highConfidence}</div>\`;
      html += '</div>';

      html += '<div class="stat-card">';
      html += '<div class="stat-label">Total Issues</div>';
      html += \`<div class="stat-value">\${summary.totalIssues}</div>\`;
      html += '</div>';

      html += '<div class="stat-card">';
      html += '<div class="stat-label">Total Warnings</div>';
      html += \`<div class="stat-value">\${summary.totalWarnings}</div>\`;
      html += '</div>';

      if (currentMarketPrice) {
        html += '<div class="stat-card">';
        html += '<div class="stat-label">Current Market Price</div>';
        html += \`<div class="stat-value">\${formatPrice(currentMarketPrice)}</div>\`;
        html += \`<div class="stat-subvalue">\${instrument}</div>\`;
        html += '</div>';
      }

      html += '</div>';
      container.innerHTML = html;
    }

    function renderAnalyses(analyses) {
      const container = document.getElementById('analyses-container');
      
      if (analyses.length === 0) {
        container.innerHTML = '<div class="loading">No analyses available</div>';
        return;
      }

      let html = '';

      analyses.forEach(analysis => {
        const outcomeClass = analysis.wouldHaveSucceeded === true ? 'outcome-success' : 
                            analysis.wouldHaveSucceeded === false ? 'outcome-failure' : 
                            'outcome-unknown';
        const outcomeText = analysis.wouldHaveSucceeded === true ? '✅ Would Have Succeeded' :
                           analysis.wouldHaveSucceeded === false ? '❌ Would Have Failed' :
                           '❓ Unknown';

        html += '<div class="analysis-card">';
        html += '<div class="analysis-header">';
        html += '<div>';
        html += \`<div style="font-size: 1.2em; font-weight: 600; margin-bottom: 5px;">\${outcomeText}</div>\`;
        html += \`<div class="timestamp">\${formatDate(analysis.timestamp)}</div>\`;
        html += '</div>';
        html += '<div class="trade-info">';
        html += \`<span class="badge badge-\${analysis.signal === 'LONG' ? 'long' : 'short'}">\${analysis.signal}</span>\`;
        html += \`<span class="badge badge-info">\${analysis.instrument}</span>\`;
        html += \`<span class="badge badge-\${analysis.confidence === 'high' ? 'success' : analysis.confidence === 'medium' ? 'warning' : 'error'}">\${analysis.confidence} confidence</span>\`;
        html += '</div>';
        html += '</div>';

        html += '<div style="margin-bottom: 15px;">';
        html += \`<strong>Entry:</strong> <span class="price">\${formatPrice(analysis.entryPrice)}</span> | \`;
        html += \`<strong>SL:</strong> <span class="price">\${formatPrice(analysis.stopLoss)}</span> | \`;
        html += \`<strong>TP:</strong> <span class="price">\${formatPrice(analysis.takeProfit)}</span> | \`;
        html += \`<strong>Size:</strong> <span class="price">\${formatPrice(analysis.positionSizeUsd)}</span>\`;
        html += '</div>';

        if (analysis.reason) {
          html += \`<div class="outcome-section \${outcomeClass}">\${analysis.reason}</div>\`;
        }

        if (analysis.historicalValidation) {
          const validation = analysis.historicalValidation;
          const validationClass = validation.outcome === 'win' ? 'outcome-success' : 
                                 validation.outcome === 'loss' ? 'outcome-failure' : 
                                 validation.outcome === 'open_profit' ? 'outcome-success' :
                                 validation.outcome === 'open_loss' ? 'outcome-failure' :
                                 'outcome-unknown';
          
          html += '<div style="margin-top: 10px; padding: 15px; background: #0f1419; border-radius: 8px; border-left: 4px solid ' + 
                  (validation.outcome === 'win' ? '#10b981' : validation.outcome === 'loss' ? '#ef4444' : '#f59e0b') + ';">';
          html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">';
          html += \`<strong style="font-size: 1.1em;">📊 Trade Validation</strong>\`;
          if (validation.validated) {
            html += '<span class="badge badge-success">Historical Data</span>';
          } else if (validation.method === 'current_price_check') {
            html += '<span class="badge badge-warning">Current Price Check</span>';
          } else {
            html += '<span class="badge badge-warning">Not Validated</span>';
          }
          html += '</div>';
          
          html += \`<div class="\${validationClass}" style="margin-bottom: 8px;">\${validation.reason}</div>\`;
          
          if (validation.exitPrice) {
            html += \`<div style="margin-top: 8px;"><strong>Exit Price:</strong> <span class="price">\${formatPrice(validation.exitPrice)}</span></div>\`;
          }
          if (validation.exitTime) {
            html += \`<div style="margin-top: 5px;"><strong>Exit Time:</strong> <span class="timestamp">\${formatDate(validation.exitTime)}</span></div>\`;
          }
          if (validation.currentPrice) {
            html += \`<div style="margin-top: 8px;"><strong>Current Price:</strong> <span class="price">\${formatPrice(validation.currentPrice)}</span></div>\`;
          }
          if (validation.candlesAnalyzed) {
            html += \`<div style="margin-top: 5px; color: #6b7280; font-size: 0.9em;">Analyzed \${validation.candlesAnalyzed} candles from historical data</div>\`;
          }
          
          // Add TradingView chart button
          if (analysis.entryPrice && analysis.stopLoss && analysis.takeProfit) {
            html += \`<div style="margin-top: 15px;"><button onclick="openTradingViewChart('\${analysis.instrument}', \${analysis.entryPrice}, \${analysis.stopLoss}, \${analysis.takeProfit}, '\${analysis.signal}', '\${analysis.timestamp}')" style="background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600;">📈 View on TradingView</button></div>\`;
          }
          
          html += '</div>';
        }

        if (analysis.issues.length > 0) {
          html += '<div style="margin-top: 15px;">';
          html += '<strong style="color: #ef4444;">⚠️ Issues:</strong>';
          html += '<ul class="issues-list">';
          analysis.issues.forEach(issue => {
            html += \`<li>\${issue}</li>\`;
          });
          html += '</ul>';
          html += '</div>';
        }

        if (analysis.warnings.length > 0) {
          html += '<div style="margin-top: 15px;">';
          html += '<strong style="color: #f59e0b;">⚠️ Warnings:</strong>';
          html += '<ul class="warnings-list">';
          analysis.warnings.forEach(warning => {
            html += \`<li>\${warning}</li>\`;
          });
          html += '</ul>';
          html += '</div>';
        }

        if (analysis.positives.length > 0) {
          html += '<div style="margin-top: 15px;">';
          html += '<strong style="color: #10b981;">✅ Positives:</strong>';
          html += '<ul class="positives-list">';
          analysis.positives.forEach(positive => {
            html += \`<li>\${positive}</li>\`;
          });
          html += '</ul>';
          html += '</div>';
        }

        html += '</div>';
      });

      container.innerHTML = html;
    }

    async function loadAnalysis() {
      document.getElementById('error-container').innerHTML = '';
      document.getElementById('summary-container').innerHTML = '<div class="loading">Loading analysis...</div>';
      document.getElementById('analyses-container').innerHTML = '';

      try {
        const response = await fetch('/api/analyze-trades?mode=paper');
        const data = await response.json();

        if (data.status === 'ok') {
          renderSummary(data.summary, data.currentMarketPrice, data.instrument);
          renderAnalyses(data.analyses);
        } else {
          throw new Error(data.reason || 'Unknown error');
        }
      } catch (error) {
        document.getElementById('error-container').innerHTML =
          \`<div class="error">Error loading analysis: \${error.message}</div>\`;
        console.error('Error loading analysis:', error);
      }
    }

    // Open TradingView chart with trade markers
    function openTradingViewChart(instrument, entryPrice, stopLoss, takeProfit, signal, timestamp) {
      // Use Deribit BTC Perpetual Futures Contract symbol
      // TradingView format: DERIBIT:BTCUSD.P
      const tvSymbol = 'DERIBIT:BTCUSD.P';
      
      // Create TradingView chart URL
      // Open in new window with the chart
      const chartUrl = \`https://www.tradingview.com/chart/?symbol=\${encodeURIComponent(tvSymbol)}&interval=5\`;
      window.open(chartUrl, '_blank');
      
      // Show trade details
      const entryTime = new Date(timestamp).toLocaleString('nl-NL');
      console.log(\`Trade Details:\\nSymbol: \${tvSymbol}\\nEntry: $\${entryPrice.toLocaleString()}\\nStop Loss: $\${stopLoss.toLocaleString()}\\nTake Profit: $\${takeProfit.toLocaleString()}\\nSignal: \${signal}\\nEntry Time: \${entryTime}\`);
    }

    // Load on page load
    loadAnalysis();
  </script>
</body>
</html>`;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(analysisHTML);
}

