import React, { useState, useEffect, useMemo } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { apiClient, fetchAlerts } from './api/client';
import { getActiveCaseId, setActiveCase } from './api/caseStore';
import ActorsPage from './pages/ActorsPage';
import CoordinationPage from './pages/CoordinationPage';
import AlertsPage from './pages/AlertsPage';
import ActorDetailPage from './pages/ActorDetailPage';
import DriftDetailPage from './pages/DriftDetailPage';
import OverviewPage from './pages/OverviewPage';
import SettingsPage from './pages/SettingsPage';
import CasesPage from './pages/CasesPage';
import CaseDetailPage from './pages/CaseDetailPage';
import SearchPage from './pages/SearchPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LandingPage from './pages/LandingPage';
import TrendingPage from './pages/TrendingPage';
import Breadcrumbs from './components/Breadcrumbs';
import { getAvatarSrc } from './components/avatarPresets';
import mascotImg from './assets/mascot.png';
import './styles/theme.css';

// Icons
const IconOverview = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"></rect>
    <rect x="14" y="3" width="7" height="7"></rect>
    <rect x="14" y="14" width="7" height="7"></rect>
    <rect x="3" y="14" width="7" height="7"></rect>
  </svg>
);

const IconWorkspace = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5L12 3l9 7.5"></path>
    <path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"></path>
    <path d="M9.5 21V15a2.5 2.5 0 0 1 5 0v6"></path>
  </svg>
);

const IconActors = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
  </svg>
);

const IconCases = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
  </svg>
);

const IconSearch = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const IconCoordination = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"></circle>
    <circle cx="6" cy="12" r="3"></circle>
    <circle cx="18" cy="19" r="3"></circle>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
  </svg>
);

const IconAlerts = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
  </svg>
);

const IconSettings = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
);

const IconTrending = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"></polyline>
    <polyline points="16 7 22 7 22 13"></polyline>
  </svg>
);

