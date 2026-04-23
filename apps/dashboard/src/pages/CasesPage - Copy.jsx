import React, { useState, useEffect, useMemo } from 'react';
import { fetchCases, updateCaseStatus } from '../api/client';
import DataTable from '../components/DataTable';

export default function CasesPage({ onOpenCase, casesRefresh }) {
    const [casesItems, setCasesItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [platformFilter, setPlatformFilter] = useState('All');
    const [activeFilter, setActiveFilter] = useState('All');

    // UI States
    const [isNewCaseModalOpen, setIsNewCaseModalOpen] = useState(false);
    const [message, setMessage] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, caseId: null, newStatus: null, handle: null });
    const [isUpdating, setIsUpdating] = useState(false);

    const loadCases = async () => {
        setLoading(true);
        setError(null);
        const result = await fetchCases();
        if (result.status === 'error') {
            setError(result.message);
            setCasesItems([]);
        } else {
            setCasesItems(result.items || []);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadCases();
    }, [casesRefresh]);

    const showToast = (text, type = 'success') => {
        setMessage({ text, type });
        setTimeout(() => setMessage(null), 3000);
    };

    const requestStatusChange = (e, id, handle, newStatus) => {
        e.stopPropagation();
        setConfirmDialog({ isOpen: true, caseId: id, handle, newStatus });
    };

    const confirmStatusChange = async () => {
        const { caseId, newStatus } = confirmDialog;
        setConfirmDialog({ isOpen: false, caseId: null, newStatus: null, handle: null });

        setIsUpdating(true);
        const res = await updateCaseStatus(caseId, newStatus);

        if (res.status === 'ok') {
            showToast(`Case successfully marked as ${newStatus}`, 'success');
            loadCases();
        } else {
            showToast(`Failed to update status: ${res.message || 'Unknown error'}`, 'error');
        }
        setIsUpdating(false);
    };

    const cancelStatusChange = () => {
        setConfirmDialog({ isOpen: false, caseId: null, newStatus: null, handle: null });
    };

    // Filter Logic
    const filteredCases = useMemo(() => {
        return casesItems.filter(c => {
            const matchesSearch = c.handle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                c.display_name?.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesPlatform = platformFilter === 'All' || c.platform?.toLowerCase() === platformFilter.toLowerCase() || (!c.platform && platformFilter === 'X');
            return matchesSearch && matchesPlatform;
        });
    }, [casesItems, searchTerm, platformFilter]);

    const activeCases = filteredCases.filter(c => {
        if (c.status === 'closed') return false;
        if (activeFilter === 'Active') return c.status !== 'paused'; // strict active
        if (activeFilter === 'Paused') return c.status === 'paused';
        return true; // All Active (active + paused)
    });

    const closedCases = filteredCases.filter(c => c.status === 'closed');

    const getStatusBadge = (status) => {
        if (status === 'active') return <span className="badge badge-primary">Active</span>;
        if (status === 'paused') return <span className="badge badge-warning">Paused</span>;
        if (status === 'closed') return <span className="badge badge-gray">Closed</span>;
        return <span className="badge badge-gray">{status}</span>;
    };

    const baseColumns = [
        {
            key: 'handle',
            label: 'Handle',
            sortable: true,
            render: (row) => (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: '600', color: 'var(--primary, #5576d1)' }}>
                        {row.handle}
                    </span>
                    {row.display_name && <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{row.display_name}</span>}
                </div>
            )
        },
        {
            key: 'platform',
            label: 'Platform',
            sortable: true,
            render: (row) => (
                <span className="badge badge-platform">
                    {row.platform || 'X'}
                </span>
            )
        }
    ];

    const activeColumns = [
        ...baseColumns,
        {
            key: 'status',
            label: 'Status',
            sortable: true,
            render: (row) => getStatusBadge(row.status)
        },
        {
            key: 'created_at',
            label: 'Created',
            sortable: true,
            render: (row) => <span className="text-secondary">{row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}</span>
        },
        {
            key: 'actions',
            label: 'Actions',
            sortable: false,
            render: (row) => (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={(e) => { e.stopPropagation(); onOpenCase(row); }}>
                        View
                    </button>
                    {row.status !== 'paused' && (
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: '#D97706' }} onClick={(e) => requestStatusChange(e, row.id, row.handle, 'paused')} disabled={isUpdating}>
                            Pause
                        </button>
                    )}
                    {row.status === 'paused' && (
                        <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: '#059669' }} onClick={(e) => requestStatusChange(e, row.id, row.handle, 'active')} disabled={isUpdating}>
                            Resume
                        </button>
                    )}
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: '#DC2626' }} onClick={(e) => requestStatusChange(e, row.id, row.handle, 'closed')} disabled={isUpdating}>
                        Close
                    </button>
                </div>
            )
        }
    ];

    const closedColumns = [
        ...baseColumns,
        {
            key: 'status',
            label: 'Status',
            sortable: true,
            render: (row) => getStatusBadge(row.status)
        },
        {
            key: 'created_at',
            label: 'Created',
            sortable: true,
            render: (row) => <span className="text-secondary">{row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}</span>
        },
        {
            key: 'actions',
            label: 'Actions',
            sortable: false,
            render: (row) => (
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={(e) => { e.stopPropagation(); onOpenCase(row); }}>
                        View
                    </button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={(e) => requestStatusChange(e, row.id, row.handle, 'active')} disabled={isUpdating}>
                        Reopen
                    </button>
                </div>
            )
        }
    ];

    if (loading) return <div className="loading" style={{ padding: '40px', textAlign: 'center' }}>Loading cases data...</div>;
    if (error) return <div className="error" style={{ margin: '20px' }}>Error loading cases: {error}</div>;

    return (
        <div style={{ position: 'relative' }}>

            {/* Confirm Dialog Layer */}
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
                        <h3 style={{ marginTop: 0, marginBottom: '16px', color: 'var(--text-primary, #111827)' }}>Confirm Action</h3>
                        <p style={{ marginBottom: '24px', color: 'var(--text-secondary, #4b5563)', lineHeight: '1.5' }}>
                            Are you sure you want to mark <strong>{confirmDialog.handle}</strong> as <strong>{confirmDialog.newStatus}</strong>?
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button className="btn btn-secondary" onClick={cancelStatusChange} style={{ backgroundColor: 'transparent', color: 'var(--text-secondary, #4b5563)', border: '1px solid var(--border-color, #d1d5db)', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
                            <button className="btn btn-primary" onClick={confirmStatusChange} style={{ backgroundColor: confirmDialog.newStatus === 'closed' ? '#DC2626' : 'var(--primary-color, #3b82f6)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>Confirm</button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Case Modal Layer (Mock) */}
            {isNewCaseModalOpen && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', zIndex: 2000
                }}>
                    <div style={{ backgroundColor: '#fff', padding: '32px', borderRadius: '12px', width: '400px', textAlign: 'center' }}>
                        <h3>Open New Case</h3>
                        <p style={{ color: '#6b7280', marginBottom: '24px' }}>Submit an account handle to begin a new monitored investigation.</p>
                        <input type="text" placeholder="@handle" className="form-control" style={{ width: '100%', marginBottom: '16px', padding: '10px' }} />
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button className="btn btn-secondary" onClick={() => setIsNewCaseModalOpen(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={() => { setIsNewCaseModalOpen(false); showToast('New case created', 'success'); }}>Create Case</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast Notification Layer */}
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
                    {message.type === 'success' ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    )}
                    {message.text}
                </div>
            )}
            <style>{`@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>


            {/* HEADER ROW */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                <div className="page-header" style={{ marginBottom: 0 }}>
                    <h2 className="page-title" style={{ color: '#5576d1', fontSize: '2rem', marginBottom: '8px' }}>Cases</h2>
                    <p className="page-subtitle">Manage monitored investigations</p>
                </div>
                <button
                    className="btn btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '1rem' }}
                    onClick={() => setIsNewCaseModalOpen(true)}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    Open New Case
                </button>
            </div>

            {/* FILTER BAR */}
            <div className="card" style={{ marginBottom: '24px', padding: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: '1 1 250px' }}>
                    <input
                        type="text"
                        placeholder="Search by username or handle..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                    />
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <select
                        value={platformFilter}
                        onChange={(e) => setPlatformFilter(e.target.value)}
                        style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', backgroundColor: '#fff' }}
                    >
                        <option value="All">All Platforms</option>
                        <option value="X">X (Twitter)</option>
                        <option value="Instagram">Instagram</option>
                        <option value="Facebook">Facebook</option>
                        <option value="Reddit">Reddit</option>
                        <option value="TikTok">TikTok</option>
                    </select>

                    <select
                        value={activeFilter}
                        onChange={(e) => setActiveFilter(e.target.value)}
                        style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', backgroundColor: '#fff' }}
                    >
                        <option value="All">All Active</option>
                        <option value="Active">Active Only</option>
                        <option value="Paused">Paused Only</option>
                    </select>
                </div>
            </div>

            {/* ACTIVE CASES SECTION */}
            <div className="card" style={{ marginBottom: '32px' }}>
                <div className="card-header">
                    <h3 className="card-title">Active Cases <span style={{ fontSize: '0.9rem', color: '#6b7280', fontWeight: 'normal' }}>({activeCases.length})</span></h3>
                </div>
                {activeCases.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                        No active cases found. Open a new case to start monitoring.
                    </div>
                ) : (
                    <DataTable
                        columns={activeColumns}
                        rows={activeCases}
                        onRowClick={onOpenCase}
                        defaultSortKey="created_at"
                        defaultSortDir="desc"
                        pageSizeOptions={[10, 25]}
                    />
                )}
            </div>

            {/* CLOSED CASES SECTION */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title">Closed Cases <span style={{ fontSize: '0.9rem', color: '#6b7280', fontWeight: 'normal' }}>({closedCases.length})</span></h3>
                </div>
                {closedCases.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                        No closed cases yet.
                    </div>
                ) : (
                    <DataTable
                        columns={closedColumns}
                        rows={closedCases}
                        onRowClick={onOpenCase}
                        defaultSortKey="created_at"
                        defaultSortDir="desc"
                        pageSizeOptions={[10, 25]}
                    />
                )}
            </div>

        </div>
    );
}
