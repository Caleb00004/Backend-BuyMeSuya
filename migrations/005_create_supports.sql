CREATE TABLE supports (
  id SERIAL PRIMARY KEY,
  tx_ref VARCHAR(100) UNIQUE NOT NULL,
  creator_id INTEGER REFERENCES users(id),
  fan_email VARCHAR(255) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | successful | failed | init_failed
  flw_ref VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);