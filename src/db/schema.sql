CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    phrase_hash TEXT NOT NULL UNIQUE,
    pin_hash TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    asset VARCHAR(20) NOT NULL DEFAULT 'USDT',
    network VARCHAR(20) NOT NULL DEFAULT 'TRC20',
    balance NUMERIC(18, 6) NOT NULL DEFAULT 0,
    address VARCHAR(255),
    private_key_encrypted TEXT,
    private_key_iv VARCHAR(255),
    private_key_tag VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trusted_recovery_addresses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    network VARCHAR(20) NOT NULL,
    address VARCHAR(255) NOT NULL,
    address_normalized VARCHAR(255) NOT NULL,
    label VARCHAR(80),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT trusted_recovery_addresses_user_network_unique
      UNIQUE (user_id, network)
);

CREATE INDEX IF NOT EXISTS trusted_recovery_addresses_lookup_idx
ON trusted_recovery_addresses (network, address_normalized)
WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS platform_fees (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    operation_type VARCHAR(30) NOT NULL DEFAULT 'swap',
    provider VARCHAR(50) NOT NULL DEFAULT 'changelly',
    provider_transaction_id VARCHAR(120),
    source_asset VARCHAR(20) NOT NULL,
    source_network VARCHAR(20),
    target_asset VARCHAR(20) NOT NULL,
    target_network VARCHAR(20),
    gross_amount NUMERIC(30, 12) NOT NULL,
    fee_asset VARCHAR(20) NOT NULL DEFAULT 'USDT',
    fee_amount NUMERIC(30, 12) NOT NULL,
    net_amount NUMERIC(30, 12) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'quoted',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_fees_user_created_idx
ON platform_fees (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS platform_fees_status_created_idx
ON platform_fees (status, created_at DESC);

CREATE TABLE IF NOT EXISTS swap_orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform_fee_id INTEGER REFERENCES platform_fees(id) ON DELETE SET NULL,
    idempotency_key VARCHAR(120),
    provider VARCHAR(50) NOT NULL DEFAULT 'changelly',
    provider_transaction_id VARCHAR(120) NOT NULL,
    source_asset VARCHAR(20) NOT NULL,
    source_network VARCHAR(20) NOT NULL,
    source_ticker VARCHAR(40) NOT NULL,
    target_asset VARCHAR(20) NOT NULL,
    target_network VARCHAR(20),
    target_ticker VARCHAR(40) NOT NULL,
    gross_amount NUMERIC(30, 12) NOT NULL,
    fee_asset VARCHAR(20) NOT NULL DEFAULT 'USDT',
    fee_amount NUMERIC(30, 12) NOT NULL,
    net_amount NUMERIC(30, 12) NOT NULL,
    estimated_target_amount NUMERIC(30, 12),
    payout_address VARCHAR(255) NOT NULL,
    payout_extra_id VARCHAR(120),
    refund_address VARCHAR(255),
    payin_address VARCHAR(255),
    payin_extra_id VARCHAR(120),
    status VARCHAR(30) NOT NULL DEFAULT 'created',
    provider_status VARCHAR(80),
    provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS swap_orders_user_idempotency_idx
ON swap_orders (user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS swap_orders_user_created_idx
ON swap_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS swap_orders_provider_transaction_idx
ON swap_orders (provider, provider_transaction_id);

CREATE INDEX IF NOT EXISTS swap_orders_status_created_idx
ON swap_orders (status, created_at DESC);
