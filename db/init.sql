CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  rate_limit_per_min INT NOT NULL DEFAULT 6000,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_logs (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  request_id UUID NOT NULL,
  api_key_id INT REFERENCES api_keys(id),
  provider TEXT,
  model TEXT,
  cache_hit BOOLEAN NOT NULL,
  status_code INT NOT NULL,
  error_type TEXT,
  total_latency_ms INT NOT NULL,
  gateway_overhead_ms INT NOT NULL,
  retry_ms INT NOT NULL DEFAULT 0,
  prompt_tokens INT DEFAULT 0,
  completion_tokens INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_logs_ts ON request_logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_provider_ts ON request_logs (provider, ts DESC);

CREATE TABLE IF NOT EXISTS provider_stats_1m (
  minute TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  requests INT NOT NULL DEFAULT 0,
  errors INT NOT NULL DEFAULT 0,
  cache_hits INT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (minute, provider)
);

-- Seed demo key: plaintext = gw_demo_key
-- sha256('gw_demo_key') = cca350b1f05766b5b174381222fa8568b4e3b1a545a23239226dab756dd2a806
INSERT INTO api_keys (name, key_hash, rate_limit_per_min)
VALUES ('demo', 'cca350b1f05766b5b174381222fa8568b4e3b1a545a23239226dab756dd2a806', 60000)
ON CONFLICT (key_hash) DO NOTHING;
