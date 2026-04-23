import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
    PieChart, Pie, Cell
} from 'recharts';
import {
    fetchActorTimeline,
    fetchActorDrift,
    fetchAlerts,
    fetchCoordination,
    fetchCaseDetail,
    updateMyCaseStatus
} from '../api/client';
import { analyzePost } from '../api/analysis';
import { setActiveCase } from '../api/caseStore';

export default function CaseDetailPage({ caseItem: propCase, onBack: propOnBack, triggerCasesRefresh, authToken }) {
    const { caseId } = useParams();
    const navigate = useNavigate();

    const [caseItem, setCaseItem] = useState(propCase || null);
    const [currentStatus, setCurrentStatus] = useState('active');
    const [isUpdating, setIsUpdating] = useState(false);
    const [message, setMessage] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, newStatus: null });
    const [linkedCaseId, setLinkedCaseId] = useState(caseId || null);

    // Investigation Data States
    const [timeline, setTimeline] = useState([]);
    const [drift, setDrift] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [coordinations, setCoordinations] = useState([]);
    const [maxDrift, setMaxDrift] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [analyzingIds, setAnalyzingIds] = useState(new Set());

    // Notes State
    const [notes, setNotes] = useState('');
    const [isSavingNotes, setIsSavingNotes] = useState(false);

    const onBack = propOnBack || (() => navigate('/cases'));

    // 1. Load Case from Backend on mount/refresh
    useEffect(() => {
        const isInvalid = !caseId || 
                          String(caseId) === 'null' || 
                          String(caseId) === 'undefined' || 
                          String(caseId).startsWith('case_');

        if (isInvalid) {
            setErrorState('Invalid case ID');
            setIsLoading(false);
            return;
        }

        async function loadCase() {
            if (!authToken) return;
            setIsLoading(true);
            setErrorState(null);
            try {
                const res = await fetchCaseDetail(authToken, caseId);
                if (res && res.status === 'ok' && res.item) {
                    setCaseItem(res.item);
                    setLinkedCaseId(res.item.id);
                    // Use posts from case detail directly
                    if (res.posts) {
                      // Sort by published_at (fallback to captured_at)
                      const sorted = [...res.posts].sort((a, b) => {
                        const da = new Date(a.published_at || a.captured_at || a.created_at);
                        const db = new Date(b.published_at || b.captured_at || b.created_at);
                        return db - da;
                      });
                      setTimeline(sorted);
                    }
                } else {
                    setErrorState(res?.message || 'Case not found');
                }
            } catch (err) {
                setErrorState(err.message);
            } finally {
                setIsLoading(false);
            }
        }
        
        loadCase();
    }, [caseId, authToken]);

    const [errorState, setErrorState] = useState(null);

    useEffect(() => {
        if (!caseItem) return;
        const statusRaw = String(caseItem.status || '').toLowerCase();
        setCurrentStatus(statusRaw === 'closed' ? 'closed' : 'active');
        
        if (linkedCaseId) {
            setActiveCase(String(linkedCaseId));
        }
    }, [caseItem, linkedCaseId]);

    useEffect(() => {
        if (!caseItem) return;

        // Load saved notes
        const caseStorageId = linkedCaseId || caseItem.id;
        const savedNotes = localStorage.getItem(`case_notes_${caseStorageId}`);
        if (savedNotes) {
            setNotes(savedNotes);
        }

        async function loadInvestigationData() {
            const accountId = caseItem.actor_id; // CRITICAL: Use actor_id, not case.id
            if (!accountId) {
              console.warn('Case item missing actor_id', caseItem);
              return;
            }
            const accountIdStr = String(accountId);

            try {
                // Fetch remaining data in parallel
                // Note: timeline is already loaded from getCaseDetail
                const [driftRes, alertsRes, coordRes] = await Promise.all([
                    fetchActorDrift(accountId),
                    fetchAlerts(1000), 
                    fetchCoordination(200)
                ]);

                /* 
                if (timelineRes.status === 'ok' || timelineRes.status === 'success') {
                    const list = Array.isArray(timelineRes.data)
                        ? timelineRes.data
                        : (timelineRes.items || timelineRes.data?.items || []);
                    setTimeline(list);
                }
                */

                // Set Drift
                if (driftRes.status === 'ok' || driftRes.status === 'success') {
                    const driftItems = driftRes.points || driftRes.items || [];
                    setDrift(driftItems);

                    let max = 0;
                    for (let i = 0; i < driftItems.length; i++) {
                        const val = driftItems[i].drift || Math.abs(driftItems[i].score || 0);
                        if (val > max) max = val;
                    }
                    setMaxDrift(max);
                }

                // Set Coordination (Filter for this account)
                let relatedCoord = [];
                let relatedCoordGroupIds = new Set();
                if (coordRes.status === 'ok' || coordRes.status === 'success') {
                    const allCoord = coordRes.items || [];
                    relatedCoord = allCoord.filter(c =>
                        Array.isArray(c.member_account_ids) && c.member_account_ids.some((id) => String(id) === accountIdStr)
                    );
                    relatedCoordGroupIds = new Set(relatedCoord.map((c) => String(c.id)));
                    setCoordinations(relatedCoord);
                }

                // Set Alerts (Filter for this account)
                if (alertsRes.status === 'ok' || alertsRes.status === 'success') {
                    const allAlerts = alertsRes.items || [];
                    const relatedAlerts = allAlerts.filter(a => {
                        if (!a) return false;

                        const directActorMatch =
                            (a.account_id !== null && a.account_id !== undefined && String(a.account_id) === accountIdStr) ||
                            (a.related_actor && a.related_actor.id !== null && a.related_actor.id !== undefined && String(a.related_actor.id) === accountIdStr);

                        if (!directActorMatch) return false;

                        const alertType = String(a.alert_type || a.type || '').toLowerCase();
                        if (alertType !== 'coordination') return true;

                        if (a.coordinated_group_id !== null && a.coordinated_group_id !== undefined) {
                            return relatedCoordGroupIds.has(String(a.coordinated_group_id));
                        }

                        return true;
                    });
                    setAlerts(relatedAlerts);
                }
            } catch (err) {
                console.error("Failed to load investigation data:", err);
            } finally {
                setIsLoading(false);
            }
        }

        loadInvestigationData();
    }, [caseItem, linkedCaseId]);

    const handleSaveNotes = () => {
        setIsSavingNotes(true);
        const caseStorageId = linkedCaseId || caseItem.id;
        localStorage.setItem(`case_notes_${caseStorageId}`, notes);
        showToast('Notes saved successfully', 'success');
        setTimeout(() => setIsSavingNotes(false), 500);
    };

    const showToast = (text, type = 'success') => {
        setMessage({ text, type });
        setTimeout(() => setMessage(null), 3000);
    };

    const requestStatusChange = (newStatus) => {
        setConfirmDialog({ isOpen: true, newStatus });
    };

    const confirmStatusChange = async () => {
        const newStatus = confirmDialog.newStatus;
        setConfirmDialog({ isOpen: false, newStatus: null });

        setIsUpdating(true);
        try {
            const statusNorm = String(newStatus || '').toLowerCase();
            const caseIdToUpdate = caseItem.id;

            if (caseIdToUpdate && authToken) {
                const res = await updateMyCaseStatus(authToken, caseIdToUpdate, statusNorm === 'closed' ? 'closed' : 'open');
                if (res && res.status === 'ok' && res.item) {
                  setCaseItem(res.item);
                  setCurrentStatus(res.item.status === 'closed' ? 'closed' : 'active');
                  showToast(`Case successfully marked as ${newStatus}`, 'success');
                  if (triggerCasesRefresh) triggerCasesRefresh();
                } else {
                  showToast(`Failed to update status: ${res.message || 'Unknown error'}`, 'error');
                }
            }
        } catch (e) {
            showToast(`Error: ${e.message}`, 'error');
        }
        setIsUpdating(false);
    };

    const cancelStatusChange = () => {
        setConfirmDialog({ isOpen: false, newStatus: null });
    };

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
                showToast(`Analysis failed: ${res.message}`, 'error');
            } else {
                showToast('Analysis completed successfully', 'success');
                // Refresh timeline
                const timelineRes = await fetchActorTimeline(caseItem.actor_id);
                if (timelineRes.status === 'ok' || timelineRes.status === 'success') {
                    const list = Array.isArray(timelineRes.data)
                        ? timelineRes.data
                        : (timelineRes.items || timelineRes.data?.items || []);
                    setTimeline(list);
                }
            }
        } catch (err) {
            showToast(`Analysis failed: ${err.message}`, 'error');
        } finally {
            setAnalyzingIds(prev => {
                const next = new Set(prev);
                next.delete(postId);
                return next;
            });
        }
    };

    // Calculate Quick Stats
    const totalPosts = timeline.length;
    let avgConfidence = 0;
    if (totalPosts > 0) {
        const confSum = timeline.reduce((acc, curr) => acc + (curr.analysis?.confidence || 0), 0);
        avgConfidence = (confSum / totalPosts) * 100;
    }
    const lastActivity = timeline.length > 0 ? new Date(timeline[0].created_at || timeline[0].captured_at).toLocaleDateString() : 'None';

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

    if (errorState) {
        return (
            <div style={{ padding: '80px 40px', textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠️</div>
                <h2 style={{ color: 'var(--text)' }}>{errorState}</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
                    This case could not be loaded. It may have been deleted or you may not have permission to view it.
                </p>
                <button className="btn btn-secondary" onClick={onBack}>Back to Cases</button>
            </div>
        );
    }

    if (isLoading || !caseItem) {
        return (
            <div style={{ padding: '40px', textAlign: 'center' }}>
                <p>Loading case details...</p>
                <div className="loading-spinner" style={{ margin: '20px auto' }}></div>
            </div>
        );
    }

    const getStatusBadge = (status) => {
        if (status === 'active') return <span className="badge badge-primary" style={{ fontSize: '0.9rem', padding: '4px 12px' }}>Active</span>;
        if (status === 'paused') return <span className="badge badge-warning" style={{ fontSize: '0.9rem', padding: '4px 12px' }}>Paused</span>;
        if (status === 'closed') return <span className="badge badge-gray" style={{ fontSize: '0.9rem', padding: '4px 12px' }}>Closed</span>;
        return <span className="badge badge-gray">{status}</span>;
    };

    return (
        <div style={{ position: 'relative', paddingBottom: '40px' }}>
            {/* Custom Confirm Dialog Box */}
            {confirmDialog.isOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', zIndex: 2000
                }}>
                    <div style={{
                        backgroundColor: 'var(--card-bg, #fff)', padding: '24px',
                        borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
                        maxWidth: '400px', width: '90%', border: '1px solid var(--border-color, #e5e7eb)'
                    }}>
                        <h3 style={{ marginTop: 0, marginBottom: '16px', color: 'var(--text)' }}>Confirm Action</h3>
                        <p style={{ marginBottom: '24px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                            Are you sure you want to mark this case as <strong>{confirmDialog.newStatus}</strong>?
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="btn btn-secondary" onClick={cancelStatusChange} style={{ backgroundColor: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmStatusChange} style={{ backgroundColor: confirmDialog.newStatus === 'closed' ? 'var(--error-text)' : 'var(--primary)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>Confirm</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notification */}
            {message && (
                <div style={{
                    position: 'fixed', top: '24px', right: '24px', padding: '16px 24px',
                    backgroundColor: message.type === 'error' ? 'var(--error-bg)' : 'var(--success-bg)',
                    color: message.type === 'error' ? 'var(--error-text)' : 'var(--success-text)',
                    borderRadius: '8px', border: `1px solid ${message.type === 'error' ? 'var(--error-text)' : 'var(--success-text)'}`,
                    zIndex: 1000, boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    display: 'flex', alignItems: 'center', gap: '12px',
                    animation: 'slideIn 0.3s ease-out forwards', fontWeight: '500'
                }}>
                    {message.type === 'success' ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    )}
                    {message.text}
                </div>
            )}

            <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>

            <button className="btn" onClick={onBack} style={{ backgroundColor: 'transparent', color: 'var(--primary)', border: '1px solid var(--primary)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', padding: '8px 16px', fontWeight: 500, cursor: 'pointer', borderRadius: '6px', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--info-bg)'} onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                Back to Cases
            </button>

            {/* HEADER CARD */}
            <div className="card" style={{ marginBottom: '24px', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                            <h2 style={{ margin: 0, color: 'var(--primary)', fontSize: '1.5rem', fontWeight: 'bold' }}>{caseItem.actor?.handle || caseItem.handle}</h2>
                            <span className="badge badge-platform">{caseItem.actor?.platform || caseItem.platform || 'X'}</span>
                            {getStatusBadge(currentStatus)}
                        </div>
                        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>Investigation View | ID: {caseId || caseItem.id}</p>
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                        {currentStatus === 'active' && <button className="btn btn-secondary" onClick={() => requestStatusChange('paused')} disabled={isUpdating}>Pause Case</button>}
                        {currentStatus === 'paused' && <button className="btn btn-primary" onClick={() => requestStatusChange('active')} disabled={isUpdating}>Resume Case</button>}
                        {currentStatus !== 'closed' && <button className="btn" style={{ backgroundColor: 'var(--error-text)', color: 'white', border: 'none' }} onClick={() => requestStatusChange('closed')} disabled={isUpdating}>Close Case</button>}
                        {currentStatus === 'closed' && <button className="btn btn-secondary" onClick={() => requestStatusChange('active')} disabled={isUpdating}>Reopen Case</button>}
                    </div>
                </div>
            </div>

            {/* QUICK STATS ROW */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 500 }}>Total Posts Analyzed</span>
                    <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text)' }}>{isLoading ? '...' : totalPosts}</span>
                </div>
                <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 500 }}>Avg Confidence</span>
                    <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text)' }}>{isLoading ? '...' : `${avgConfidence.toFixed(1)}%`}</span>
                </div>
                <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 500 }}>Max Drift</span>
                    <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: maxDrift >= 0.3 ? 'var(--error-text)' : 'var(--text)' }}>{isLoading ? '...' : `${(maxDrift * 100).toFixed(1)}%`}</span>
                </div>
                <div className="card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: 500 }}>Last Activity Date</span>
                    <span style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--text)' }}>{isLoading ? '...' : lastActivity}</span>
                </div>
            </div>

            <div className="detail-grid">
                {/* DRIFT CHART */}
                <div className="card" style={{ gridColumn: '1 / -1' }}>
                    <div className="card-header"><h3 className="card-title">Drift Analysis</h3></div>
                    {isLoading ? <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>Loading drift data...</div> : drift.length === 0 ? <div className="empty" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>No drift data available.</div> : (
                        <div style={{ height: '300px', width: '100%' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={drift.map((item, index) => ({ name: item.week || item.week_start || `Week #${index + 1}`, drift: item.drift || item.drift_score || 0 }))} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                    <XAxis dataKey="name" stroke="var(--text-light)" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis domain={[0, 1]} stroke="var(--text-light)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => `${(val * 100).toFixed(0)}%`} />
                                    <Tooltip contentStyle={{ borderRadius: '6px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', backgroundColor: 'var(--card-bg)', color: 'var(--text)' }} formatter={(val) => [`${(val * 100).toFixed(1)}%`, 'Drift']} />
                                    <ReferenceLine y={0.3} stroke="var(--error-text)" strokeDasharray="3 3" label={{ position: 'top', value: 'High Drift', fill: 'var(--error-text)', fontSize: 12 }} />
                                    <Line type="monotone" dataKey="drift" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4, fill: 'var(--primary)', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>                {/* SAVED POSTS TABLE */}
                <div className="card" style={{ gridColumn: 'span 2' }}>
                    <div className="card-header">
                        <h3 className="card-title">Saved Posts</h3>
                        {timeline.length > 0 && <span className="badge badge-primary">{timeline.length} items</span>}
                    </div>
                    {isLoading ? <div className="loading" style={{ padding: '20px', textAlign: 'center' }}>Loading saved posts...</div> : timeline.length === 0 ? (
                        <div className="empty" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>📊</div>
                            <p>No saved posts for this actor yet.</p>
                            <p style={{ fontSize: '0.85rem' }}>Run an investigation to collect posts.</p>
                        </div>
                    ) : (
                        <div className="table-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                            <table>
                                <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--card-bg)', zIndex: 10 }}>
                                    <tr>
                                        <th style={{ width: '100px' }}>Posted</th>
                                        <th style={{ width: '100px' }}>Captured</th>
                                        <th style={{ width: '100px' }}>Platform</th>
                                        <th>Content</th>
                                        <th style={{ width: '130px' }}>Analysis</th>
                                        <th style={{ width: '80px' }}>Link</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {timeline.map((post, i) => {
                                        const analysis = post.analysis || {};
                                        const label = analysis.predicted_label;
                                        const isAnalyzing = analyzingIds.has(post.post_id);
                                        const confidence = analysis.confidence ? `${(analysis.confidence * 100).toFixed(0)}%` : null;

                                        return (
                                            <tr key={post.post_id || i}>
                                                <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                    {post.published_at ? new Date(post.published_at).toLocaleDateString() : 'Unknown'}
                                                </td>
                                                <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                                    {new Date(post.captured_at || post.created_at).toLocaleDateString()}
                                                </td>
                                                <td>
                                                    <span className="badge badge-platform" style={{ fontSize: '0.75rem' }}>
                                                        {post.platform === 'twitter' ? 'X/Twitter' : post.platform}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div style={{ maxHeight: '60px', overflowY: 'hidden', textOverflow: 'ellipsis', fontSize: '0.9rem', lineHeight: '1.4' }}>
                                                        {post.raw_text}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            <span className={`badge ${label ? 'badge-primary' : 'badge-gray'}`} style={{ fontSize: '0.75rem' }}>
                                                                {label || 'Not analyzed'}
                                                            </span>
                                                            {confidence && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{confidence}</span>}
                                                        </div>
                                                        {!label && (
                                                            <button
                                                                className="btn btn-sm"
                                                                onClick={() => handleAnalyzePost(post.post_id)}
                                                                disabled={isAnalyzing}
                                                                style={{ padding: '2px 6px', fontSize: '0.65rem' }}
                                                            >
                                                                {isAnalyzing ? '...' : 'Analyze'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                                <td>
                                                    {post.url ? (
                                                        <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', fontSize: '0.8rem' }}>View</a>
                                                    ) : '-'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
v>

                {/* TOPIC DISTRIBUTION & ALERTS & NOTES */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* TOPICS */}
                    <div className="card">
                        <div className="card-header"><h3 className="card-title">Latest Topic Vectors</h3></div>
                        {isLoading ? <div className="loading" style={{ padding: '20px', textAlign: 'center' }}>Loading topics...</div> : !topicVector ? <div className="empty" style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>No topics available.</div> : (
                            <div style={{ height: '300px', width: '100%' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value">
                                            {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                                        </Pie>
                                        <Tooltip formatter={(val) => `${(val * 100).toFixed(1)}%`} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>

                    {/* ALERTS & COORDINATION */}
                    <div className="card">
                        <div className="card-header"><h3 className="card-title">Related Alerts</h3></div>
                        {isLoading ? <div className="loading" style={{ padding: '20px', textAlign: 'center' }}>Loading alerts...</div> : (alerts.length === 0 && coordinations.length === 0) ? <div className="empty" style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>No alerts or coordination found.</div> : (
                            <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '0 16px 16px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {alerts.map(alert => (
                                    <div key={alert.id} style={{ padding: '12px', backgroundColor: alert.severity === 'high' ? '#FEF2F2' : '#FFFBEB', borderRadius: '6px', borderLeft: `4px solid ${alert.severity === 'high' ? '#DC2626' : '#F59E0B'}`, fontSize: '0.9rem' }}>
                                        <strong>{alert.alert_type.toUpperCase()}</strong>: {alert.message}
                                    </div>
                                ))}
                                {coordinations.map(coord => (
                                    <div key={coord.id} style={{ padding: '12px', backgroundColor: '#EFF6FF', borderRadius: '6px', borderLeft: '4px solid #3B82F6', fontSize: '0.9rem' }}>
                                        <strong>COORDINATION ({coord.details?.group_size || coord.member_account_ids?.length} actors)</strong>: Similarity {(coord.similarity * 100).toFixed(1)}%
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ANALYST NOTES */}
                    <div className="card">
                        <div className="card-header"><h3 className="card-title">Analyst Notes</h3></div>
                        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Add your investigation findings here..."
                                style={{ width: '100%', minHeight: '120px', padding: '12px', borderRadius: '6px', border: '1px solid #d1d5db', fontFamily: 'inherit', resize: 'vertical' }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSaveNotes}
                                    disabled={isSavingNotes}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    {isSavingNotes ? 'Saving...' : 'Save Notes'}
                                </button>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
