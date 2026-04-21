require('dotenv').config();
const sql = require('mssql');

const baseConfig = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT) || 1998,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect({
      ...baseConfig,
      database: process.env.DB_DATABASE || 'viral_db',
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    });
  }
  return pool;
}

module.exports = { getPool, sql };