const renderAvatar = (analyst) => {
  const src = getAvatarSrc(analyst?.avatar_key) || getAvatarSrc('ink-01');
  return (
    <div className="avatar-circle">
      <img className="avatar-img" src={src} alt="" />
    </div>
  );
};

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [authToken, setAuthToken] = useState(() => {
    try {
      return localStorage.getItem('sync_auth_token');
    } catch (e) {
      return null;
    }
  });

  const [currentAnalyst, setCurrentAnalyst] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alertsCount, setAlertsCount] = useState(0);
  const [casesRefresh, setCasesRefresh] = useState(0);
  const [activeCaseId, setActiveCaseId] = useState(() => getActiveCaseId());

  const triggerCasesRefresh = () => {
    setCasesRefresh((prev) => prev + 1);
  };

  // Load theme on mount
  useEffect(() => {
    const storedTheme = localStorage.getItem('sync_theme');
    if (storedTheme === 'dark') {
      document.body.classList.add('theme-dark');
    } else {
      document.body.classList.remove('theme-dark');
    }
  }, []);

  // Auth check
  useEffect(() => {
    const run = async () => {
      if (!authToken) {
        setCurrentAnalyst(null);
        setAuthChecked(true);
        return;
      }

      setAuthChecked(false);
      const res = await apiClient.getMe(authToken);
      if (res && res.status === 'ok' && res.analyst) {
        setCurrentAnalyst(res.analyst);
        setAuthChecked(true);
        return;
      }

      try {
        localStorage.removeItem('sync_auth_token');
      } catch (e) { }
      setAuthToken(null);
      setCurrentAnalyst(null);
      setAuthChecked(true);
    };

    run();
  }, [authToken]);

  const handleLoginSuccess = (token, analyst) => {
    try {
      localStorage.setItem('sync_auth_token', token);
    } catch (e) { }
    setAuthToken(token);
    setCurrentAnalyst(analyst);
    setAuthChecked(true);
    navigate('/workspace');
  };

  const handleSessionUpdate = (token, analyst) => {
    try {
      localStorage.setItem('sync_auth_token', token);
    } catch (e) { }
    setAuthToken(token);
    setCurrentAnalyst(analyst);
    setAuthChecked(true);
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('sync_auth_token');
    } catch (e) { }
    setAuthToken(null);
    setCurrentAnalyst(null);
    navigate('/login');
  };

  const loadAlertsCount = async () => {
    try {
      const data = await fetchAlerts(200);
      const alertsList = Array.isArray(data) ? data : (data.items || []);
      const unread = alertsList.filter(a => a.is_read === false).length;
      setAlertsCount(unread);
    } catch (err) {
      console.error('Failed to fetch alerts count', err);
    }
  };

  useEffect(() => {
    if (authToken && currentAnalyst) {
      loadAlertsCount();
    }
  }, [authToken, currentAnalyst, location.pathname]);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleOpenCase = (input) => {
    const id = typeof input === 'object' ? input?.id : input;
    
    // Explicit guards against /cases/null and /cases/undefined
    const isInvalid = !id || 
                      String(id) === 'null' || 
                      String(id) === 'undefined' || 
                      String(id).startsWith('case_') ||
                      String(id) === '';
                      
    if (isInvalid) {
      console.warn('Cannot open case: Invalid ID', input);
      return;
    }

    navigate(`/cases/${id}`, { state: { caseObj: typeof input === 'object' ? input : null } });
    setSidebarOpen(false);
  };

  const goToCasesWithCase = (input) => {
    const id = typeof input === 'object' ? input?.id : input;

    // Explicit guards
    const isInvalid = !id || 
                      String(id) === 'null' || 
                      String(id) === 'undefined' || 
                      String(id).startsWith('case_') ||
                      String(id) === '';

    if (isInvalid) {
      console.warn('Cannot highlight/open case without real backend id', input);
      navigate('/cases');
      setSidebarOpen(false);
      return;
    }

    const idStr = String(id);
    setActiveCaseId(idStr);
    setActiveCase(idStr);
    navigate('/cases');
    setSidebarOpen(false);
  };

  // Breadcrumbs derivation
  const breadcrumbs = useMemo(() => {
    const crumbs = [{ label: 'Workspace', onClick: () => navigate('/workspace') }];
    const path = location.pathname;

    if (path === '/workspace') {
      crumbs.push({ label: 'Home' });
    } else if (path === '/overview') {
      crumbs.push({ label: 'Overview' });
    } else if (path === '/actors') {
      crumbs.push({ label: 'Actors' });
    } else if (path.startsWith('/actors/')) {
      // Check if we came from alerts via location state or previous knowledge
      // For now, simpler: link back to Actors
      crumbs.push({ label: 'Actors', onClick: () => navigate('/actors') });
      crumbs.push({ label: 'Actor Detail' });
    } else if (path === '/search') {
      crumbs.push({ label: 'Search' });
    } else if (path === '/coordination') {
      crumbs.push({ label: 'Coordination' });
    } else if (path === '/alerts') {
      crumbs.push({ label: 'Alerts' });
    } else if (path === '/trending') {
      crumbs.push({ label: 'Trending' });
    } else if (path === '/cases') {
      crumbs.push({ label: 'Cases' });
    } else if (path.startsWith('/cases/')) {
      crumbs.push({ label: 'Cases', onClick: () => navigate('/cases') });
      crumbs.push({ label: 'Case Detail' });
    } else if (path === '/settings') {
      crumbs.push({ label: 'Settings' });
    }

    return crumbs;
  }, [location.pathname, navigate]);

  if (!authChecked) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--text)' }}>
        <div className="card" style={{ padding: '18px 20px' }}>Checking session…</div>
      </div>
    );
  }

  // Auth Guard Component
  const ProtectedRoute = ({ children }) => {
    if (!authToken || !currentAnalyst) {
      return <Navigate to="/login" replace />;
    }
    return children;
  };

  // Public Route Guard (Login/Register)
  const PublicRoute = ({ children }) => {
    if (authToken && currentAnalyst) {
      return <Navigate to="/workspace" replace />;
    }
    return children;
  };

  return (
    <Routes>
      <Route path="/login" element={
        <PublicRoute>
          <LoginPage onLoginSuccess={handleLoginSuccess} onNavigate={(v) => navigate(`/${v}`)} />
        </PublicRoute>
      } />
      <Route path="/register" element={
        <PublicRoute>
          <RegisterPage onNavigate={(v) => navigate(`/${v}`)} onRegisterSuccess={handleLoginSuccess} />
        </PublicRoute>
      } />

      <Route path="*" element={
        <ProtectedRoute>
          <div className="app-layout">
            <header className="mobile-header">
              <button className="hamburger-btn" onClick={toggleSidebar}>
                <span style={{ fontSize: '24px' }}>☰</span>
              </button>
              <h1 style={{ color: '#5576d1', margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Synchronyze AI</h1>
            </header>

            <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
              <div className="sidebar-brand">
                <div className="brand-block">
                  <div className="brand-mark-wrap">
                    <img className="brand-mark" src={mascotImg} alt="Mascot" />
                  </div>
                  <div className="brand-text">
                    <div className="brand-wordmark" aria-label="Synchronyze.ai">
                      <span className="brand-name">Synchronyze</span>
                      <span className="brand-ai">.ai</span>
                    </div>
                  </div>
                </div>
              </div>

              <nav className="sidebar-nav">
                <Link to="/workspace" className={`nav-item ${location.pathname === '/workspace' ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconWorkspace /></span> Workspace
                </Link>
                <Link to="/overview" className={`nav-item ${location.pathname === '/overview' ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconOverview /></span> Overview
                </Link>
                <Link to="/actors" className={`nav-item ${location.pathname.startsWith('/actors') ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconActors /></span> Actors
                </Link>
                <Link to="/cases" className={`nav-item ${location.pathname.startsWith('/cases') ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconCases /></span> Cases
                </Link>
                <Link to="/search" className={`nav-item ${location.pathname === '/search' ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconSearch /></span> Search
                </Link>
                <Link to="/coordination" className={`nav-item ${location.pathname === '/coordination' ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconCoordination /></span> Coordination
                </Link>
                <Link to="/alerts" className={`nav-item ${location.pathname === '/alerts' ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconAlerts /></span> Alerts
                  {alertsCount > 0 && <span className="nav-badge">{alertsCount}</span>}
                </Link>
                <Link to="/trending" className={`nav-item ${location.pathname === '/trending' ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconTrending /></span> Trending
                </Link>
                <Link to="/settings" className={`nav-item ${location.pathname === '/settings' ? 'active' : ''}`} onClick={() => setSidebarOpen(false)}>
                  <span className="nav-icon"><IconSettings /></span> Settings
                </Link>
              </nav>

              <div className="sidebar-footer">
                <button className="sidebar-profile" onClick={() => navigate('/settings')} type="button">
                  <div className="sidebar-avatar">{renderAvatar(currentAnalyst)}</div>
                  <div className="sidebar-profile-meta">
                    <div className="sidebar-profile-name">{currentAnalyst?.full_name || 'Analyst'}</div>
                    <div className="sidebar-profile-username">@{currentAnalyst?.username || 'username'}</div>
                  </div>
                </button>
              </div>
            </aside>

            <div className={`mobile-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

            <main className="main-content">
              <Breadcrumbs items={breadcrumbs} />
              
              <Routes>
                <Route path="/workspace" element={<LandingPage analyst={currentAnalyst} onLogout={handleLogout} />} />
                <Route path="/overview" element={<OverviewPage onNavigate={(v) => navigate(`/${v}`)} />} />
                <Route path="/actors" element={<ActorsPage onSelectActor={(actor) => navigate(`/actors/${actor.id}${location.search}`)} />} />
                <Route path="/actors/:actorId" element={<ActorDetailPage onGoToCases={goToCasesWithCase} authToken={authToken} />} />
                <Route path="/drift/:actorId" element={<DriftDetailPage onBack={() => navigate(-1)} />} />
                <Route path="/search" element={<SearchPage onOpenCase={handleOpenCase} onGoToCases={goToCasesWithCase} currentAnalyst={currentAnalyst} authToken={authToken} />} />
                <Route path="/cases" element={
                  <CasesPage 
                    onOpenCase={handleOpenCase} 
                    casesRefresh={casesRefresh} 
                    highlightedCaseId={activeCaseId}
                    onHighlightCase={(id) => { id && setActiveCaseId(String(id)); id && setActiveCase(String(id)); }}
                    authToken={authToken}
                  />
                } />
                <Route path="/cases/:caseId" element={<CaseDetailPage triggerCasesRefresh={triggerCasesRefresh} authToken={authToken} />} />
                <Route path="/coordination" element={<CoordinationPage />} />
                <Route path="/alerts" element={
                  <AlertsPage 
                    onOpenGroup={(id) => navigate('/coordination', { state: { highlightedGroupId: id } })}
                    onOpenActor={(actor) => navigate(`/actors/${actor.id}`)}
                    onRefreshAlertsCount={loadAlertsCount}
                  />
                } />
                <Route path="/trending" element={<TrendingPage />} />
                <Route path="/settings" element={
                  <SettingsPage analyst={currentAnalyst} authToken={authToken} onSessionUpdate={handleSessionUpdate} onLogout={handleLogout} />
                } />
                <Route path="/" element={<Navigate to="/workspace" replace />} />
              </Routes>
            </main>
          </div>
        </ProtectedRoute>
      } />
    </Routes>
  );
}

export default App;
