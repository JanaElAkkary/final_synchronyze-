import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';
import { AVATAR_PRESETS } from '../components/avatarPresets';

export default function SettingsPage({ analyst, authToken, onSessionUpdate, onLogout }) {
  const [theme, setTheme] = useState('light');

  const [settings, setSettings] = useState({
    apiBaseUrl: 'http://localhost:8000',
    driftThreshold: 0.3,
    coordinationThreshold: 0.8,
    timeWindow: '1 week',
    autoAnalyze: false,
    notificationsEnabled: false,
    notificationSeverity: 'All'
  });

  const [saveMessage, setSaveMessage] = useState(null);
  const [profileDraft, setProfileDraft] = useState({
    full_name: '',
    username: '',
    avatar_key: 'ink-01'
  });
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    // Load Theme
    const storedTheme = localStorage.getItem('sync_theme');
    if (storedTheme) {
      setTheme(storedTheme);
    }

    // Load Settings
    try {
      const storedSettingsStr = localStorage.getItem('sync_settings');
      if (storedSettingsStr) {
        const storedSettings = JSON.parse(storedSettingsStr);
        setSettings(prev => ({ ...prev, ...storedSettings }));
      } else {
        // Apply env default if available and no local settings
        const envUrl = import.meta.env && import.meta.env.VITE_API_BASE_URL;
        if (envUrl) {
          setSettings(prev => ({ ...prev, apiBaseUrl: envUrl }));
        }
      }
    } catch (e) {
      console.error("Failed to parse settings", e);
    }
  }, []);

  useEffect(() => {
    if (!analyst || typeof analyst.id !== 'number') return;
    setProfileError(null);
    setProfileDraft({
      full_name: analyst.full_name || '',
      username: analyst.username || '',
      avatar_key: analyst.avatar_key || 'ink-01'
    });
  }, [analyst?.id]);

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    localStorage.setItem('sync_theme', newTheme);
    if (newTheme === 'dark') {
      document.body.classList.add('theme-dark');
    } else {
      document.body.classList.remove('theme-dark');
    }
  };

  const handleSettingChange = (key, value) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    localStorage.setItem('sync_settings', JSON.stringify(updated));

    setSaveMessage('Saved automatically');
    setTimeout(() => setSaveMessage(null), 2000);
  };

  const handleProfileSave = async () => {
    setProfileError(null);
    if (!analyst || typeof analyst.id !== 'number') {
      setProfileError('No active analyst session');
      return;
    }
    if (!authToken) {
      setProfileError('No active session token');
      return;
    }
    const full_name = (profileDraft.full_name || '').toString().trim();
    const username = (profileDraft.username || '').toString().trim();
    const avatar_key = (profileDraft.avatar_key || '').toString().trim() || null;

    if (!full_name) {
      setProfileError('Full name is required');
      return;
    }
    if (!username) {
      setProfileError('Username is required');
      return;
    }

    const res = await apiClient.updateProfile(authToken, { full_name, username, avatar_key });
    if (res && res.status === 'ok' && res.token && res.analyst) {
      if (onSessionUpdate) onSessionUpdate(res.token, res.analyst);
      setSaveMessage('Profile saved');
      setTimeout(() => setSaveMessage(null), 2000);
      return;
    }
    setProfileError(res?.message || 'Failed to save profile');
  };

  return (
    <div style={{ position: 'relative', paddingBottom: '40px' }}>
      <div className="page-header" style={{ marginBottom: '24px' }}>
        <h2 className="page-title" style={{ color: 'var(--primary)', fontSize: '2rem', marginBottom: '8px' }}>Settings</h2>
        <p className="page-subtitle">Configure application preferences</p>
      </div>

      {saveMessage && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', padding: '12px 20px',
          backgroundColor: 'var(--success-bg)', color: 'var(--success-text)', borderRadius: '8px',
          border: '1px solid var(--success-text)', zIndex: 1000,
          animation: 'slideIn 0.3s ease-out forwards', fontWeight: '500'
        }}>
          {saveMessage}
        </div>
      )}

      <div style={{ display: 'grid', gap: '24px', maxWidth: '800px' }}>

        <div className="card" style={{ padding: '24px' }}>
          <div className="card-header" style={{ marginBottom: '18px' }}>
            <h3 className="card-title" style={{ margin: 0, fontSize: '1.25rem' }}>Profile</h3>
            <button className="btn btn-primary" type="button" onClick={handleProfileSave}>
              Save Profile
            </button>
          </div>

          <div style={{ display: 'grid', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: '500', color: 'var(--text)', marginBottom: '8px' }}>Full Name</label>
                <input
                  type="text"
                  value={profileDraft.full_name}
                  onChange={(e) => setProfileDraft((p) => ({ ...p, full_name: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '1rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: '500', color: 'var(--text)', marginBottom: '8px' }}>Username</label>
                <input
                  type="text"
                  value={profileDraft.username}
                  onChange={(e) => setProfileDraft((p) => ({ ...p, username: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '1rem' }}
                />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: '500', color: 'var(--text)', marginBottom: '10px' }}>Avatar</label>
              <div className="avatar-picker">
                {AVATAR_PRESETS.map((a) => {
                  const selected = profileDraft.avatar_key === a.key;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      className={`avatar-option ${selected ? 'selected' : ''}`}
                      onClick={() => setProfileDraft((p) => ({ ...p, avatar_key: a.key }))}
                      title={a.key}
                    >
                      <div className="avatar-circle">
                        <img className="avatar-img" src={a.src} alt="" />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {profileError && (
              <div style={{ padding: '10px 12px', borderRadius: '8px', background: 'rgba(217, 48, 37, 0.08)', color: '#d93025', border: '1px solid rgba(217, 48, 37, 0.25)' }}>
                {profileError}
              </div>
            )}
          </div>
        </div>

        {/* Appearance */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ color: 'var(--primary)', marginTop: 0, marginBottom: '20px', fontSize: '1.25rem' }}>Appearance</h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: '500', color: 'var(--text)' }}>Theme</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Switch between light and dark modes</div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleThemeChange('light')}
                style={{ padding: '6px 16px' }}
              >
                Light
              </button>
              <button
                className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleThemeChange('dark')}
                style={{ padding: '6px 16px' }}
              >
                Dark
              </button>
            </div>
          </div>
        </div>

        {/* API Configuration */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ color: 'var(--primary)', marginTop: 0, marginBottom: '20px', fontSize: '1.25rem' }}>API Configuration</h3>
          <div>
            <label style={{ display: 'block', fontWeight: '500', color: 'var(--text)', marginBottom: '8px' }}>API Base URL</label>
            <input
              type="text"
              value={settings.apiBaseUrl}
              onChange={(e) => handleSettingChange('apiBaseUrl', e.target.value)}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '1rem' }}
            />
            <p style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Requires a valid base URL. Ensure it matches your deployed backend or local instance.
            </p>
          </div>
        </div>

        {/* Analysis Parameters */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ color: 'var(--primary)', marginTop: 0, marginBottom: '20px', fontSize: '1.25rem' }}>Analysis Parameters</h3>

          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontWeight: '500', color: 'var(--text)' }}>Drift Threshold</label>
              <span style={{ fontWeight: '600', color: 'var(--accent)' }}>{(settings.driftThreshold * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.1" max="0.8" step="0.05"
              value={settings.driftThreshold}
              onChange={(e) => handleSettingChange('driftThreshold', parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label style={{ fontWeight: '500', color: 'var(--text)' }}>Coordination Similarity Threshold</label>
              <span style={{ fontWeight: '600', color: 'var(--accent)' }}>{(settings.coordinationThreshold * 100).toFixed(1)}%</span>
            </div>
            <input
              type="range"
              min="0.5" max="1.0" step="0.05"
              value={settings.coordinationThreshold}
              onChange={(e) => handleSettingChange('coordinationThreshold', parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontWeight: '500', color: 'var(--text)', marginBottom: '8px' }}>Time Window Size</label>
            <select
              value={settings.timeWindow}
              onChange={(e) => handleSettingChange('timeWindow', e.target.value)}
              style={{ 
                width: '100%', maxWidth: '300px', padding: '10px 12px', 
                border: '1px solid var(--border)', borderRadius: '6px', fontSize: '1rem',
                backgroundColor: 'var(--input-bg)', color: 'var(--text)'
              }}
            >
              <option value="1 week">1 week</option>
              <option value="2 weeks">2 weeks</option>
              <option value="1 month">1 month</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              type="checkbox"
              id="autoAnalyze"
              checked={settings.autoAnalyze}
              onChange={(e) => handleSettingChange('autoAnalyze', e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }}
            />
            <label htmlFor="autoAnalyze" style={{ fontWeight: '500', color: 'var(--text)', cursor: 'pointer' }}>
              Auto-analyze new posts on capture
            </label>
          </div>
        </div>

        {/* Notifications */}
        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ color: 'var(--primary)', marginTop: 0, marginBottom: '20px', fontSize: '1.25rem' }}>Notifications</h3>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <input
              type="checkbox"
              id="notificationsEnabled"
              checked={settings.notificationsEnabled}
              onChange={(e) => handleSettingChange('notificationsEnabled', e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--primary)' }}
            />
            <label htmlFor="notificationsEnabled" style={{ fontWeight: '500', color: 'var(--text)', cursor: 'pointer' }}>
              Enable browser notifications
            </label>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: '500', color: 'var(--text)', marginBottom: '8px', opacity: settings.notificationsEnabled ? 1 : 0.5 }}>
              Minimum Alert Severity
            </label>
            <select
              value={settings.notificationSeverity}
              onChange={(e) => handleSettingChange('notificationSeverity', e.target.value)}
              disabled={!settings.notificationsEnabled}
              style={{
                width: '100%', maxWidth: '300px', padding: '10px 12px',
                border: '1px solid var(--border)', borderRadius: '6px', fontSize: '1rem',
                opacity: settings.notificationsEnabled ? 1 : 0.5,
                backgroundColor: 'var(--input-bg)', color: 'var(--text)'
              }}
            >
              <option value="All">All Events</option>
              <option value="High">High Severity Only</option>
              <option value="Medium">Medium and High</option>
              <option value="Low">Low, Medium, and High</option>
            </select>
          </div>
        </div>

        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ color: 'var(--primary)', marginTop: 0, marginBottom: '14px', fontSize: '1.25rem' }}>Session</h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px' }}>
            <div>
              <div style={{ fontWeight: '600', color: 'var(--text)' }}>Log out</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Sign out from this device.
              </div>
            </div>
            <button className="btn btn-secondary btn-danger" type="button" onClick={onLogout}>
              Logout
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
