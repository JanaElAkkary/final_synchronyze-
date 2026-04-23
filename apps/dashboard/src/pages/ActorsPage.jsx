import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '../api/client';
import DataTable from '../components/DataTable';

const ACTORS_PAGE_SIZE_KEY = 'sync_actors_page_size';
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

const getStoredPageSize = () => {
  try {
    const value = Number(localStorage.getItem(ACTORS_PAGE_SIZE_KEY));
    return PAGE_SIZE_OPTIONS.includes(value) ? value : 25;
  } catch (e) {
    return 25;
  }
};

export default function ActorsPage({ onSelectActor }) {
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Derived state from URL
  const page = parseInt(searchParams.get('page') || '1', 10);
  const rawPageSize = parseInt(searchParams.get('limit') || '', 10);
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize) ? rawPageSize : getStoredPageSize();
  const searchTermUrl = searchParams.get('search') || '';
  const platformFilter = searchParams.get('platform') || 'All';

  // Local state for immediate typing performance
  const [searchTerm, setSearchTerm] = useState(searchTermUrl);
  
  const [actors, setActors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [total, setTotal] = useState(0);

  // Race condition protection
  const lastRequestRef = React.useRef(0);

  // 1. Sync local searchTerm with URL if URL changes externally
  useEffect(() => {
    setSearchTerm(searchTermUrl);
  }, [searchTermUrl]);

  // 2. Debounce Search and update URL
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm !== searchTermUrl) {
        setSearchParams(prev => {
          const next = new URLSearchParams(prev);
          if (searchTerm) next.set('search', searchTerm);
          else next.delete('search');
          next.set('page', '1'); // Reset page on search
          return next;
        }, { replace: true });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, searchTermUrl, setSearchParams]);

  // 3. Helper to update URL params
  const updateParams = (updates) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '' || value === 'All') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      });
      return next;
    });
  };

  const handlePageSizeChange = (size) => {
    try {
      localStorage.setItem(ACTORS_PAGE_SIZE_KEY, String(size));
    } catch (e) { }
    updateParams({ limit: size, page: 1 });
  };

  // 4. Load Data
  useEffect(() => {
    async function loadActors() {
      const reqId = ++lastRequestRef.current;
      setLoading(true);
      setError(null);
      
      const result = await apiClient.getActors({
        page,
        limit: pageSize,
        search: searchTermUrl,
        platform: platformFilter === 'All' ? '' : platformFilter
      });
      
      if (reqId !== lastRequestRef.current) return;

      if (result.status === 'error') {
        setError(result.message);
        setActors([]);
        setTotal(0);
      } else {
        setActors(result.items || []);
        setTotal(result.total || 0);
      }
      setLoading(false);
    }

    loadActors();
  }, [page, pageSize, searchTermUrl, platformFilter]);

  const columns = [
    { 
      key: 'handle', 
      label: 'Handle', 
      sortable: true,
      render: (row) => (
        <span style={{ fontWeight: '600', color: 'var(--primary)' }}>
          {row.handle}
        </span>
      )
    },
    { 
      key: 'platform', 
      label: 'Platform', 
      sortable: true,
      render: (row) => (
        <span className="badge badge-platform">
          {row.platform}
        </span>
      )
    },
    { 
      key: 'display_name', 
      label: 'Display Name', 
      sortable: true,
      render: (row) => <span className="text-secondary">{row.display_name || '-'}</span>
    },
    { 
      key: 'analyzed_count', 
      label: 'Posts Analyzed', 
      sortable: true,
      render: (row) => `${row.analyzed_count || 0} / ${row.post_count || 0}`
    },
    { 
      key: 'last_seen', 
      label: 'Last Seen', 
      sortable: true,
      render: (row) => (
        <span className="text-secondary">
          {row.last_seen ? new Date(row.last_seen).toLocaleDateString() : 'Never'}
        </span>
      )
    }
  ];

  if (loading && actors.length === 0) {
    return <div className="loading">Loading actors data...</div>;
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Actors Directory</h2>
        <p className="page-subtitle">Monitor and analyze individual actors across social platforms</p>
      </div>
      
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">All Actors</h3>
        </div>

        {/* Controls Bar */}
        <div className="toolbar">
          <input 
            type="text" 
            placeholder="Search handle or display name..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '300px' }}
          />
          
          <select 
            value={platformFilter} 
            onChange={(e) => updateParams({ platform: e.target.value, page: 1 })}
            style={{ 
              width: '150px',
              backgroundColor: 'var(--input-bg)',
              color: 'var(--text)',
              borderColor: 'var(--border)'
            }}
          >
            <option value="All">All Platforms</option>
            <option value="twitter">Twitter</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="reddit">Reddit</option>
            <option value="tiktok">TikTok</option>
            <option value="other">Other</option>
          </select>

          <span className="controls-count">
            Found {total} actors
          </span>
        </div>

        {error && <div className="error" style={{ margin: '0 20px 20px' }}>Error loading actors: {error}</div>}

        <DataTable 
          columns={columns}
          rows={actors}
          onRowClick={onSelectActor}
          defaultSortKey="last_seen"
          defaultSortDir="desc"
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          manualPagination={true}
          totalRows={total}
          currentPage={page}
          pageSize={pageSize}
          onPageChange={(p) => updateParams({ page: p })}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>
    </div>
  );
}
