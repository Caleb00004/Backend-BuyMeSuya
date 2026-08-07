CREATE TABLE tips (
  id SERIAL PRIMARY KEY,
  creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tipper_name VARCHAR(100),
  tipper_email VARCHAR(255),
  note TEXT,
  amount NUMERIC(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'NGN',
  platform_fee NUMERIC(10, 2) DEFAULT 0,
  net_amount NUMERIC(10, 2),                -- amount creator actually receives
  payment_provider VARCHAR(20),             -- 'paystack' | 'flutterwave'
  provider_reference VARCHAR(100) UNIQUE,   -- their transaction ref
  status VARCHAR(20) DEFAULT 'pending',     -- pending | success | failed
  created_at TIMESTAMP DEFAULT NOW()
);