import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client';

const PAGE_SIZE = 20;

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('id-ID', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Athlete Management Panel ─────────────────────────────────────────────────
function AthletePanel() {
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ athlete_id: '', label: '' });
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchAthletes = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get('/athletes');
      setAthletes(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAthletes(); }, [fetchAthletes]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setAdding(true);
    try {
      const { data } = await client.post('/athletes', form);
      setAthletes((prev) => [...prev, data]);
      setForm({ athlete_id: '', label: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add athlete');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this athlete from auto-sync?')) return;
    try {
      await client.delete(`/athletes/${id}`);
      setAthletes((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove athlete');
    }
  };

  return (
    <div className="table-card" style={{ marginBottom: '1.5rem' }}>
      <div className="table-header">
        <span>Athletes for Auto-Sync</span>
        <button className="btn-refresh" onClick={fetchAthletes} disabled={loading}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      <form className="athlete-form" onSubmit={handleAdd}>
        <input
          placeholder="Athlete ID (e.g. 123317248)"
          value={form.athlete_id}
          onChange={(e) => setForm((f) => ({ ...f, athlete_id: e.target.value }))}
          required
        />
        <input
          placeholder="Label (optional)"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
        />
        <button type="submit" className="btn-primary" disabled={adding}>
          {adding ? 'Adding…' : '+ Add'}
        </button>
      </form>
      {error && <div className="error-msg" style={{ margin: '0 1rem .75rem' }}>{error}</div>}

      {athletes.length === 0 ? (
        <div className="empty">No athletes configured.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Athlete ID</th>
              <th>Label</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {athletes.map((a) => (
              <tr key={a.id}>
                <td><code>{a.athlete_id}</code></td>
                <td>{a.label || '—'}</td>
                <td>{formatDate(a.created_at)}</td>
                <td>
                  <button className="btn-delete" onClick={() => handleDelete(a.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const navigate = useNavigate();
  const username = localStorage.getItem('username') || 'admin';

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const fetchHistory = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const { data } = await client.get('/sync/history', {
        params: { page: p, limit: PAGE_SIZE },
      });
      setRows(data.data);
      setTotal(data.total);
      setPages(data.pages);
      setPage(p);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(1); }, [fetchHistory]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    navigate('/login');
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      await client.post('/sync/trigger');
      setSyncMsg('Sync started!');
      setTimeout(() => setSyncMsg(''), 4000);
      setTimeout(() => fetchHistory(1), 3000);
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to trigger sync';
      setSyncMsg(msg);
      setTimeout(() => setSyncMsg(''), 5000);
    } finally {
      setSyncing(false);
    }
  };

  const successCount = rows.filter((r) => r.status === 'success').length;

  return (
    <div className="dashboard">
      <nav className="navbar">
        <h2>VIRAL — Sync Dashboard</h2>
        <div className="user-info">
          <button className="btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing…' : '⟳ Sync Now'}
          </button>
          {syncMsg && <span style={{ fontSize: '.85rem', marginLeft: '.5rem' }}>{syncMsg}</span>}
          <span>👤 {username}</span>
          <button className="btn-logout" onClick={handleLogout}>Logout</button>
        </div>
      </nav>

      <div className="content">
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{total}</div>
            <div className="stat-label">Total Syncs</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{successCount}</div>
            <div className="stat-label">Success (this page)</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{rows.length - successCount}</div>
            <div className="stat-label">Failed (this page)</div>
          </div>
        </div>

        <h3 style={{ marginBottom: '1rem' }}>Athletes</h3>
        <AthletePanel />

        <h3 style={{ marginBottom: '1rem' }}>Sync History</h3>
        <div className="table-card">
          <div className="table-header">
            <span>Recent Syncs</span>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button className="btn-refresh" onClick={() => fetchHistory(page)} disabled={loading}>
                {loading ? 'Loading…' : '↻ Refresh'}
              </button>
              <button
                className="btn-delete"
                disabled={loading || total === 0}
                onClick={async () => {
                  if (!window.confirm('Clear all sync history? This cannot be undone.')) return;
                  try {
                    await client.delete('/sync/history');
                    setRows([]);
                    setTotal(0);
                    setPages(1);
                    setPage(1);
                  } catch (err) {
                    alert(err.response?.data?.error || 'Failed to clear history');
                  }
                }}
              >
                Clear History
              </button>
            </div>
          </div>

          {loading ? (
            <div className="loading">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty">No sync records yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Athlete ID</th>
                  <th>Sync Date</th>
                  <th>Status</th>
                  <th>Response</th>
                  <th>Triggered At</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.athlete_id}</td>
                    <td>{row.sync_date?.split('T')[0]}</td>
                    <td>
                      <span className={`badge badge-${row.status}`}>{row.status}</span>
                    </td>
                    <td className="response-cell" title={row.response}>{row.response || '—'}</td>
                    <td>{formatDate(row.triggered_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="pagination">
            <button className="btn-page" onClick={() => fetchHistory(page - 1)} disabled={page <= 1 || loading}>
              ‹ Prev
            </button>
            <span>Page {page} of {pages}</span>
            <button className="btn-page" onClick={() => fetchHistory(page + 1)} disabled={page >= pages || loading}>
              Next ›
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
