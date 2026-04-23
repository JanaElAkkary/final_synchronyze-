import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { searchPosts, searchActors, searchTrends, updateCaseStatus, createTask, fetchTasks, createCaseForActor } from '../api/client';

export default function SearchPage({ onOpenCase, onGoToCases, currentAnalyst, authToken }) {
    const [activeTab, setActiveTab] = useState('posts');

    // Shared UI state
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [message, setMessage] = useState(null);

    // Filter lists
    const platforms = ['All', 'X', 'Instagram', 'Facebook', 'Reddit', 'TikTok', 'Other'];
    const topics = ['All', 'Economy & Business', 'Politics & Governance', 'Society & Health', 'Technology & Cyber', 'None'];
    const confidences = ['All', '50', '70', '80'];
    const periods = ['7d', '14d', '30d'];

    // Posts State
    const [postQuery, setPostQuery] = useState('');
    const [postPlatform, setPostPlatform] = useState('All');
    const [postTopic, setPostTopic] = useState('All');
    const [postMinConf, setPostMinConf] = useState('All');
    const [postResults, setPostResults] = useState([]);
    const [postSearched, setPostSearched] = useState(false);

    // Users State
    const [userQuery, setUserQuery] = useState('');
    const [userPlatform, setUserPlatform] = useState('All');
    const [userResults, setUserResults] = useState([]);
    const [userSearched, setUserSearched] = useState(false);

    // Trends State
    const [trendPeriod, setTrendPeriod] = useState('7d');
    const [trendPlatform, setTrendPlatform] = useState('All');
    const [trendData, setTrendData] = useState(null);
    const [exploreTab, setExploreTab] = useState('trending'); // trending or news

    // Investigation State
    const [investigationStatus, setInvestigationStatus] = useState({});

    // Task Stats Widget State
    const [taskStats, setTaskStats] = useState({ pending: 0, in_progress: 0 });

    useEffect(() => {
        const loadTaskStats = async () => {
            try {
                const pendingRes = await fetchTasks({ status: 'pending', limit: 1 });
                const progressRes = await fetchTasks({ status: 'in_progress', limit: 1 });
                
                setTaskStats({
                    pending: pendingRes.total || 0,
                    in_progress: progressRes.total || 0
                });
            } catch (e) {
                console.error("Failed to load task stats", e);
            }
        };

        loadTaskStats();
        const interval = setInterval(loadTaskStats, 15000); // Refresh every 15s
        return () => clearInterval(interval);
    }, []);

    const showToast = (text, type = 'success') => {
        setMessage({ text, type });
        setTimeout(() => setMessage(null), 3000);
    };

    const handleCreateCase = async (accountId, handle, platformName) => {
        const actor = {
            id: accountId,
            handle: handle,
            platform: platformName
        };

        const existing = getCaseByActor(actor);
        let c = existing;
        if (c) {
            const st = String(c.status || '').toLowerCase();
            if (st === 'closed') {
                c = reopenCase(c.id) || c;
            }
            upsertActorMetadata(c.id, actor);
        } else {
            c = createCaseForActor(actor);
        }

        if (c && c.id) {
            setActiveCase(String(c.id));
            if (onGoToCases && typeof onGoToCases === 'function') {
                onGoToCases(String(c.id));
            }
            return c;
        }

        if (onOpenCase && typeof onOpenCase === 'function') {
            onOpenCase(actor);
        }
        return null;
    };

    const handleInvestigate = async (type, target, platform, actorId = null) => {
        if (!target || !target.trim()) {
            showToast('Please enter a target to investigate', 'error');
            return;
        }
        
        // Map 'X' to 'twitter' for backend compatibility
        let safePlatform = (platform && platform !== 'All') ? platform : 'twitter';
        if (safePlatform === 'X') safePlatform = 'twitter';
        
        const safeTarget = target.startsWith('@') ? target : (type === 'investigate_user' ? `@${target}` : target);
        const analystIdStr = currentAnalyst?.id ? String(currentAnalyst.id) : 'dashboard_user';

        if (type === 'investigate_user') {
            // No manual case creation here anymore. 
            // The backend /posts/capture hook will create it once the first post is scraped.
            try {
                createTask({
                    type: type,
                    target: safeTarget,
                    platform: safePlatform.toLowerCase(),
                    created_by: analystIdStr
                }).then(res => {
                    if (res && res.status === 'ok') {
                        showToast(`Investigation started for ${safeTarget}`, 'success');
                    }
                }).catch(() => { });
            } catch (e) { }
            return;
        }
        
        // Set local status
        const stateKey = actorId ? actorId : safeTarget;
        setInvestigationStatus(prev => ({ ...prev, [stateKey]: 'Pending...' }));

        // 1. Create Task
        try {
            const res = await createTask({
                type: type,
                target: safeTarget,
                platform: safePlatform.toLowerCase(),
                created_by: analystIdStr
            });
            
            if (res.id) {
                if (res.is_duplicate) {
                    showToast(`Task already in progress for ${safeTarget}`, 'warning');
                    setInvestigationStatus(prev => ({ ...prev, [stateKey]: 'In progress' }));
                } else {
                    showToast(`Investigation started for ${safeTarget}`, 'success');
                    // Keep as pending or switch to in progress? Prompt says:
                    // If response.is_duplicate true -> set card state to "In progress"
                    // Else show toast "Investigation task created" and set card state to "Pending…"
                    setInvestigationStatus(prev => ({ ...prev, [stateKey]: 'Pending…' }));
                }

                // 2. Create/Open Case (if actorId provided)
                if (actorId) {
                    await handleCreateCase(actorId, safeTarget, safePlatform);
                }
            } else {
                let errorMsg = 'Unknown error';
                if (typeof res.detail === 'string') errorMsg = res.detail;
                else if (Array.isArray(res.detail)) errorMsg = res.detail.map(e => e.msg || e).join(', ');
                else if (res.detail) errorMsg = JSON.stringify(res.detail);
                
                showToast(`Task creation failed: ${errorMsg}`, 'error');
                setInvestigationStatus(prev => {
                    const newState = { ...prev };
                    delete newState[stateKey];
                    return newState;
                });
            }
        } catch (err) {
            showToast(`Error: ${err.message}`, 'error');
            setInvestigationStatus(prev => {
                const newState = { ...prev };
                delete newState[stateKey];
                return newState;
            });
        }
    };

    const handleSearchPosts = async (e) => {
        if (e) e.preventDefault();
        if (!postQuery.trim()) return;

        setLoading(true);
        setError(null);
        setPostSearched(true);

        const res = await searchPosts(postQuery, postPlatform, postTopic, postMinConf);
        if (res.status === 'ok' || res.status === 'success') {
            setPostResults(res.items || []);
        } else {
            setError(res.message || 'Error searching posts');
        }
        setLoading(false);
    };

    const handleSearchUsers = async (e) => {
        if (e) e.preventDefault();
        if (!userQuery.trim()) return;

        setLoading(true);
        setError(null);
        setUserSearched(true);

        const res = await searchActors(userQuery, userPlatform);
        if (res.status === 'ok' || res.status === 'success') {
            setUserResults(res.items || []);
        } else {
            setError(res.message || 'Error searching users');
        }
        setLoading(false);
    };

    const loadTrends = async () => {
        setLoading(true);
        setError(null);

        const res = await searchTrends(trendPeriod, trendPlatform);
        if (res.status === 'ok' || res.status === 'success') {
            setTrendData(res);
        } else {
            setError(res.message || 'Error loading trends');
        }
        setLoading(false);
    };

    useEffect(() => {
        if (activeTab === 'trends') {
            loadTrends();
        }
    }, [activeTab, trendPeriod, trendPlatform]);

    // Highlighting helper for post text
    const renderHighlightedText = (text, query) => {
        if (!query || !text) return text;
        const parts = text.split(new RegExp(`(${query})`, 'gi'));
        return parts.map((part, index) =>
            part.toLowerCase() === query.toLowerCase() ? (
                <mark key={index} style={{ backgroundColor: '#fef08a', padding: '0 2px', borderRadius: '2px' }}>{part}</mark>
            ) : (
                part
            )
        );
    };

    return (
        <div style={{ position: 'relative', paddingBottom: '40px' }}>
            {/* Toast Notification */}
            {message && (
                <div style={{
                    position: 'fixed', top: '24px', right: '24px', padding: '16px 24px',
                    backgroundColor: message.type === 'error' ? '#FEF2F2' : '#F0FDF4',
                    color: message.type === 'error' ? '#991B1B' : '#166534',
                    borderRadius: '8px', border: `1px solid ${message.type === 'error' ? '#F87171' : '#86EFAC'}`,
                    zIndex: 1000, boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    display: 'flex', alignItems: 'center', gap: '12px',
                    animation: 'slideIn 0.3s ease-out forwards', fontWeight: '500'
                }}>
                    {message.text}
                </div>
            )}
            <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>

            <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 className="page-title" style={{ color: '#5576d1', fontSize: '2rem', marginBottom: '8px' }}>Discovery & Search</h2>
                    <p className="page-subtitle">Find posts, actors, and emerging trends</p>
                </div>
                
                {/* Task Status Widget */}
                <div style={{ 
                    backgroundColor: 'white', 
                    padding: '10px 16px', 
                    borderRadius: '8px', 
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    display: 'flex',
                    gap: '24px',
                    border: '1px solid #e5e7eb',
                    alignItems: 'center'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Pending</span>
                        <span style={{ fontSize: '1.25rem', fontWeight: '700', color: '#f59e0b' }}>{taskStats.pending}</span>
                    </div>
                    <div style={{ width: '1px', height: '30px', backgroundColor: '#e5e7eb' }}></div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '60px' }}>
                        <span style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Running</span>
                        <span style={{ fontSize: '1.25rem', fontWeight: '700', color: '#3b82f6' }}>{taskStats.in_progress}</span>
                    </div>
                </div>
            </div>

            {/* Sub-Navigation Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: '24px' }}>
                <button
                    onClick={() => setActiveTab('posts')}
                    style={{
                        padding: '12px 24px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: activeTab === 'posts' ? '2px solid #5576d1' : '2px solid transparent',
                        color: activeTab === 'posts' ? '#5576d1' : '#6b7280',
                        fontWeight: activeTab === 'posts' ? '600' : '500',
                        cursor: 'pointer',
                        fontSize: '1rem'
                    }}
                >
                    Post Search
                </button>
                <button
                    onClick={() => setActiveTab('users')}
                    style={{
                        padding: '12px 24px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: activeTab === 'users' ? '2px solid #5576d1' : '2px solid transparent',
                        color: activeTab === 'users' ? '#5576d1' : '#6b7280',
                        fontWeight: activeTab === 'users' ? '600' : '500',
                        cursor: 'pointer',
                        fontSize: '1rem'
                    }}
                >
                    User Search
                </button>
                <button
                    onClick={() => setActiveTab('trends')}
                    style={{
                        padding: '12px 24px',
                        background: 'transparent',
                        border: 'none',
                        borderBottom: activeTab === 'trends' ? '2px solid #5576d1' : '2px solid transparent',
                        color: activeTab === 'trends' ? '#5576d1' : '#6b7280',
                        fontWeight: activeTab === 'trends' ? '600' : '500',
                        cursor: 'pointer',
                        fontSize: '1rem'
                    }}
                >
                    Trend Search
                </button>
            </div>

            {error && <div className="error" style={{ marginBottom: '20px' }}>{error}</div>}

            {/* TAB CONTENT: POSTS */}
            {activeTab === 'posts' && (
                <div>
                    <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
                        <form onSubmit={handleSearchPosts} style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
                            <div style={{ flex: '1 1 200px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4b5563', marginBottom: '8px', fontWeight: '500' }}>Keyword</label>
                                <input
                                    type="text"
                                    value={postQuery}
                                    onChange={(e) => setPostQuery(e.target.value)}
                                    placeholder="Search post content..."
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}
                                />
                            </div>
                            <div style={{ width: '140px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4b5563', marginBottom: '8px', fontWeight: '500' }}>Platform</label>
                                <select value={postPlatform} onChange={(e) => setPostPlatform(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}>
                                    {platforms.map(p => <option key={p} value={p}>{p === 'X' ? 'X (Twitter)' : p}</option>)}
                                </select>
                            </div>
                            <div style={{ width: '180px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4b5563', marginBottom: '8px', fontWeight: '500' }}>Topic</label>
                                <select value={postTopic} onChange={(e) => setPostTopic(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}>
                                    {topics.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
                            <div style={{ width: '120px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4b5563', marginBottom: '8px', fontWeight: '500' }}>Min Confidence</label>
                                <select value={postMinConf} onChange={(e) => setPostMinConf(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}>
                                    {confidences.map(c => <option key={c} value={c}>{c === 'All' ? 'All' : `${c}%`}</option>)}
                                </select>
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ padding: '8px 24px', height: '39px' }}>
                                Search
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '8px 24px', height: '39px' }}
                                onClick={() => handleInvestigate('search_hashtag', postQuery, postPlatform)}
                                title="Create a task to scrape this hashtag/keyword"
                            >
                                Investigate
                            </button>
                        </form>
                    </div>

                    {loading ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>Loading results...</div>
                    ) : postSearched && postResults.length === 0 ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>No posts found matching your criteria.</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {postResults.map((post) => (
                                <div key={`post-${post.post_id}`} className="card" style={{ padding: '20px', borderLeft: '4px solid #5576d1' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span style={{ fontWeight: '600', color: '#111827' }}>@{post.handle}</span>
                                            <span className="badge badge-platform">{post.platform === 'twitter' ? 'X' : post.platform}</span>
                                            <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                                                {new Date(post.captured_at).toLocaleDateString()} {new Date(post.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={() => {
                                            handleCreateCase(post.account_id, post.handle, post.platform);
                                            showToast(`Case opened for @${post.handle}`, 'success');
                                        }}>
                                            Open Case
                                        </button>
                                    </div>
                                    <p style={{ margin: '0 0 16px 0', fontSize: '1rem', lineHeight: '1.5', color: '#374151' }}>
                                        {renderHighlightedText(post.text, postQuery)}
                                    </p>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <span className={`badge ${post.predicted_label ? 'badge-primary' : 'badge-gray'}`} style={{ backgroundColor: '#e0e7ff', color: '#241571' }}>
                                            {post.predicted_label || 'Uncategorized'}
                                        </span>
                                        {post.confidence && (
                                            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
                                                Conf: {(post.confidence * 100).toFixed(1)}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* TAB CONTENT: USERS */}
            {activeTab === 'users' && (
                <div>
                    <div className="card" style={{ padding: '20px', marginBottom: '24px' }}>
                        <form onSubmit={handleSearchUsers} style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'flex-end' }}>
                            <div style={{ flex: '1 1 200px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4b5563', marginBottom: '8px', fontWeight: '500' }}>Username / Handle</label>
                                <input
                                    type="text"
                                    value={userQuery}
                                    onChange={(e) => setUserQuery(e.target.value)}
                                    placeholder="Search by handle..."
                                    style={{ width: '100%', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}
                                />
                            </div>
                            <div style={{ width: '140px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4b5563', marginBottom: '8px', fontWeight: '500' }}>Platform</label>
                                <select value={userPlatform} onChange={(e) => setUserPlatform(e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}>
                                    {platforms.map(p => <option key={p} value={p}>{p === 'X' ? 'X (Twitter)' : p}</option>)}
                                </select>
                            </div>
                            <button type="submit" className="btn btn-primary" style={{ padding: '8px 24px', height: '39px' }}>
                                Search
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '8px 24px', height: '39px' }}
                                onClick={() => handleInvestigate('investigate_user', userQuery, userPlatform)}
                                title="Create a task to investigate this user"
                            >
                                Investigate
                            </button>
                        </form>
                    </div>

                    {loading ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>Loading results...</div>
                    ) : userSearched && userResults.length === 0 ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>No users found matching your criteria.</div>
                    ) : (
                        <div className="card">
                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Handle</th>
                                            <th>Platform</th>
                                            <th>Posts Analyzed</th>
                                            <th>Last Seen</th>
                                            <th style={{ textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {userResults.map(user => (
                                            <tr key={`user-${user.id}`}>
                                                <td>
                                                    <div style={{ fontWeight: '600', color: '#5576d1' }}>@{user.handle}</div>
                                                    {user.display_name && <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{user.display_name}</div>}
                                                </td>
                                                <td><span className="badge badge-platform">{user.platform === 'twitter' ? 'X' : user.platform}</span></td>
                                                <td>{user.analyzed_count} / {user.post_count}</td>
                                                <td style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                                                    {user.last_seen ? new Date(user.last_seen).toLocaleDateString() : '—'}
                                                </td>
                                                <td style={{ textAlign: 'right', display: 'flex', gap: '8px', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                    {investigationStatus[user.id] ? (
                                                        <span style={{ 
                                                            fontSize: '0.8rem', 
                                                            fontWeight: '600', 
                                                            color: investigationStatus[user.id] === 'In progress' ? '#3b82f6' : '#f59e0b',
                                                            backgroundColor: investigationStatus[user.id] === 'In progress' ? '#eff6ff' : '#fef3c7',
                                                            padding: '2px 8px',
                                                            borderRadius: '4px'
                                                        }}>
                                                            {investigationStatus[user.id]}
                                                        </span>
                                                    ) : (
                                                        <button 
                                                            className="btn btn-secondary" 
                                                            style={{ 
                                                                padding: '4px 12px', 
                                                                fontSize: '0.85rem',
                                                                borderColor: '#0492C2',
                                                                color: '#0492C2'
                                                            }} 
                                                            onClick={() => handleInvestigate('investigate_user', user.handle, user.platform, user.id)}
                                                            disabled={!user.handle}
                                                        >
                                                            Investigate
                                                        </button>
                                                    )}
                                                    <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '0.85rem' }} onClick={() => {
                                                        handleCreateCase(user.id, user.handle, user.platform);
                                                        showToast(`Case opened for @${user.handle}`, 'success');
                                                    }}>
                                                        Open Case
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB CONTENT: TRENDS */}
            {activeTab === 'trends' && (
                <div>
                    <div className="card" style={{ padding: '16px 20px', marginBottom: '24px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: '500' }}>Time Period:</label>
                            <select value={trendPeriod} onChange={(e) => setTrendPeriod(e.target.value)} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}>
                                {periods.map(p => <option key={p} value={p}>{p === '7d' ? 'Last 7 Days' : p === '14d' ? 'Last 14 Days' : 'Last 30 Days'}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontWeight: '500' }}>Platform:</label>
                            <select value={trendPlatform} onChange={(e) => setTrendPlatform(e.target.value)} style={{ padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '6px', backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}>
                                {platforms.map(p => <option key={p} value={p}>{p === 'X' ? 'X (Twitter)' : p}</option>)}
                            </select>
                        </div>
                    </div>
                    
                    {/* X Explore Scan Section */}
                    <div className="card" style={{ padding: '20px', marginBottom: '24px', border: '1px solid #e0e7ff', backgroundColor: '#fcfdff' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '4px', height: '20px', backgroundColor: '#5576d1', borderRadius: '2px' }}></div>
                                <h4 style={{ margin: 0, color: '#241571', fontSize: '1.1rem' }}>X Explore Narrative Scan</h4>
                            </div>
                            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>Investigate trending surfaces</span>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '20px', flexWrap: 'wrap' }}>
                            <div style={{ width: '200px' }}>
                                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4b5563', marginBottom: '8px', fontWeight: '500' }}>Explore Tab</label>
                                <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: '6px', overflow: 'hidden' }}>
                                    <button 
                                        type="button"
                                        onClick={() => setExploreTab('trending')}
                                        style={{ 
                                            flex: 1, padding: '8px 12px', border: 'none', fontSize: '0.9rem', cursor: 'pointer',
                                            backgroundColor: exploreTab === 'trending' ? '#5576d1' : 'white',
                                            color: exploreTab === 'trending' ? 'white' : '#4b5563',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        Trending
                                    </button>
                                    <button 
                                        type="button"
                                        onClick={() => setExploreTab('news')}
                                        style={{ 
                                            flex: 1, padding: '8px 12px', border: 'none', fontSize: '0.9rem', cursor: 'pointer',
                                            backgroundColor: exploreTab === 'news' ? '#5576d1' : 'white',
                                            color: exploreTab === 'news' ? 'white' : '#4b5563',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        News
                                    </button>
                                </div>
                            </div>
                            
                            <div style={{ flex: 1, minWidth: '200px' }}>
                                <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 8px 0' }}>
                                    Scan and collect the top <strong>{exploreTab === 'trending' ? 'Trending tags' : 'News labels'}</strong> from X Explore to detect and alert on emerging narratives.
                                </p>
                            </div>
                            
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button 
                                    className="btn btn-primary" 
                                    style={{ 
                                        padding: '8px 24px', height: '40px', display: 'flex', alignItems: 'center', gap: '8px',
                                        boxShadow: '0 4px 6px -1px rgba(85, 118, 209, 0.2)' 
                                    }}
                                    onClick={() => handleInvestigate(`explore_${exploreTab}`, exploreTab, 'twitter')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                    Start Scan
                                </button>
                                <Link 
                                    to="/alerts" 
                                    className="btn btn-secondary" 
                                    style={{ 
                                        padding: '8px 20px', height: '40px', display: 'flex', alignItems: 'center', gap: '8px',
                                        textDecoration: 'none', border: '1px solid #d1d5db', color: '#4b5563'
                                    }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                                    View Alerts
                                </Link>
                            </div>
                        </div>
                    </div>

                    {loading || !trendData ? (
                        <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>Loading trends...</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' }}>
                            {/* Topics Summary */}
                            <div className="card">
                                <div className="card-header"><h3 className="card-title" style={{ color: 'var(--navy)' }}>Topic Distribution</h3></div>
                                <div style={{ padding: '0 20px 20px 20px' }}>
                                    {trendData.topic_counts.length === 0 ? (
                                        <div style={{ color: 'var(--text-muted)' }}>No topic data available.</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {trendData.topic_counts.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: ['#F59E0B', '#241571', '#48AAAD', '#0492C2'][idx % 4] }}></div>
                                                        <span style={{ fontWeight: '500', color: 'var(--text)' }}>{item.topic}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '16px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                                        <span>{item.count} items</span>
                                                        <span style={{ fontWeight: '600', color: 'var(--navy)', width: '45px', textAlign: 'right' }}>{(item.pct * 100).toFixed(1)}%</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Keywords Summary */}
                            <div className="card">
                                <div className="card-header"><h3 className="card-title" style={{ color: 'var(--accent)' }}>Top Keywords</h3></div>
                                <div style={{ padding: '0 20px 20px 20px' }}>
                                    {trendData.top_keywords.length === 0 ? (
                                        <div style={{ color: 'var(--text-muted)' }}>No keywords detected.</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                            {trendData.top_keywords.map((item, idx) => (
                                                <div key={item.keyword} style={{
                                                    padding: '6px 12px',
                                                    backgroundColor: 'var(--hover)',
                                                    borderRadius: '16px',
                                                    fontSize: '0.9rem',
                                                    display: 'flex',
                                                    gap: '6px',
                                                    alignItems: 'center',
                                                    border: '1px solid var(--border)'
                                                }}>
                                                    <span style={{ color: 'var(--text)', fontWeight: '500' }}>#{item.keyword}</span>
                                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{item.count}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Platform Summary */}
                            <div className="card">
                                <div className="card-header"><h3 className="card-title">Platform Activity</h3></div>
                                <div style={{ padding: '0 20px 20px 20px' }}>
                                    {trendData.platform_counts.length === 0 ? (
                                        <div style={{ color: 'var(--text-muted)' }}>No platform data available.</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {trendData.platform_counts.map((item, idx) => (
                                                <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <span className="badge badge-platform">{item.platform === 'twitter' ? 'X' : item.platform}</span>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <span style={{ fontWeight: '600', color: 'var(--text)' }}>{item.count}</span>
                                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>posts</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
