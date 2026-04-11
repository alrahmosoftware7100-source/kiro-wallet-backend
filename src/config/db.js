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

(async () => {
  try {
    const client = await pool.connect();

    try {
      const infoResult = await client.query(`
        SELECT
          current_database() AS current_database,
          current_user AS current_user,
          current_schema() AS current_schema
      `);

      console.log('DB SESSION INFO:', infoResult.rows[0]);

      const columnsResult = await client.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'wallets'
        ORDER BY ordinal_position
        `
      );

      console.log(
        'WALLETS TABLE COLUMNS:',
        columnsResult.rows.map((row) => row.column_name)
      );
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('DB STARTUP CHECK ERROR:', error);
  }
})();

module.exports = pool;