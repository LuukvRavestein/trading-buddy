-- Migration 006: RPC function for efficient candle range fetching
-- Alternative to REST pagination for very large datasets

-- Function: get_candles_range
-- Returns candles for a symbol/timeframe within a time range, ordered by ts ascending
CREATE OR REPLACE FUNCTION public.get_candles_range(
  p_symbol text,
  p_timeframe_min int,
  p_start_ts timestamptz,
  p_end_ts timestamptz
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
  ORDER BY c.ts ASC;
END;
$$;

-- Grant execute permission to service_role and authenticated
GRANT EXECUTE ON FUNCTION public.get_candles_range(text, int, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_candles_range(text, int, timestamptz, timestamptz) TO authenticated;

-- Comment
COMMENT ON FUNCTION public.get_candles_range IS 'Efficiently fetch candles for a symbol/timeframe within a time range. Returns ordered by ts ascending.';

