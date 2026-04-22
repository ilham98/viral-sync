const router = require('express').Router();
const { getPool, sql } = require('../db');
const { requireAuth, requireApiKey } = require('../middleware/auth');
const https = require('https');
const http = require('http');

// GET /api/sync/history — JWT protected, paginated
router.get('/history', requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  try {
    const pool = await getPool();

    const countResult = await pool
      .request()
      .query('SELECT COUNT(*) AS total FROM sync_history');
    const total = countResult.recordset[0].total;

    const result = await pool
      .request()
      .input('limit', sql.Int, limit)
      .input('offset', sql.Int, offset)
      .query(`
        SELECT id, athlete_id, sync_date, status, response, triggered_at
        FROM sync_history
        ORDER BY triggered_at DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    res.json({
      data: result.recordset,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sync/log — API key protected, called by Python scheduler
router.post('/log', requireApiKey, async (req, res) => {
  const { athlete_id, sync_date, status, response } = req.body;
  if (!athlete_id || !sync_date || !status) {
    return res.status(400).json({ error: 'athlete_id, sync_date, and status are required' });
  }

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('athlete_id', sql.NVarChar(50), athlete_id)
      .input('sync_date', sql.Date, sync_date)
      .input('status', sql.NVarChar(20), status)
      .input('response', sql.NVarChar(sql.MAX), response || null)
      .query(`
        INSERT INTO sync_history (athlete_id, sync_date, status, response)
        OUTPUT INSERTED.id
        VALUES (@athlete_id, @sync_date, @status, @response)
      `);

    res.json({ ok: true, id: result.recordset[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/sync/log/:id — API key protected, update status/response of an existing record
router.patch('/log/:id', requireApiKey, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { status, response } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar(20), status)
      .input('response', sql.NVarChar(sql.MAX), response || null)
      .query('UPDATE sync_history SET status = @status, response = @response WHERE id = @id');

    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/sync/history — JWT protected, clears all history
router.delete('/history', requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query('DELETE FROM sync_history');
    res.json({ ok: true, deleted: result.rowsAffected[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sync/trigger — JWT protected, triggers an immediate sync on the scheduler
router.post('/trigger', requireAuth, async (req, res) => {
  const schedulerUrl = process.env.SCHEDULER_URL || 'http://scheduler:5050';
  const url = new URL('/trigger', schedulerUrl);
  const lib = url.protocol === 'https:' ? https : http;

  const request = lib.request(url, { method: 'POST' }, (upstream) => {
    let body = '';
    upstream.on('data', (chunk) => { body += chunk; });
    upstream.on('end', () => {
      if (upstream.statusCode === 202) return res.json({ ok: true });
      if (upstream.statusCode === 409) return res.status(409).json({ error: 'Sync already in progress' });
      res.status(502).json({ error: 'Scheduler returned unexpected status', status: upstream.statusCode });
    });
  });

  request.on('error', (err) => {
    console.error('Trigger error:', err);
    res.status(502).json({ error: 'Could not reach scheduler' });
  });

  request.end();
});

module.exports = router;
