import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { fetchActorTimeline, fetchActorDrift, fetchActorDetails, fetchMyCases, createCaseForActor } from '../api/client';
import { analyzePost } from '../api/analysis';
import { setActiveCase } from '../api/caseStore';

export default function ActorDetailPage({ actor: propActor, onGoToCases, authToken }) {
  const { actorId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [actor, setActor] = useState(propActor || null);
  const [actorLoading, setActorLoading] = useState(!propActor);
  const [actorError, setActorError] = useState(null);

  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [timelineError, setTimelineError] = useState(null);

  const [drift, setDrift] = useState([]);
  const [driftLoading, setDriftLoading] = useState(true);
  const [driftError, setDriftError] = useState(null);
  const [maxDrift, setMaxDrift] = useState(0);
  const [caseActionBusy, setCaseActionBusy] = useState(false);
  const [caseForActor, setCaseForActor] = useState(null);
  const [analyzingIds, setAnalyzingIds] = useState(new Set());

  // Determine back label (defaults to Actors)
  // Check location state if we wanted to support 'Back to Alerts'
  const backLabel = 'Back to Actors';

  const handleBack = () => {
    navigate({
      pathname: '/actors',
      search: searchParams.toString()
    });
  };

  // 1. Fetch Actor Details if missing (on Refresh)
  useEffect(() => {
    async function getDetails() {
      if (actor && actor.handle !== 'Loading...') {
        setActorLoading(false);
        return;
      }
      
      setActorLoading(true);
      setActorError(null);
      try {
        const result = await fetchActorDetails(actorId);
        if (result.status === 'ok' && result.actor) {
          setActor(result.actor);
        } else {
          setActorError(result.message || 'Actor not found');
        }
      } catch (err) {
        setActorError(err.message);
      } finally {
        setActorLoading(false);
      }
    }
    
    if (actorId) getDetails();
  }, [actorId, propActor]);

  // 2. Load Case Info from Backend
  useEffect(() => {
    async function checkExistingCase() {
      if (!actor || !authToken) return;
      try {
        const res = await fetchMyCases(authToken);
        if (res && res.status === 'ok') {
          const openCase = (res.items || []).find(c => 
            String(c.actor_id) === String(actor.id) && c.status !== 'closed'
          );
          if (openCase) {
            setCaseForActor(openCase);
          }
        }
      } catch (e) {
        console.error('Failed to check existing cases', e);
      }
    }
    checkExistingCase();
  }, [actor, authToken]);

  const handleCaseAction = async () => {
    if (caseActionBusy || !actor || !authToken) return;
    setCaseActionBusy(true);

    try {
      const res = await createCaseForActor(authToken, actor.id);
      if (res && res.status === 'ok' && res.item) {
        const caseObj = res.item;
        setCaseForActor(caseObj);
        if (onGoToCases) onGoToCases(caseObj.id);
      } else {
        alert(`Failed to manage case: ${res.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCaseActionBusy(false);
    }
  };

  // 3. Load Timeline & Drift
  useEffect(() => {
    async function loadStats() {
      if (!actorId) return;
      
      // Load Timeline
      setTimelineLoading(true);
      setTimelineError(null);
      const timelineResult = await fetchActorTimeline(actorId, 100);
      
      if (timelineResult.status === 'error') {
        setTimelineError(timelineResult.message);
        setTimeline([]);
      } else {
        const list = Array.isArray(timelineResult.data) 
          ? timelineResult.data 
          : (timelineResult.items || timelineResult.data?.items || []);
        
        // Sort by published_at (fallback to captured_at)
        const sorted = [...list].sort((a, b) => {
          const da = new Date(a.published_at || a.captured_at || a.created_at);
          const db = new Date(b.published_at || b.captured_at || b.created_at);
          return db - da;
        });
        setTimeline(sorted);
      }
      setTimelineLoading(false);

      // Load Drift
      setDriftLoading(true);
      setDriftError(null);
      const driftResult = await fetchActorDrift(actorId);

      if (driftResult.status === 'error') {
        setDriftError(driftResult.message);
        setDrift([]);
        setMaxDrift(0);
      } else {
        const driftItems = driftResult.points || driftResult.items || [];
        setDrift(driftItems);
        let max = 0;
        for (let i = 0; i < driftItems.length; i++) {
          const val = driftItems[i].drift || driftItems[i].drift_score || driftItems[i].score || driftItems[i].cosine_drift || 0;
          if (val > max) max = val;
        }
        setMaxDrift(max);
      }
      setDriftLoading(false);
    }

    if (actorId) loadStats();
  }, [actorId]);

  const handleAnalyzePost = async (postId) => {
    if (analyzingIds.has(postId)) return;
    
    setAnalyzingIds(prev => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });

    try {
      const res = await analyzePost(postId);
      if (res && res.status === 'error') {
        alert(`Analysis failed: ${res.message}`);
      } else {
        const timelineResult = await fetchActorTimeline(actorId, 100);
        if (timelineResult && timelineResult.status !== 'error') {
          const list = Array.isArray(timelineResult.data) 
            ? timelineResult.data 
            : (timelineResult.items || timelineResult.data?.items || []);
          setTimeline(list);
        }
      }
    } catch (err) {
      alert(`Analysis failed: ${err.message}`);
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
    }
  };

  // Topic Distribution Logic
  const latestPost = timeline && timeline.length > 0 ? timeline[0] : null;
  const topicVector = latestPost?.analysis?.topic_vector;
  
  let pieData = [];
  let dominantTopic = '';
  
  if (topicVector && Array.isArray(topicVector) && topicVector.length >= 4) {
    const labels = ['Economy & Business', 'Politics & Governance', 'Society & Health', 'Technology & Cyber'];
    const colors = ['#F59E0B', '#241571', '#48AAAD', '#0492C2'];
    
    pieData = labels.map((label, idx) => ({
      name: label,
      value: topicVector[idx] || 0,
      color: colors[idx]
    }));
    
    const maxVal = Math.max(...pieData.map(d => d.value));
    const dominant = pieData.find(d => d.value === maxVal);
    dominantTopic = dominant ? dominant.name : '';
  }

  if (actorLoading && !actor) return <div className="loading" style={{ padding: '40px' }}>Loading actor profile...</div>;
  if (actorError) return <div className="error" style={{ padding: '40px' }}>Error: {actorError}</div>;
  if (!actor) return null;

  return (
    <div>
      <button 
        className="btn" 
        onClick={handleBack}
        style={{ 
          backgroundColor: 'transparent', 
          color: '#5576d1', 
          border: '1px solid #5576d1',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '20px',
          padding: '8px 16px',
          fontWeight: 500,
          cursor: 'pointer',
          borderRadius: '6px',
          transition: 'all 0.2s'
        }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(85, 118, 209, 0.1)'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        {backLabel}
      </button>

      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px', flexWrap: 'wrap' }}>
              <h2 className="page-title" style={{ marginBottom: 0 }}>{actor.handle}</h2>
              <span className="badge badge-platform">{actor.platform}</span>
            </div>
            <p className="page-subtitle">Detailed analysis and activity timeline</p>
          </div>

          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
            <button
              className="btn btn-primary"
              onClick={handleCaseAction}
              disabled={caseActionBusy}
              style={{ backgroundColor: '#5576d1' }}
            >
              {(() => {
                const st = caseForActor ? String(caseForActor.status || '').toLowerCase() : '';
                if (caseForActor && st !== 'closed') return 'View Active Case';
                if (caseForActor && st === 'closed') return 'Reopen Case';
                return 'Open Case';
              })()}
            </button>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        {/* Overview Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Actor Overview</h3>
          </div>
          <div className="info-row">
            <span className="info-label">Display Name</span>
            <span className="info-value">{actor.display_name || '-'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Posts Analyzed</span>
            <span className="info-value">{actor.analyzed_count || 0} / {actor.post_count || 0}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Last Seen</span>
            <span className="info-value">{actor.last_seen ? new Date(actor.last_seen).toLocaleString() : 'Never'}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Created At</span>
            <span className="info-value">{actor.created_at ? new Date(actor.created_at).toLocaleDateString() : 'Unknown'}</span>
          </div>
        </div>

        {/* Topic Distribution Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Topic Distribution</h3>
          </div>
          
          {timelineLoading ? (
            <div className="loading">Loading analysis...</div>
          ) : !latestPost || !topicVector ? (
            <div className="empty">No analysis data available for topic distribution.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'relative', height: '250px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => `${(val * 100).toFixed(1)}%`} />
                  </PieChart>
                </ResponsiveContainer>
                
                {/* Center Text */}
                <div style={{
                  position: 'absolute', 
                  top: '50%', 
                  left: '50%', 
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center',
                  width: '120px',
                  pointerEvents: 'none'
                }}>
                  <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase' }}>Dominant</div>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: '#374151', lineHeight: '1.2' }}>
                    {dominantTopic}
                  </div>
                </div>
              </div>

              {/* Legend Below */}
              <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', paddingBottom: '10px' }}>
                 {pieData.map(d => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', fontSize: '11px', color: '#4b5563', backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                      <span style={{ width: 8, height: 8, backgroundColor: d.color, borderRadius: '50%', marginRight: 6 }}></span>
                      <span>{d.name.split(' ')[0]}: <b>{(d.value * 100).toFixed(1)}%</b></span>
                    </div>
                 ))}
              </div>
            </div>
          )}
        </div>

        {/* Drift Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Drift Analysis</h3>
            <span className="badge badge-accent">Max: {(maxDrift * 100).toFixed(1)}%</span>
          </div>
          
          {driftLoading ? (
            <div className="loading">Loading drift data...</div>
          ) : driftError ? (
            <div className="error">Error: {driftError}</div>
          ) : drift.length === 0 ? (
            <div className="empty">No drift data available.</div>
          ) : (
            <div>
              {/* Chart Section */}
              <div style={{ height: '300px', marginBottom: '24px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={drift.map((item, index) => {
                      const val = item.drift || item.drift_score || item.score || item.cosine_drift || 0;
                      return {
                        name: item.week || item.week_start || `Week #${index + 1}`,
                        drift: val,
                        driftPct: (val * 100).toFixed(1)
                      };
                    })}
                    margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis 
                      dataKey="name" 
                      stroke="#9ca3af" 
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis 
                      domain={[0, 1]} 
                      stroke="#9ca3af" 
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: '#fff', 
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
                      }}
                      formatter={(value) => [`${(value * 100).toFixed(1)}%`, 'Drift']}
                      labelStyle={{ color: '#374151', fontWeight: 600, marginBottom: '4px' }}
                    />
                    <ReferenceLine y={0.3} stroke="#ff0000" strokeDasharray="3 3" label={{ position: 'top', value: 'High Drift (0.30)', fill: '#ff0000', fontSize: 12 }} />
                    <Line 
                      type="monotone" 
                      dataKey="drift" 
                      stroke="#5576d1" 
                      strokeWidth={3}
                      dot={{ r: 4, fill: '#5576d1', strokeWidth: 2 }}
                      activeDot={{ r: 6, stroke: '#241571', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Table Section */}
              <div className="table-container" style={{ maxHeight: '200px', overflowY: 'auto', borderTop: '1px solid #e5e7eb' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Drift Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drift.map((item, index) => {
                      const label = item.week || item.week_start || item.period || item.label || `Week #${index + 1}`;
                      const value = item.drift || item.drift_score || item.score || item.cosine_drift;
                      const driftVal = (value !== undefined && value !== null) ? value : null;
                      const isHighDrift = driftVal >= 0.30;

                      return (
                        <tr 
                          key={index}
                          style={isHighDrift ? { borderLeft: '4px solid var(--primary)', backgroundColor: 'var(--info-bg)' } : {}}
                        >
                          <td style={isHighDrift ? { paddingLeft: '12px' } : {}}>{label}</td>
                          <td>
                            {driftVal !== null ? (
                              <span style={isHighDrift ? { fontWeight: '700', color: 'var(--primary)' } : {}}>
                                {(Number(driftVal) * 100).toFixed(1)}%
                              </span>
                            ) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Timeline Card */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <h3 className="card-title">Activity Timeline</h3>
          </div>
          
          {timelineLoading ? (
            <div className="loading">Loading timeline...</div>
          ) : timelineError ? (
            <div className="error">Error: {timelineError}</div>
          ) : timeline.length === 0 ? (
            <div className="empty">No posts found in timeline.</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '120px' }}>Posted</th>
                    <th style={{ width: '120px' }}>Captured</th>
                    <th style={{ width: '80px' }}>Source</th>
                    <th>Content</th>
                    <th style={{ width: '150px' }}>Predicted Label</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.map((post, index) => {
                    const analysis = post.analysis || {};
                    const label = analysis.predicted_label || "Not analyzed";

                    return (
                      <tr key={post.post_id || index}>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          {post.published_at ? new Date(post.published_at).toLocaleDateString() : 'Unknown'}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          {new Date(post.captured_at || post.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          {post.url ? (
                            <a 
                              href={post.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              style={{ 
                                color: '#5576d1', 
                                textDecoration: 'none', 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '4px',
                                fontSize: '0.85rem',
                                fontWeight: 500
                              }}
                              onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                              onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                            >
                              View
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                <polyline points="15 3 21 3 21 9"></polyline>
                                <line x1="10" y1="14" x2="21" y2="3"></line>
                              </svg>
                            </a>
                          ) : (
                            <span style={{ color: '#9ca3af' }}>—</span>
                          )}
                        </td>
                        <td>
                          <div style={{ maxHeight: '100px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
                            {post.raw_text || <span className="text-light">(no text)</span>}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span className={`badge ${label === 'Not analyzed' ? 'badge-gray' : 'badge-primary'}`}>
                              {label}
                            </span>
                            {label === 'Not analyzed' && (
                              <button
                                className="btn btn-sm"
                                onClick={() => handleAnalyzePost(post.post_id)}
                                disabled={analyzingIds.has(post.post_id)}
                                style={{
                                  padding: '2px 8px',
                                  fontSize: '0.75rem',
                                  backgroundColor: '#f3f4f6',
                                  color: '#374151',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '4px',
                                  cursor: analyzingIds.has(post.post_id) ? 'not-allowed' : 'pointer'
                                }}
                              >
                                {analyzingIds.has(post.post_id) ? 'Analyzing...' : 'Analyze'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

