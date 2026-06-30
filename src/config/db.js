const { Pool } = require('pg');

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

if (process.env.DB_SSL !== 'false') {
  dbConfig.ssl = {
    rejectUnauthorized: false,
  };
}

console.log('DB CONFIG:', {
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
});

const pool = new Pool(dbConfig);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

async function ensureWalletsSchema() {
  const client = await pool.connect();

  try {
    const infoResult = await client.query(`
      SELECT
        current_database() AS current_database,
        current_user AS current_user,
        current_schema() AS current_schema
    `);

    console.log('DB SESSION INFO:', infoResult.rows[0]);

    await client.query(`
      ALTER TABLE public.wallets
      ADD COLUMN IF NOT EXISTS address VARCHAR(255),
      ADD COLUMN IF NOT EXISTS private_key_encrypted TEXT,
      ADD COLUMN IF NOT EXISTS private_key_iv VARCHAR(255),
      ADD COLUMN IF NOT EXISTS private_key_tag VARCHAR(255)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.trusted_recovery_addresses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        network VARCHAR(20) NOT NULL,
        address VARCHAR(255) NOT NULL,
        address_normalized VARCHAR(255) NOT NULL,
        label VARCHAR(80),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT trusted_recovery_addresses_user_network_unique
          UNIQUE (user_id, network)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS trusted_recovery_addresses_lookup_idx
      ON public.trusted_recovery_addresses (network, address_normalized)
      WHERE is_active = TRUE
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.platform_fees (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
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
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS platform_fees_user_created_idx
      ON public.platform_fees (user_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS platform_fees_status_created_idx
      ON public.platform_fees (status, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.swap_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        platform_fee_id INTEGER REFERENCES public.platform_fees(id) ON DELETE SET NULL,
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
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS swap_orders_user_idempotency_idx
      ON public.swap_orders (user_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS swap_orders_user_created_idx
      ON public.swap_orders (user_id, created_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS swap_orders_provider_transaction_idx
      ON public.swap_orders (provider, provider_transaction_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS swap_orders_status_created_idx
      ON public.swap_orders (status, created_at DESC)
    `);

    const columnsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'wallets'
      ORDER BY ordinal_position
    `);

    console.log(
      'WALLETS TABLE COLUMNS:',
      columnsResult.rows.map((row) => row.column_name)
    );
  } catch (error) {
    console.error('DB STARTUP CHECK ERROR:', error);
    throw error;
  } finally {
    client.release();
  }
}

ensureWalletsSchema().catch((error) => {
  console.error('Failed to ensure wallets schema:', error);
});

module.exports = pool;
