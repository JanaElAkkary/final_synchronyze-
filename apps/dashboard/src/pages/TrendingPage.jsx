import React, { useState, useEffect } from 'react';
import { fetchTrendingLatest } from '../api/client';
import DataTable from '../components/DataTable';

export default function TrendingPage() {
  const [platform, setPlatform] = useState('twitter');
  const [category, setCategory] = useState('trending'); // 'trending' or 'news'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTrendingLatest({ platform, category });
      if (result.status === 'error') {
        setError(result.message);
      } else {
        setData(result);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch trending data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, category]);

  const renderMovement = (item) => {
    if (item.movement === 'new') {
      return <span className="movement-new">NEW</span>;
    }
    if (item.movement === 'up') {
      return <span className="movement-up">↑ +{item.movement_delta}</span>;
    }
    if (item.movement === 'down') {
      // movement_delta is negative for down
      return <span className="movement-down">↓ {item.movement_delta}</span>;
    }
    return <span className="movement-same">—</span>;
  };

  const renderSeverity = (item) => {
    if (!item.severity) return <span className="severity-neutral">—</span>;
    const sev = item.severity.toLowerCase();
    return (
      <span className={`trending-severity-badge severity-${sev}`}>
        {item.severity}
      </span>
    );
  };

  const columns = [
    { label: 'Rank', key: 'current_rank', width: '80px', sortable: true },
    { 
      label: 'Prev', 
      key: 'previous_rank',
      render: (item) => item.previous_rank || '-',
      width: '80px',
      sortable: true
    },
    { 
      label: 'Movement', 
      render: (item) => renderMovement(item),
      width: '100px'
    },
    { 
      label: 'Label', 
      key: 'label', 
      render: (item) => <span dir="auto" style={{ fontWeight: 600 }}>{item.label}</span>,
      sortable: true 
    },
    { 
      label: 'Context', 
      key: 'item_type',
      render: (item) => <span className="text-secondary" style={{ fontSize: '0.85rem' }}>{item.item_type || '-'}</span>,
      sortable: true
    },
    { 
      label: 'Category', 
      key: 'category',
      render: (item) => <span className="badge badge-outline" style={{ textTransform: 'capitalize' }}>{item.category}</span>,
      sortable: true
    },
    { 
      label: 'Date', 
      key: 'snapshot_date',
      render: (item) => new Date(item.snapshot_date).toLocaleDateString(),
      width: '110px',
      sortable: true
    },
    { label: 'Severity', render: (item) => renderSeverity(item), width: '100px' },
    { 
      label: 'Source', 
      render: (item) => item.source_url ? (
        <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="link">Open</a>
      ) : '-',
      width: '70px'
    }
  ];

  return (
    <div className="page-container">
      <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Trending & News Intelligence</h1>
          <p className="page-subtitle">Monitor saved X Explore snapshots, rank movement, and alert severity.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <select 
            value={platform} 
            onChange={(e) => setPlatform(e.target.value)}
            style={{ height: '38px', borderRadius: '6px' }}
          >
            <option value="twitter">X / Twitter</option>
          </select>

          <div style={{ display: 'flex', background: 'var(--bg)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <button 
              className={`btn ${category === 'trending' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setCategory('trending')}
              style={{ padding: '6px 16px', fontSize: '0.85rem', height: '30px' }}
            >
              Trending
            </button>
            <button 
              className={`btn ${category === 'news' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setCategory('news')}
              style={{ padding: '6px 16px', fontSize: '0.85rem', height: '30px' }}
            >
              News
            </button>
          </div>
        </div>
      </div>

      {loading && <div className="loading">Fetching intelligence data...</div>}
      {error && <div className="error">{error}</div>}
      
      {!loading && !error && data && (
        <>
          {data.snapshot_date ? (
            <>
              <div className="summary-strip">
                <div className="summary-item">
                  <span className="summary-label">Latest Snapshot</span>
                  <span className="summary-value">{new Date(data.snapshot_date).toLocaleDateString()}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Previous Snapshot</span>
                  <span className="summary-value">
                    {data.previous_snapshot_date ? new Date(data.previous_snapshot_date).toLocaleDateString() : 'Baseline'}
                  </span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Items Captured</span>
                  <span className="summary-value">
                    {data.count}{category === 'trending' ? ' / 30' : ''}
                  </span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Platform</span>
                  <span className="summary-value" style={{ textTransform: 'capitalize' }}>{data.platform}</span>
                </div>
              </div>

              {/* Trending-specific warnings */}
              {category === 'trending' && data.warnings && data.warnings.includes('snapshot_too_small_for_alerting') && (
                <div className="warning-banner warning-banner-small">
                  <span>⚠️</span>
                  <span><strong>Small Snapshot Warning:</strong> Only {data.count} items were captured. Automated alerting is officially suppressed below 10 items.</span>
                </div>
              )}

              {category === 'trending' && data.warnings && data.warnings.includes('partial_snapshot') && !data.warnings.includes('snapshot_too_small_for_alerting') && (
                <div className="warning-banner warning-banner-partial">
                  <span>ℹ️</span>
                  <span><strong>Partial Snapshot:</strong> This snapshot contains {data.count} items (standard is 30). Comparisons may be incomplete.</span>
                </div>
              )}

              {/* News-specific neutral info */}
              {category === 'news' && (
                <>
                  {data.count === 0 ? (
                    <div className="warning-banner" style={{ background: 'var(--bg-secondary, #f8f9fa)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                      <span>ℹ️</span>
                      <span>No news items were visible in this snapshot.</span>
                    </div>
                  ) : data.count < 10 ? (
                    <div className="warning-banner" style={{ background: 'var(--bg-secondary, #f8f9fa)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                      <span>ℹ️</span>
                      <span>News snapshot captured {data.count} visible item(s). News lists may be shorter than Trending.</span>
                    </div>
                  ) : null}
                </>
              )}

              <div className="card">
                <DataTable 
                  rows={data.items} 
                  columns={columns} 
                  defaultSortKey="current_rank"
                  pageSizeOptions={[30, 50, 100]}
                />
              </div>
            </>
          ) : (
            <div className="empty">
              <h3>No Intelligence Data</h3>
              <p>No snapshots found for <strong>{platform}</strong> / <strong>{category}</strong>.</p>
              <p style={{ marginTop: '12px', fontSize: '0.85rem' }}>Start an Explore scan from the Search page to collect data.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
