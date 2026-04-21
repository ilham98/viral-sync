const router = require('express').Router();
const { getPool, sql } = require('../db');
const { requireAuth } = require('../middleware/auth');

// Allow both JWT (frontend) and API key (Python scheduler)
function authAny(req, res, next) {
  if (req.headers['x-api-key'] === process.env.INTERNAL_API_KEY) return next();
  requireAuth(req, res, next);
}

// GET /api/athletes
router.get('/', authAny, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      'SELECT id, athlete_id, label, created_at FROM athletes WHERE active = 1 ORDER BY created_at ASC'
    );
    res.json(result.recordset);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/athletes  { athlete_id, label }
router.post('/', requireAuth, async (req, res) => {
  const { athlete_id, label } = req.body;
  if (!athlete_id) return res.status(400).json({ error: 'athlete_id is required' });

  try {
    const pool = await getPool();

    // Check if a soft-deleted record already exists for this athlete_id
    const existing = await pool
      .request()
      .input('athlete_id', sql.NVarChar(50), athlete_id.trim())
      .query('SELECT id FROM athletes WHERE athlete_id = @athlete_id AND active = 0');

    let result;
    if (existing.recordset.length > 0) {
      // Reactivate the soft-deleted record
      result = await pool
        .request()
        .input('athlete_id', sql.NVarChar(50), athlete_id.trim())
        .input('label', sql.NVarChar(100), label?.trim() || null)
        .query(`
          UPDATE athletes SET active = 1, label = @label
          OUTPUT INSERTED.id, INSERTED.athlete_id, INSERTED.label, INSERTED.created_at
          WHERE athlete_id = @athlete_id AND active = 0
        `);
    } else {
      result = await pool
        .request()
        .input('athlete_id', sql.NVarChar(50), athlete_id.trim())
        .input('label', sql.NVarChar(100), label?.trim() || null)
        .query(`
          INSERT INTO athletes (athlete_id, label)
          OUTPUT INSERTED.id, INSERTED.athlete_id, INSERTED.label, INSERTED.created_at
          VALUES (@athlete_id, @label)
        `);
    }

    // If athlete_id already exists and is active, 409
    if (!result.recordset || result.recordset.length === 0) {
      return res.status(409).json({ error: 'Athlete ID already exists' });
    }

    res.status(201).json(result.recordset[0]);
  } catch (err) {
    if (err.number === 2627) return res.status(409).json({ error: 'Athlete ID already exists' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/athletes/:id  (soft delete)
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query('UPDATE athletes SET active = 0 WHERE id = @id');

    if (result.rowsAffected[0] === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
