export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', reason: 'Method not allowed' });
  }

  try {
    const payload = req.body ?? {};
    console.log('[webhook] Received payload:', JSON.stringify(payload));

    return res.status(200).json({
      status: 'ok',
      action: 'received',
      reason: 'Webhook endpoint stub. No trade executed yet.'
    });
  } catch (error) {
    console.error('[webhook] Error parsing payload:', error);
    return res.status(400).json({ status: 'error', reason: 'Invalid payload' });
  }
}

