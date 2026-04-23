import React, { useEffect, useMemo, useState } from 'react';
import { setActiveCase } from '../api/caseStore';
import { fetchMyCases, updateMyCaseStatus, deleteMyCase } from '../api/client';
import DataTable from '../components/DataTable';

export default function CasesPage({ onOpenCase, casesRefresh, highlightedCaseId, onHighlightCase, authToken }) {
  const [casesItems, setCasesItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [busyCaseId, setBusyCaseId] = useState(null);
  const [openMenuCaseId, setOpenMenuCaseId] = useState(null);
  const menuRef = React.useRef(null);
  const menuTriggerRef = React.useRef(null);

  const refreshCases = async () => {
    if (!authToken) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMyCases(authToken);
      if (res && res.status === 'ok') {
        // Backend returns items: [{ id, title, actor_id, status, created_at, actor: { handle... } }]
        setCasesItems(res.items || []);
      } else {
        setError(res?.message || 'Failed to fetch cases from backend');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshCases();
  }, [casesRefresh, authToken]);

  useEffect(() => {
    if (!openMenuCaseId) return;
    const onPointerDown = (e) => {
      const menuEl = menuRef.current;
      const triggerEl = menuTriggerRef.current;
      if (!menuEl) return;
      if (menuEl.contains(e.target)) return;
      if (triggerEl && triggerEl.contains(e.target)) return;
      setOpenMenuCaseId(null);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpenMenuCaseId(null);
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [openMenuCaseId]);

  useEffect(() => {
    if (!highlightedCaseId) return;
    const t = setTimeout(() => {
      const el = document.querySelector('tr.highlight-row');
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [highlightedCaseId, casesItems]);

  const normalized = useMemo(() => {
    return (casesItems || []).map((c) => {
      const actor = c.actor || {};
      const platform = actor.platform || null;
      const platformLabel = platform ? (platform === 'twitter' ? 'X' : platform) : '—';
      const statusRaw = (c.status || '').toLowerCase();
      const status = statusRaw === 'active' ? 'open' : (statusRaw || 'open');
      return {
        ...c,
        status,
        actor_handle: actor.handle || '',
        actor_display_name: actor.display_name || '',
        actor_platform: platformLabel
      };
    });
  }, [casesItems]);

  const filtered = useMemo(() => {
    const term = (searchTerm || '').toLowerCase().trim();
    if (!term) return normalized;
    return normalized.filter((c) => {
      const title = (c.title || '').toLowerCase();
      const handle = (c.actor_handle || '').toLowerCase();
      return title.includes(term) || handle.includes(term);
    });
  }, [normalized, searchTerm]);

  const getStatusBadge = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'open' || s === 'active') return <span className="badge badge-primary">Open</span>;
    if (s === 'closed') return <span className="badge badge-gray">Closed</span>;
    return <span className="badge badge-gray">{status || '—'}</span>;
  };

  const openCase = (row) => {
    if (!onOpenCase) return;
    if (!row || !row.id || String(row.id) === 'null' || String(row.id) === 'undefined') {
      console.warn('Invalid case row for navigation', row);
      return;
    }
    onOpenCase(row);
  };

  const closeCase = async (row) => {
    if (busyCaseId || !authToken) return;
    setBusyCaseId(row.id);
    try {
      const res = await updateMyCaseStatus(authToken, row.id, 'closed');
      if (res && res.status === 'ok') {
        refreshCases();
      } else {
        alert(`Failed to close case: ${res.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Error closing case: ${err.message}`);
    } finally {
      setBusyCaseId(null);
    }
  };

  const deleteCase = async (row) => {
    if (busyCaseId || !authToken) return;
    if (!window.confirm(`Are you sure you want to delete the case for @${row.actor?.handle || row.id}?`)) return;
    
    setBusyCaseId(row.id);
    try {
      const res = await deleteMyCase(authToken, row.id);
      if (res && res.status === 'ok') {
        if (highlightedCaseId && String(highlightedCaseId) === String(row.id)) {
          if (onHighlightCase) onHighlightCase(null);
        }
        refreshCases();
      } else {
        alert(`Failed to delete case: ${res.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Error deleting case: ${err.message}`);
    } finally {
      setBusyCaseId(null);
    }
  };

  const columns = [
    {
      key: 'title',
      label: 'Case',
      sortable: true,
      render: (row) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 800, color: 'var(--primary)' }}>
            {row.actor?.handle ? `@${row.actor.handle}` : (row.actor?.display_name || row.title || `Actor #${row.actor_id}`)}
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Actor #{row.actor_id}
          </span>
        </div>
      )
    },
    {
      key: 'actor_platform',
      label: 'Platform',
      sortable: true,
      render: (row) => (
        <span className="badge badge-platform">{row.actor?.platform || '—'}</span>
      )
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      render: (row) => (
        <span className="text-secondary">
          {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
        </span>
      )
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (row) => getStatusBadge(row.status)
    },
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      render: (row) => {
        const isClosed = (row.status || '').toLowerCase() === 'closed';
        const isBusy = busyCaseId === row.id;
        const menuOpen = String(openMenuCaseId || '') === String(row.id || '');
        return (
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'flex-start' }}>
            <button
              className="btn btn-secondary"
              ref={menuOpen ? menuTriggerRef : null}
              style={{
                padding: '6px 10px',
                fontSize: '0.95rem',
                lineHeight: 1,
                borderRadius: '10px',
                minWidth: '42px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onClick={(e) => {
                e.stopPropagation();
                setOpenMenuCaseId((prev) => (String(prev || '') === String(row.id) ? null : row.id));
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen ? 'true' : 'false'}
              disabled={isBusy}
              title="Actions"
            >
              ⋯
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                style={{
                  position: 'absolute',
                  top: '44px',
                  right: 0,
                  minWidth: '180px',
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.12)',
                  padding: '6px',
                  zIndex: 50
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  role="menuitem"
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '10px',
                    color: isClosed ? 'var(--text-muted)' : 'var(--error-text, #DC2626)',
                    cursor: isClosed ? 'not-allowed' : 'pointer'
                  }}
                  disabled={isClosed || isBusy}
                  onClick={() => {
                    setOpenMenuCaseId(null);
                    closeCase(row);
                  }}
                >
                  Close case
                </button>

                <button
                  role="menuitem"
                  className="btn btn-secondary"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    padding: '8px 10px',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: '10px',
                    color: 'var(--error-text, #DC2626)',
                    cursor: 'pointer'
                  }}
                  disabled={isBusy}
                  onClick={() => {
                    setOpenMenuCaseId(null);
                    deleteCase(row);
                  }}
                >
                  Delete case
                </button>
              </div>
            )}
          </div>
        );
      }
    }
  ];

  if (loading) return <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>Loading cases…</div>;
  if (error) return <div className="error" style={{ margin: '20px' }}>Error loading cases: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Cases</h2>
        <p className="page-subtitle">Your investigations, scoped to your analyst account</p>
      </div>

      <div className="card" style={{ marginBottom: '16px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <input
          type="text"
          placeholder="Search cases by title or actor handle…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: '360px', maxWidth: '100%' }}
        />
        <span className="controls-count">Showing {filtered.length} case{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '28px', borderLeft: '4px solid var(--primary)' }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: '1.05rem' }}>No cases yet</div>
          <div style={{ marginTop: '8px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            No open cases yet. Open a case from an actor profile to start an investigation.
          </div>
        </div>
      ) : (
        <div className="card">
          <DataTable
            columns={columns}
            rows={filtered}
            onRowClick={openCase}
            highlightedRowId={highlightedCaseId}
            defaultSortKey="created_at"
            defaultSortDir="desc"
            pageSizeOptions={[10, 25]}
          />
        </div>
      )}
    </div>
  );
}
