import React, { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { apiClient } from '../api/client';

export default function OverviewPage({ onNavigate }) {
  const [stats, setStats] = useState({
    totalActors: 0,
    activeAlerts: 0,
    coordinatedGroups: 0,
    totalPosts: 0,
    postsToday: 0,
    driftEventsWeek: 0
  });

  const [recentActivity, setRecentActivity] = useState({
    alerts: [],
    posts: []
  });

  const [chartData, setChartData] = useState([]);
  const [sparklineData, setSparklineData] = useState({
    alerts: [],
    groups: [],
    alertsAvailable: true,
    groupsAvailable: true
  });
  const [trends, setTrends] = useState({
    alerts: { value: 0, label: '—' },
    groups: { value: 0, label: '—' }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        setError(null);
        // 1. Fetch main data sources
        const [actors, alerts, coordination] = await Promise.all([
          apiClient.getActors(1000),
          apiClient.getAlerts(200),
          apiClient.getCoordination(200)
        ]);

        if (actors.status === 'error' || alerts.status === 'error' || coordination.status === 'error') {
            const errorMsg = actors.message || alerts.message || coordination.message || 'Failed to fetch data';
            console.error("API Error:", errorMsg);
            setError(errorMsg);
        }

        // 2. Compute Quick Stats
        const actorsList = Array.isArray(actors) ? actors : (actors.items || []);
        const alertsList = Array.isArray(alerts) ? alerts : (alerts.items || []);
        const coordinationList = Array.isArray(coordination) ? coordination : (coordination.items || []);

        const totalActors = Array.isArray(actors) ? actors.length : (actors.count || actorsList.length || 0);
        const activeAlerts = alertsList.length;
        const coordinatedGroups = coordinationList.length;
        
        let totalPosts = 0;
        let postsToday = 0;
        
        actorsList.forEach(actor => {
          totalPosts += (actor.post_count || 0);
          postsToday += (actor.analyzed_count || 0);
        });

        // Drift events this week
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        
        const driftEventsWeek = alertsList.filter(a => {
          if (a.type !== 'drift' && a.alert_type !== 'drift') return false; // Handle both potential field names
          const created = new Date(a.created_at);
          return created >= oneWeekAgo;
        }).length;

        setStats({
          totalActors,
          activeAlerts,
          coordinatedGroups,
          totalPosts,
          postsToday,
          driftEventsWeek
        });

        // 3. Recent Activity
        // Last 3 alerts
        const sortedAlerts = [...alertsList].sort((a, b) => 
          new Date(b.created_at) - new Date(a.created_at)
        ).slice(0, 3);

        // Last 5 posts (Option A: Fetch timeline for first 5 actors)
        let recentPosts = [];
        let allFetchedPosts = [];
        const topActors = actorsList.slice(0, 5);
        
        if (topActors.length > 0) {
          const postsPromises = topActors.map(actor => 
            apiClient.getActorTimeline(actor.id, 5)
              .then(res => {
                const items = res.items || [];
                return items.map(p => {
                  const actorName = actor.handle || actor.username || actor.id;
                  const content =
                    p.raw_text ||
                    p.content ||
                    p.text ||
                    (p.raw_payload && (p.raw_payload.text || p.raw_payload.content)) ||
                    '';
                  return { ...p, actor_name: actorName, content };
                });
              })
              .catch(() => [])
          );
          
          const results = await Promise.all(postsPromises);
          allFetchedPosts = results.flat();
          
          // Flatten, sort by date desc, take top 5
          recentPosts = [...allFetchedPosts]
            .sort((a, b) => new Date(b.created_at || b.published_at) - new Date(a.created_at || a.published_at))
            .slice(0, 5);
        }

        setRecentActivity({
          alerts: sortedAlerts,
          posts: recentPosts
        });

        // 4. Mini Chart Data (7 days)
        const days = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          days.push(d.toISOString().split('T')[0]); // YYYY-MM-DD
        }

        const postsPerDay = days.map(day => {
          const count = allFetchedPosts.filter(p => {
            const pDate = (p.created_at || p.published_at || '').split('T')[0];
            return pDate === day;
          }).length;
          return { day: day.substring(5), count }; // MM-DD
        });
        
        setChartData(postsPerDay);

        // 5. Sparkline Data (7 days)
        const computeTrend = (items) => {
          if (items.length > 0) {
            const hasDate = items.some(i => i.created_at || i.timestamp || i.date || i.published_at);
            if (!hasDate) return { data: [], available: false };
          }
          
          const data = days.map(day => {
            const count = items.filter(item => {
              const dateStr = item.created_at || item.timestamp || item.date || item.published_at || '';
              return dateStr.startsWith(day);
            }).length;
            return { day, count };
          });
          
          return { data, available: true };
        };

        const alertsTrend = computeTrend(alertsList);
        const groupsTrend = computeTrend(coordinationList);

        setSparklineData({
          alerts: alertsTrend.data,
          groups: groupsTrend.data,
          alertsAvailable: alertsTrend.available,
          groupsAvailable: groupsTrend.available
        });

        // 6. Trend Calculation (Current vs Previous 7 days)
        const calculateDiff = (items) => {
          if (!items.length) return { value: 0, label: '—' };
          
          const currentCount = items.filter(i => {
            const d = new Date(i.created_at || i.timestamp || i.date || i.published_at);
            return d >= oneWeekAgo && d <= now;
          }).length;

          const prevCount = items.filter(i => {
            const d = new Date(i.created_at || i.timestamp || i.date || i.published_at);
            return d >= twoWeeksAgo && d < oneWeekAgo;
          }).length;
          
          const diff = currentCount - prevCount;
          // If no change, show "0" instead of "—" to avoid confusion about missing data
          const label = diff > 0 ? `↑ ${diff}` : diff < 0 ? `↓ ${Math.abs(diff)}` : '0';
          return { value: diff, label };
        };

        setTrends({
          alerts: calculateDiff(alertsList),
          groups: calculateDiff(coordinationList)
        });

      } catch (err) {
        console.error("Failed to load overview data", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  if (error) {
    return (
        <div className="error-container" style={{ padding: '20px', color: 'var(--error)', background: 'var(--bg-secondary)', borderRadius: '8px', margin: '20px' }}>
            <h3>Dashboard Error</h3>
            <p>Failed to load data from backend: {error}</p>
            <p>Please ensure the backend server is running on port 8001.</p>
            <button 
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                background: 'var(--primary)',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                marginTop: '10px'
              }}
            >
              Retry
            </button>
        </div>
    );
  }

  // Helper for max value in chart scaling
  const maxChartVal = Math.max(...chartData.map(d => d.count), 5); // min scale 5

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Overview</h2>
        <p className="page-subtitle">Command Center & System Health</p>
      </div>

      {/* Summary Cards */}
      <div className="stats-grid">
        <div 
          className="stat-card" 
          onClick={() => onNavigate && onNavigate('actors')} 
          style={{ cursor: 'pointer', borderLeft: '4px solid var(--primary)' }}
        >
          <div className="stat-icon" style={{ backgroundColor: 'var(--info-bg)', color: 'var(--primary)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </div>
          <div className="stat-content">
            <div className="stat-value" style={{ color: 'var(--text)' }}>{stats.totalActors}</div>
            <div className="stat-label">Total Actors</div>
          </div>
        </div>

        <div 
          className="stat-card"
          onClick={() => onNavigate && onNavigate('actors')}
          style={{ cursor: 'pointer', borderLeft: '4px solid var(--accent)' }}
        >
          <div className="stat-icon" style={{ backgroundColor: 'var(--info-bg)', color: 'var(--accent)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
          </div>
          <div className="stat-content">
            <div className="stat-value" style={{ color: 'var(--text)' }}>{stats.totalPosts}</div>
            <div className="stat-label">Total Posts</div>
          </div>
        </div>

        <div 
          className="stat-card"
          onClick={() => onNavigate && onNavigate('alerts')}
          style={{ cursor: 'pointer', borderLeft: '4px solid var(--navy)', display: 'block', paddingBottom: '12px' }}
        >
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div className="stat-icon" style={{ backgroundColor: 'var(--info-bg)', color: 'var(--navy)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </div>
            <div>
              <div className="stat-value" style={{ color: 'var(--text)' }}>{stats.activeAlerts}</div>
              <div className="stat-label">Active Alerts</div>
              <div className="stat-trend" style={{ color: trends.alerts.value !== 0 ? 'var(--navy)' : 'var(--text-light)' }}>
                {trends.alerts.label} <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 'normal' }}>vs last 7d</span>
              </div>
            </div>
          </div>
          <div style={{ height: '40px', marginTop: '12px' }}>
            {sparklineData.alertsAvailable ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparklineData.alerts}>
                  <Line type="monotone" dataKey="count" stroke="var(--navy)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', height: '100%', color: 'var(--text-light)', fontSize: '0.75rem' }}>
                <div style={{ height: '2px', background: 'var(--border)', flex: 1, marginRight: '8px' }}></div>
                Trend unavailable
              </div>
            )}
          </div>
        </div>

        <div 
          className="stat-card"
          onClick={() => onNavigate && onNavigate('coordination')}
          style={{ cursor: 'pointer', borderLeft: '4px solid var(--accent)', display: 'block', paddingBottom: '12px' }}
        >
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div className="stat-icon" style={{ backgroundColor: 'var(--info-bg)', color: 'var(--accent)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
              </svg>
            </div>
            <div>
              <div className="stat-value" style={{ color: 'var(--text)' }}>{stats.coordinatedGroups}</div>
              <div className="stat-label">Coordinated Groups</div>
              <div className="stat-trend" style={{ color: trends.groups.value !== 0 ? 'var(--accent)' : 'var(--text-light)' }}>
                {trends.groups.label} <span style={{ fontSize: '0.75rem', color: 'var(--text-light)', fontWeight: 'normal' }}>vs last 7d</span>
              </div>
            </div>
          </div>
          <div style={{ height: '40px', marginTop: '12px' }}>
            {sparklineData.groupsAvailable ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparklineData.groups}>
                  <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', height: '100%', color: 'var(--text-light)', fontSize: '0.75rem' }}>
                <div style={{ height: '2px', background: 'var(--border)', flex: 1, marginRight: '8px' }}></div>
                Trend unavailable
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="overview-grid">
        {/* Left Column: Recent Activity */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Activity</h3>
            <span className="controls-count">Live Feed</span>
          </div>
          
          {/* Alerts Section */}
          <div style={{ marginBottom: '24px' }}>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 0 }}>Latest Alerts</h4>
            {recentActivity.alerts.length === 0 ? (
              <p className="text-muted" style={{ fontSize: '0.9rem' }}>No recent alerts</p>
            ) : (
              recentActivity.alerts.map((alert, idx) => (
                <div 
                  key={`alert-${idx}`} 
                  className="activity-item"
                  onClick={() => onNavigate && onNavigate('alerts')}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="activity-icon" style={{ color: 'var(--error-text)', backgroundColor: 'var(--error-bg)' }}>
                    !
                  </div>
                  <div className="activity-content">
                    <div className="activity-title">{alert.title || alert.message || 'System Alert'}</div>
                    <div className="activity-meta">
                      {alert.type || alert.alert_type} • {new Date(alert.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Posts Section */}
          <div>
            <h4 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recently Captured Posts</h4>
            {recentActivity.posts.length === 0 ? (
              <p className="text-muted" style={{ fontSize: '0.9rem' }}>Recent posts not available yet</p>
            ) : (
              recentActivity.posts.map((post, idx) => (
                <div key={`post-${idx}`} className="activity-item">
                  <div className="activity-icon" style={{ color: 'var(--primary)', backgroundColor: 'var(--info-bg)' }}>
                    #
                  </div>
                  <div className="activity-content">
                    <div className="activity-title">
                      {post.content ? (post.content.substring(0, 50) + (post.content.length > 50 ? '...' : '')) : 'No content'}
                    </div>
                    <div className="activity-meta">
                      @{post.actor_name} • {new Date(post.created_at || post.published_at || post.captured_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Mini Chart */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Posts Captured</h3>
            <span className="controls-count">Last 7 Days</span>
          </div>
          
          <div className="chart-container">
            {chartData.map((d, i) => {
              const heightPct = maxChartVal > 0 ? (d.count / maxChartVal) * 100 : 0;
              // Ensure at least a tiny bar is visible if 0 for layout
              const barHeight = Math.max(heightPct, 4); 
              
              return (
                <div key={i} className="chart-bar-group">
                  <div 
                    className="chart-bar" 
                    style={{ 
                      height: `${barHeight}%`,
                      backgroundColor: d.count > 0 ? 'var(--primary)' : 'var(--border)'
                    }}
                  >
                    {d.count > 0 && <div className="chart-bar-value">{d.count}</div>}
                  </div>
                  <div className="chart-label">{d.day}</div>
                </div>
              );
            })}
          </div>
          <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Total analyzed today: <strong>{stats.postsToday}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
