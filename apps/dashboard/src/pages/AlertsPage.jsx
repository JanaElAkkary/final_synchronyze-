import React, { useState, useEffect } from 'react';
import { fetchAlerts, markAllAlertsRead } from '../api/client';
import DataTable from '../components/DataTable';

export default function AlertsPage({ onOpenGroup, onOpenActor, onRefreshAlertsCount }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Search and Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  
  // Modal State
  const [selectedAlert, setSelectedAlert] = useState(null);

  useEffect(() => {
    async function loadAlerts() {
      setLoading(true);
      setError(null);
      
      const result = await fetchAlerts();
      
      if (result.status === 'error') {
        setError(result.message);
        setAlerts([]);
      } else {
        setAlerts(result.items || []);
      }
      setLoading(false);
    }

    loadAlerts();
  }, []);

  // Filter Logic
  const filteredAlerts = alerts.filter(alert => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = 
      (alert.message && alert.message.toLowerCase().includes(term)) ||
      (alert.account_id && alert.account_id.toLowerCase().includes(term));

    const matchesType = typeFilter === 'All' || 
      (alert.alert_type && alert.alert_type.toLowerCase() === typeFilter.toLowerCase());

    return matchesSearch && matchesType;
  });

  const getBadgeClass = (type) => {
    switch (type.toLowerCase()) {
      case 'drift': return 'badge-accent';
      case 'coordination': return 'badge-primary';
      case 'trend_new_entry': return 'badge-success';
      case 'trend_news_entry': return 'badge-success';
      default: return 'badge-gray';
    }
  };

  const getTypeLabel = (alert) => {
    const t = (alert.alert_type || '').toLowerCase();
    const cat = (alert.payload?.category || '').toLowerCase();

    if (t === 'drift') return 'Drift Analysis';
    if (t === 'coordination') return 'Coordination';
    if (t === 'trend_new_entry' || t === 'trend_news_entry') {
      return cat === 'news' ? 'New News Entry' : 'New Trending Entry';
    }
    
    // Fallback: capitalize and replace underscores
    return t.split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const getSeverityStyle = (severity) => {
    // Muted severity styling
    switch (severity?.toLowerCase()) {
      case 'high': 
        return { color: 'var(--text)', fontWeight: '700' };
      case 'medium': 
        return { color: 'var(--text)', fontWeight: '600' };
      default: 
        return { color: 'var(--text-muted)', fontWeight: '500' };
    }
  };

  const formatAlertContent = (alert) => {
    const type = (alert.alert_type || '').toLowerCase();
    const msg = alert.message || '';

    if (type === 'drift') {
      // Try to parse drift value from message
      const match = msg.match(/drift=([\d\.]+)/);
      if (match) {
        const val = parseFloat(match[1]);
        if (!isNaN(val)) {
          return (
            <span style={{ fontWeight: '600', color: 'var(--text)' }}>
              Drift: {(val * 100).toFixed(1)}%
            </span>
          );
        }
      }
    }

    if (type === 'coordination') {
      let memberNames = [];

      // Priority 1: alert.related_group?.member_handles
      if (alert.related_group && Array.isArray(alert.related_group.member_handles)) {
        memberNames = alert.related_group.member_handles;
      } 
      // Priority 2: alert.payload?.member_handles
      else if (alert.payload && Array.isArray(alert.payload.member_handles)) {
        memberNames = alert.payload.member_handles;
      }
      // Priority 3: alert.payload?.member_account_ids
      else if (alert.payload && Array.isArray(alert.payload.member_account_ids)) {
        memberNames = alert.payload.member_account_ids.map(id => `Actor #${id}`);
      }

      // Format handles if they look like raw strings (add @ if missing)
      memberNames = memberNames.map(name => {
          if (typeof name === 'string' && !name.startsWith('@') && !name.startsWith('Actor #')) {
              return `@${name}`;
          }
          return name;
      });

      // Helper to format list with "and"
      const formatNames = (list) => {
        if (!list || list.length === 0) return '';
        const copy = [...list];
        if (copy.length === 1) return copy[0];
        if (copy.length === 2) return `${copy[0]} and ${copy[1]}`;
        const last = copy.pop();
        return `${copy.join(', ')} and ${last}`;
      };

      if (memberNames.length > 0) {
        const formatted = formatNames(memberNames);
        return (
          <div style={{ maxWidth: '400px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={formatted}>
            <span className="text-muted" style={{ marginRight: '4px' }}>Coordination detected between</span>
            <span style={{ fontWeight: '600', color: 'var(--text)' }}>
              {formatted}
            </span>
          </div>
        );
      }
    }

    return msg;
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllAlertsRead();
      
      // Refresh list silently
      const result = await fetchAlerts();
      if (result.status !== 'error') {
        setAlerts(result.items || []);
      }
      
      // Refresh badge
      if (onRefreshAlertsCount) {
        onRefreshAlertsCount();
      }
    } catch (err) {
      console.error('Failed to mark all as read', err);
    }
  };

  // Pre-process alerts for DataTable
  const processedAlerts = filteredAlerts.map(alert => {
      let relatedEntityLabel = '-';
      let targetGroupId = null;
      let targetActor = null;
      
      if (alert.related_actor) {
         targetActor = alert.related_actor;
         relatedEntityLabel = `@${targetActor.handle}`;
      } else if (alert.related_group) {
        targetGroupId = alert.related_group.id;
        relatedEntityLabel = `Group #${targetGroupId}`;
      } else if (alert.coordinated_group_id) {
        targetGroupId = alert.coordinated_group_id;
        relatedEntityLabel = `Group #${targetGroupId}`;
      } else {
         const msg = alert.message || '';
         const groupMatch = msg.match(/Group ID: (\d+)/);
         if (groupMatch) {
            targetGroupId = groupMatch[1];
            relatedEntityLabel = `Group ID: ${targetGroupId}`;
         }
      }

      const type = alert.alert_type || 'unknown';
      const isCoordination = type === 'coordination' && targetGroupId;
      const isDrift = type === 'drift' && (targetActor || alert.account_id);
      
      // All alerts are now clickable to show the modal report
      const isClickable = true;

      return {
          ...alert,
          relatedEntityLabel,
          targetGroupId,
          targetActor,
          isClickable
      };
  });

  const handleRowClick = (row) => {
      setSelectedAlert(row);
  };

  const columns = [
    {
      key: 'alert_type',
      label: 'Type',
      sortable: true,
      width: '160px',
      render: (row) => (
        <span className={`badge ${getBadgeClass(row.alert_type || 'unknown')}`}>
          {getTypeLabel(row)}
        </span>
      )
    },
    {
      key: 'severity',
      label: 'Severity',
      sortable: true,
      width: '100px',
      render: (row) => (
        <span style={getSeverityStyle(row.severity)}>
          {row.severity || 'Low'}
        </span>
      )
    },
    {
      key: 'message',
      label: 'Message',
      sortable: true,
      render: (row) => formatAlertContent(row)
    },
    {
      key: 'relatedEntityLabel',
      label: 'Related Entity',
      sortable: true,
      render: (row) => (
        <span className={row.isClickable ? "link" : "text-muted"}>
          {row.relatedEntityLabel}
        </span>
      )
    },
    {
      key: 'created_at',
      label: 'Time',
      sortable: true,
      width: '180px',
      render: (row) => (
        <span className="text-secondary">
          {row.created_at ? new Date(row.created_at).toLocaleString() : '-'}
        </span>
      )
    }
  ];

  if (loading) return <div className="loading">Loading alerts...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">System Alerts</h2>
        <p className="page-subtitle">Real-time notifications for detected anomalies and coordination</p>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Recent Alerts</h3>
        </div>

        {/* Controls Bar */}
        <div className="toolbar">
          <input 
            type="text" 
            placeholder="Search alerts..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '300px' }}
          />
          
          <select 
            value={typeFilter} 
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ 
              width: '150px',
              backgroundColor: 'var(--input-bg)',
              color: 'var(--text)',
              borderColor: 'var(--border)'
            }}
          >
            <option value="All">All Types</option>
            <option value="drift">Drift Analysis</option>
            <option value="coordination">Coordination</option>
            <option value="trend_new_entry">Trending & News</option>
            <option value="other">Other</option>
          </select>

          <button 
            onClick={handleMarkAllRead}
            style={{ 
              marginLeft: 'auto', 
              marginRight: '16px',
              padding: '6px 12px',
              cursor: 'pointer',
              backgroundColor: 'var(--hover)',
              color: 'var(--text)',
              border: 'none',
              borderRadius: '4px',
              fontWeight: '500'
            }}
          >
            Mark all as read
          </button>

          <span className="controls-count">
            Found {filteredAlerts.length} alerts
          </span>
        </div>

        <DataTable 
          columns={columns}
          rows={processedAlerts}
          onRowClick={handleRowClick}
          defaultSortKey="created_at"
          defaultSortDir="desc"
          pageSizeOptions={[10, 25, 50]}
        />
      </div>

      {/* Alert Detail Modal Overlay */}
      {selectedAlert && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '24px'
        }} onClick={() => setSelectedAlert(null)}>
          <div style={{
            backgroundColor: 'var(--card-bg)',
            maxWidth: '600px',
            width: '100%',
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            overflow: 'hidden',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column'
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--bg)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className={`badge ${getBadgeClass(selectedAlert.alert_type)}`}>
                  {getTypeLabel(selectedAlert)}
                </span>
                <span style={{ 
                  color: selectedAlert.severity?.toLowerCase() === 'high' ? 'var(--error-text)' : 'var(--text-muted)',
                  fontWeight: '600',
                  fontSize: '0.9rem',
                  textTransform: 'uppercase'
                }}>
                  {selectedAlert.severity} Severity
                </span>
              </div>
              <button 
                onClick={() => setSelectedAlert(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: '4px'
                }}
              >×</button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px', overflowY: 'auto' }}>
              
              {/* Trending/News Rich Report */}
              {(selectedAlert.alert_type === 'trend_new_entry' || selectedAlert.alert_type === 'trend_news_entry') ? (
                <div>
                   <div style={{ marginBottom: '24px' }}>
                      <h3 style={{ fontSize: '1.4rem', fontWeight: '800', marginBottom: '4px', color: 'var(--primary)' }}>
                        {selectedAlert.payload?.label || 'Unknown Topic'}
                      </h3>
                      <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                         <span>Platform: <b style={{ color: 'var(--text)' }}>{selectedAlert.payload?.platform === 'twitter' ? 'X/Twitter' : (selectedAlert.payload?.platform || 'X')}</b></span>
                         <span>•</span>
                         <span>Category: <b style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{selectedAlert.payload?.category || 'Trending'}</b></span>
                      </div>
                   </div>

                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                      <div style={{ background: 'var(--bg)', padding: '16px', borderRadius: '8px' }}>
                         <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>Status</div>
                         <div style={{ color: 'var(--success-text)', fontWeight: '700', fontSize: '1.1rem' }}>New Entry</div>
                      </div>
                      <div style={{ background: 'var(--bg)', padding: '16px', borderRadius: '8px' }}>
                         <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '4px' }}>Current Rank</div>
                         <div style={{ color: 'var(--primary)', fontWeight: '700', fontSize: '1.1rem' }}>#{selectedAlert.payload?.rank || '-'}</div>
                      </div>
                   </div>

                   <div style={{ background: 'var(--warning-bg)', border: '1px solid #FDE68A', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
                      <h4 style={{ color: 'var(--warning-text)', fontSize: '0.85rem', fontWeight: '700', marginBottom: '8px', textTransform: 'uppercase' }}>Why it was flagged</h4>
                      <p style={{ color: 'var(--text)', fontSize: '0.95rem', lineHeight: '1.5', margin: 0 }}>
                        This topic was not present in the previous saved snapshot 
                        {selectedAlert.payload?.previous_snapshot_date ? ` (${selectedAlert.payload.previous_snapshot_date})` : ''}, 
                        but appeared in the latest snapshot at rank #{selectedAlert.payload?.rank || 'Unknown'}.
                      </p>
                   </div>

                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', fontSize: '0.9rem' }}>
                      <div>
                        <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Snapshot Date</div>
                        <div style={{ fontWeight: '600' }}>{selectedAlert.payload?.snapshot_date || '-'}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>Previous Snapshot</div>
                        <div style={{ fontWeight: '600' }}>{selectedAlert.payload?.previous_snapshot_date || 'No previous snapshot'}</div>
                      </div>
                   </div>

                   <div style={{ marginTop: '24px' }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: '4px', fontSize: '0.9rem' }}>Source URL</div>
                      {selectedAlert.payload?.source_url ? (
                        <a href={selectedAlert.payload.source_url} target="_blank" rel="noopener noreferrer" className="link" style={{ wordBreak: 'break-all' }}>
                          {selectedAlert.payload.source_url}
                        </a>
                      ) : '-'}
                   </div>
                </div>
              ) : (
                /* Generic Report for Other Alerts */
                <div>
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '8px' }}>
                       {selectedAlert.payload?.platform && (
                         <span>Platform: <b style={{ color: 'var(--text)' }}>
                           {selectedAlert.payload.platform === 'twitter' ? 'X/Twitter' : selectedAlert.payload.platform}
                         </b></span>
                       )}
                       {selectedAlert.payload?.category && (
                         <>
                           <span>•</span>
                           <span>Category: <b style={{ color: 'var(--text)', textTransform: 'capitalize' }}>{selectedAlert.payload.category}</b></span>
                         </>
                       )}
                    </div>
                    <h4 style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase', marginBottom: '8px' }}>Message</h4>
                    <p style={{ fontSize: '1.1rem', fontWeight: '500', lineHeight: '1.5', margin: 0 }}>
                      {selectedAlert.message}
                    </p>
                  </div>

                  {/* Navigation Shortcuts */}
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                    {selectedAlert.targetGroupId && onOpenGroup && (
                      <button className="btn btn-primary" onClick={() => { onOpenGroup(selectedAlert.targetGroupId); setSelectedAlert(null); }}>
                        View Group Details
                      </button>
                    )}
                    {selectedAlert.targetActor && onOpenActor && (
                      <button className="btn btn-accent" onClick={() => { onOpenActor(selectedAlert.targetActor); setSelectedAlert(null); }}>
                        View Actor Profile
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Debug Details / Raw Payload */}
              <div style={{ marginTop: '32px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
                 <details>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: '600' }}>
                      Debug Details (JSON Payload)
                    </summary>
                    <pre style={{ 
                      backgroundColor: '#1e1e1e', 
                      color: '#d4d4d4', 
                      padding: '16px', 
                      borderRadius: '8px', 
                      marginTop: '12px',
                      fontSize: '0.8rem',
                      overflowX: 'auto',
                      maxHeight: '300px'
                    }}>
                      {JSON.stringify(selectedAlert.payload || {}, null, 2)}
                    </pre>
                 </details>
              </div>

              <div style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>
                 Alert ID: {selectedAlert.id} • Created at {new Date(selectedAlert.created_at).toLocaleString()}
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
              backgroundColor: 'var(--bg)'
            }}>
              <button className="btn btn-gray" onClick={() => setSelectedAlert(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
