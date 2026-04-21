-- viral_db schema reference
-- Run `node migrate.js` in the backend folder instead of this file directly.

CREATE TABLE app_users (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    username     NVARCHAR(100)  NOT NULL UNIQUE,
    password_hash NVARCHAR(255) NOT NULL,
    created_at   DATETIME2      DEFAULT GETDATE()
);

CREATE TABLE sync_history (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    athlete_id  NVARCHAR(50)   NOT NULL,
    sync_date   DATE           NOT NULL,
    status      NVARCHAR(20)   NOT NULL DEFAULT 'success',
    response    NVARCHAR(MAX),
    triggered_at DATETIME2     DEFAULT GETDATE()
);
