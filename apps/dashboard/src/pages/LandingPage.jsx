import React from 'react';

export default function LandingPage({ analyst, onLogout }) {
  const displayName = analyst?.full_name || analyst?.username || 'Analyst';
  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h2 className="page-title" style={{ color: 'var(--primary)', fontSize: '2rem', marginBottom: '6px' }}>
            Welcome, {displayName}
          </h2>
          <p className="page-subtitle">Your analyst workspace is ready.</p>
        </div>
        <button className="btn btn-secondary" onClick={onLogout} style={{ height: '40px' }}>
          Log out
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        <div className="card" style={{ padding: '18px', borderLeft: '4px solid #5576d1' }}>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>My Active Cases</div>
          <div style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Placeholder for analyst-owned active cases.
          </div>
        </div>

        <div className="card" style={{ padding: '18px', borderLeft: '4px solid #0492C2' }}>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>Recent Alerts</div>
          <div style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Placeholder for alerts relevant to you.
          </div>
        </div>

        <div className="card" style={{ padding: '18px', borderLeft: '4px solid #241571' }}>
          <div style={{ fontWeight: 700, color: 'var(--text)' }}>Open New Case</div>
          <div style={{ marginTop: '6px', color: 'var(--text-muted)', fontSize: '0.95rem' }}>
            Placeholder for initiating a new case workflow.
          </div>
        </div>
      </div>
    </div>
  );
}
