-- Migration 006: RPC function for efficient candle range fetching
-- Alternative to REST pagination for very large datasets

-- Function: get_candles_range
-- Returns candles for a symbol/timeframe within a time range, ordered by ts ascending
-- Supports keyset pagination via p_after_ts and p_limit
CREATE OR REPLACE FUNCTION public.get_candles_range(
  p_symbol text,
  p_timeframe_min int,
  p_start_ts timestamptz,
  p_end_ts timestamptz,
  p_limit integer DEFAULT 1000,
  p_after_ts timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  symbol text,
  timeframe_min int,
  ts timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.symbol,
    c.timeframe_min,
    c.ts,
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume
  FROM public.candles c
  WHERE c.symbol = p_symbol
    AND c.timeframe_min = p_timeframe_min
    AND c.ts >= p_start_ts
    AND c.ts <= p_end_ts
    AND (p_after_ts IS NULL OR c.ts > p_after_ts)
  ORDER BY c.ts ASC
  LIMIT p_limit;
END;
$$;

-- Grant execute permission to service_role and authenticated
-- Note: Function signature includes new parameters (p_limit, p_after_ts) but grants work with any signature
GRANT EXECUTE ON FUNCTION public.get_candles_range(text, int, timestamptz, timestamptz, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_candles_range(text, int, timestamptz, timestamptz, integer, timestamptz) TO authenticated;

-- Comment
COMMENT ON FUNCTION public.get_candles_range IS 'Efficiently fetch candles for a symbol/timeframe within a time range. Returns ordered by ts ascending.';

