require('dotenv').config();
const sql = require('mssql');
const bcrypt = require('bcrypt');

const base = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT) || 1998,
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
};

async function migrate() {
  console.log('Connecting to master...');
  let pool = await sql.connect({ ...base, database: 'master' });

  console.log('Creating database viral_db if not exists...');
  await pool.request().query(`
    IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'viral_db')
      CREATE DATABASE viral_db
  `);
  await pool.close();

  console.log('Connecting to viral_db...');
  pool = await sql.connect({ ...base, database: 'viral_db' });

  console.log('Creating tables...');
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='app_users' AND xtype='U')
    CREATE TABLE app_users (
      id            INT IDENTITY(1,1) PRIMARY KEY,
      username      NVARCHAR(100)  NOT NULL UNIQUE,
      password_hash NVARCHAR(255)  NOT NULL,
      created_at    DATETIME2      DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='sync_history' AND xtype='U')
    CREATE TABLE sync_history (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      athlete_id   NVARCHAR(50)   NOT NULL,
      sync_date    DATE           NOT NULL,
      status       NVARCHAR(20)   NOT NULL DEFAULT 'success',
      response     NVARCHAR(MAX),
      triggered_at DATETIME2      DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='athletes' AND xtype='U')
    CREATE TABLE athletes (
      id          INT IDENTITY(1,1) PRIMARY KEY,
      athlete_id  NVARCHAR(50)   NOT NULL UNIQUE,
      label       NVARCHAR(100),
      active      BIT            NOT NULL DEFAULT 1,
      created_at  DATETIME2      DEFAULT GETDATE()
    )
  `);

  console.log('Seeding default athlete...');
  const athleteExists = await pool
    .request()
    .input('aid', sql.NVarChar(50), '123317248')
    .query('SELECT id FROM athletes WHERE athlete_id = @aid');

  if (athleteExists.recordset.length === 0) {
    await pool
      .request()
      .input('aid', sql.NVarChar(50), '123317248')
      .input('lbl', sql.NVarChar(100), 'Default Athlete')
      .query('INSERT INTO athletes (athlete_id, label) VALUES (@aid, @lbl)');
    console.log('Default athlete seeded.');
  }

  const adminUsername = process.env.DEFAULT_SUPERADMIN_USERNAME || 'superadmin';
  const adminPassword = process.env.DEFAULT_SUPERADMIN_PASSWORD || 'changeme';

  console.log('Seeding default superadmin user...');
  const existing = await pool
    .request()
    .input('u', sql.NVarChar(100), adminUsername)
    .query('SELECT id FROM app_users WHERE username = @u');

  if (existing.recordset.length === 0) {
    const hash = await bcrypt.hash(adminPassword, 10);
    await pool
      .request()
      .input('u', sql.NVarChar(100), adminUsername)
      .input('h', sql.NVarChar(255), hash)
      .query('INSERT INTO app_users (username, password_hash) VALUES (@u, @h)');
    console.log(`Superadmin created  →  username: ${adminUsername}`);
  } else {
    console.log('Superadmin already exists, skipping seed.');
  }

  await pool.close();
  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
