-- Add unique constraint on (run_id, paper_config_id) for paper_accounts
-- This ensures idempotent seeding: one account per config per run

CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_accounts_run_config_unique 
  ON public.paper_accounts(run_id, paper_config_id);

