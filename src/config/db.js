const { Pool } = require('pg');

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
};

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