import React, { useState } from 'react';
import { apiClient } from '../api/client';

export default function LoginPage({ onLoginSuccess, onNavigate }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiClient.loginAnalyst({ username, password });
      if (res && res.status === 'ok' && res.token && res.analyst) {
        onLoginSuccess(res.token, res.analyst);
        return;
      }
      setError(res?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: 'var(--bg)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '440px', padding: '28px' }}>
        <div style={{ marginBottom: '18px' }}>
          <h2 style={{ margin: 0, color: 'var(--primary)', fontSize: '1.75rem' }}>Analyst Login</h2>
          <div style={{ marginTop: '6px', color: 'var(--text-muted)' }}>
            Sign in to access your workspace.
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: 'var(--text)' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="analyst_1"
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: 'var(--text)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px' }}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(217, 48, 37, 0.08)', color: '#d93025', border: '1px solid rgba(217, 48, 37, 0.25)' }}>
              {error}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', padding: '10px 14px' }}>
            {loading ? 'Logging in…' : 'Log In'}
          </button>
        </form>

        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>New analyst?</span>
          <button className="btn btn-secondary" type="button" onClick={() => onNavigate('register')} style={{ padding: '8px 12px' }}>
            Create account
          </button>
        </div>
      </div>
    </div>
  );
}
