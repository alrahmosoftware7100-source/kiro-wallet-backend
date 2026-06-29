require('dotenv').config();

const http = require('http');
const app = require('./app');
const pool = require('./config/db');

const PORT = Number(process.env.PORT) || 5000;

async function startServer() {
  try {
    const server = http.createServer(app);

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    pool
      .query('SELECT NOW()')
      .then(() => {
        console.log('Database connected successfully');
      })
      .catch((error) => {
        console.error('Database connection check failed:', error.message);
      });

    server.on('error', (error) => {
      console.error('Server error:', error);
      process.exit(1);
    });

    const shutdown = async (signal) => {
      console.log(`${signal} received. Shutting down gracefully...`);

      server.close(async () => {
        try {
          await pool.end();
          console.log('Database pool closed');
          process.exit(0);
        } catch (dbError) {
          console.error('Error while closing database pool:', dbError.message);
          process.exit(1);
        }
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();
