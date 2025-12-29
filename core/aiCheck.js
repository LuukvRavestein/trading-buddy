/**
 * AI Check Module
 * 
 * Uses OpenAI to provide a "second opinion" quality check on trades
 * before they are executed.
 * 
 * Environment variables:
 * - OPENAI_API_KEY (required for AI checks)
 * - ENABLE_AI_CHECK (optional, default: false)
 */

/**
 * Evaluate a trade proposal using OpenAI
 * 
 * @param {object} tradeData - Trade data to evaluate
 * @param {string} tradeData.signal - 'LONG' or 'SHORT'
 * @param {string} tradeData.symbol - Instrument symbol
 * @param {number} tradeData.entryPrice - Entry price
 * @param {number} tradeData.stopLoss - Stop loss price
 * @param {number} tradeData.takeProfit - Take profit price
 * @param {string} tradeData.trend - Current trend ('UP', 'DOWN', 'NEUTRAL')
 * @param {number} tradeData.positionSizeUsd - Position size in USD
 * @param {object} tradeData.riskCheck - Risk check results
 * @param {number} tradeData.equity - Account equity
 * @returns {Promise<object>} AI evaluation result
 */
export async function evaluateTradeProposal(tradeData) {
  const enableAI = process.env.ENABLE_AI_CHECK === 'true';
  const apiKey = process.env.OPENAI_API_KEY;

  // Check if AI check is enabled and API key is available
  if (!enableAI || !apiKey) {
    return {
      enabled: false,
      allow_trade: true,
      reason: enableAI ? 'OpenAI API key not configured' : 'AI check disabled',
      confidence: null,
      position_size_usd: tradeData.positionSizeUsd,
    };
  }

  try {
    // Build prompt for OpenAI
    const prompt = buildEvaluationPrompt(tradeData);

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Use cost-effective model, can be changed to gpt-4 for better analysis
        messages: [
          {
            role: 'system',
            content: 'You are an expert cryptocurrency trading analyst. Analyze trade proposals and provide objective assessments based on risk management, market conditions, and trading best practices.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent, analytical responses
        max_tokens: 500,
        response_format: { type: 'json_object' }, // Force JSON response
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from OpenAI');
    }

    // Parse JSON response
    let aiResponse;
    try {
      aiResponse = JSON.parse(content);
    } catch (error) {
      // If JSON parsing fails, try to extract JSON from text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Invalid JSON response from OpenAI');
      }
    }

    // Validate and format response
    return {
      enabled: true,
      allow_trade: aiResponse.allow_trade !== false, // Default to true if not specified
      reason: aiResponse.reason || 'AI evaluation completed',
      confidence: aiResponse.confidence ? parseFloat(aiResponse.confidence) : null,
      position_size_usd: aiResponse.position_size_usd 
        ? parseFloat(aiResponse.position_size_usd) 
        : tradeData.positionSizeUsd,
      analysis: aiResponse.analysis || null,
      risks: aiResponse.risks || null,
      recommendations: aiResponse.recommendations || null,
    };
  } catch (error) {
    console.error('[aiCheck] Error evaluating trade:', error);
    
    // On error, allow trade but log warning
    return {
      enabled: true,
      allow_trade: true,
      reason: `AI check failed: ${error.message}. Trade allowed by default.`,
      confidence: null,
      position_size_usd: tradeData.positionSizeUsd,
      error: error.message,
    };
  }
}

/**
 * Build evaluation prompt for OpenAI
 * 
 * @param {object} tradeData - Trade data
 * @returns {string} Prompt text
 */
function buildEvaluationPrompt(tradeData) {
  const {
    signal,
    symbol,
    entryPrice,
    stopLoss,
    takeProfit,
    trend,
    positionSizeUsd,
    riskCheck,
    equity,
  } = tradeData;

  // Calculate risk metrics
  const slDistance = riskCheck?.slDistancePercent || 
    (Math.abs(entryPrice - stopLoss) / entryPrice * 100);
  const rr = riskCheck?.riskReward || 
    (takeProfit ? Math.abs(takeProfit - entryPrice) / Math.abs(entryPrice - stopLoss) : null);
  const riskPercent = (positionSizeUsd / equity) * 100;

  return `Analyze this Bitcoin trading proposal and provide your assessment.

TRADE PROPOSAL:
- Signal: ${signal}
- Instrument: ${symbol}
- Entry Price: $${entryPrice.toLocaleString()}
- Stop Loss: $${stopLoss.toLocaleString()} (${slDistance.toFixed(2)}% distance)
- Take Profit: $${takeProfit ? takeProfit.toLocaleString() : 'Not specified'}
- Risk:Reward Ratio: ${rr ? rr.toFixed(2) : 'N/A'}
- Position Size: $${positionSizeUsd.toFixed(2)} (${riskPercent.toFixed(2)}% of equity)
- Account Equity: $${equity.toFixed(2)}
- Market Trend: ${trend || 'Unknown'}

Please provide your analysis in JSON format with the following structure:
{
  "allow_trade": true/false,
  "reason": "Brief explanation of your decision",
  "confidence": 0.0-1.0 (your confidence level in this trade),
  "position_size_usd": ${positionSizeUsd} (you can suggest a different size if needed),
  "analysis": "Detailed analysis of the trade setup",
  "risks": ["List of key risks identified"],
  "recommendations": ["Any recommendations for improvement"]
}

Consider:
1. Risk management: Is the stop loss appropriate? Is position size reasonable?
2. Risk:Reward ratio: Is the potential reward worth the risk?
3. Market context: Does the trade align with the current trend?
4. Entry timing: Is this a good entry point?
5. Overall quality: Is this a high-probability setup?

Be objective and conservative. Only recommend trades that meet high-quality standards.`;
}

/**
 * Check if AI check is enabled
 * 
 * @returns {boolean}
 */
export function isAICheckEnabled() {
  return process.env.ENABLE_AI_CHECK === 'true' && !!process.env.OPENAI_API_KEY;
}

