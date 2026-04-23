import React, { useState, useEffect } from 'react';
import { fetchCoordination } from '../api/client';
import DataTable from '../components/DataTable';

export default function CoordinationPage({ highlightedGroupId }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterTerm, setFilterTerm] = useState('');
  
  // New state
  const [selectedGroup, setSelectedGroup] = useState(null);

  const loadGroups = async () => {
    setLoading(true);
    setError(null);
    const result = await fetchCoordination();
    if (result.status === 'error') {
      setError(result.message);
      setGroups([]);
    } else {
      setGroups(result.items || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadGroups();
  }, []);

  // Sync highlightedGroupId with selectedGroup
  useEffect(() => {
    if (highlightedGroupId && groups.length > 0) {
      const group = groups.find(g => String(g.id) === String(highlightedGroupId));
      if (group) {
        setSelectedGroup(group);
      }
    }
  }, [highlightedGroupId, groups]);

  // Helper to resolve fields
  const getField = (obj, keys, fallback) => {
    for (const key of keys) {
      if (obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
    return fallback;
  };

  // Build Graph Data
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] });
  
  useEffect(() => {
    if (groups.length === 0) {
      setGraphData({ nodes: [], edges: [] });
      return;
    }

    const nodesMap = new Map();
    const edges = [];

    groups.forEach(group => {
      const membersRaw = getField(group, ['members', 'actors', 'actor_handles', 'handles', 'member_handles', 'accounts', 'member_account_ids'], []);
      const members = Array.isArray(membersRaw) ? membersRaw : [String(membersRaw)];
      
      const scoreRaw = getField(group, ['score', 'similarity', 'similarity_score', 'group_score', 'coordination_score'], 1);
      const weight = typeof scoreRaw === 'number' ? scoreRaw : 1;

      // Add nodes
      members.forEach(member => {
        const id = String(member);
        if (!nodesMap.has(id)) {
          nodesMap.set(id, { id, label: id });
        }
      });

      // Add edges (connect all to first member for star topology to keep simple)
      if (members.length > 1) {
        const center = String(members[0]);
        for (let i = 1; i < members.length; i++) {
          edges.push({
            source: center,
            target: String(members[i]),
            weight,
            groupId: group.id
          });
        }
      }
    });

    // Layout nodes in a circle
    const nodes = Array.from(nodesMap.values());
    const width = 600;
    const height = 400;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 40;

    const layoutNodes = nodes.map((node, index) => {
      const angle = (index / nodes.length) * 2 * Math.PI;
      return {
        ...node,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      };
    });

    setGraphData({ nodes: layoutNodes, edges });
  }, [groups]);

  // SVG rendering helper for edges
  const renderEdges = () => {
    return graphData.edges.map((edge, i) => {
      const source = graphData.nodes.find(n => n.id === edge.source);
      const target = graphData.nodes.find(n => n.id === edge.target);
      if (!source || !target) return null;
      return (
        <line 
          key={i}
          x1={source.x} y1={source.y}
          x2={target.x} y2={target.y}
          stroke="#9ca3af"
          strokeWidth={Math.max(1, edge.weight * 3)}
          strokeOpacity={0.6}
        />
      );
    });
  };

  // SVG rendering helper for nodes
  const renderNodes = () => {
    return graphData.nodes.map((node, i) => (
      <g key={i} transform={`translate(${node.x},${node.y})`}>
        <circle 
          r="8" 
          fill="#5576d1" 
          stroke="#fff" 
          strokeWidth="2" 
          style={{ cursor: 'pointer' }}
          onClick={() => setFilterTerm(node.id)}
        >
          <title>{node.label}</title>
        </circle>
        <text 
          y="20" 
          textAnchor="middle" 
          fill="#374151" 
          fontSize="10" 
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {node.label.length > 10 ? node.label.substring(0, 8) + '..' : node.label}
        </text>
      </g>
    ));
  };

  const filteredGroups = groups.filter(g => {
    if (!filterTerm) return true;
    const term = filterTerm.toLowerCase();
    
    // Resolve actors for search
    const members = getField(g, ['members', 'actors', 'actor_handles', 'handles', 'member_handles', 'accounts', 'member_account_ids'], []);
    const actorsStr = Array.isArray(members) ? members.join(', ') : String(members);
    
    const idStr = String(g.id || '');
    return idStr.includes(term) || actorsStr.toLowerCase().includes(term);
  });

  // Pre-process groups for DataTable
  const processedGroups = filteredGroups.map(group => {
    const type = getField(group, ['type', 'group_type', 'kind', 'detection_type', 'coordination_type', 'alert_type'], 'Unknown');
    
    const rawScore = getField(group, ['score', 'similarity', 'similarity_score', 'group_score', 'coordination_score', 'drift', 'drift_score'], null);
    const scoreVal = typeof rawScore === 'number' ? rawScore : 0;
    const scoreDisplay = rawScore !== null 
      ? (typeof rawScore === 'number' && rawScore <= 1 ? (rawScore * 100).toFixed(1) + '%' : rawScore) 
      : '-';
    
    let period = getField(group, ['period', 'week', 'week_start', 'time_period', 'window', 'time_window', 'date', 'timestamp'], 'Unknown');
    if (period === 'Unknown') {
       const label = getField(group, ['label', 'description', 'message', 'summary'], '');
       if (label && typeof label === 'string') {
         const weekMatch = label.match(/week\s+(\d{4}-\d{2}-\d{2})/i);
         if (weekMatch) period = weekMatch[1];
       }
    }
    
    const membersRaw = getField(group, ['members', 'actors', 'actor_handles', 'handles', 'member_handles', 'accounts', 'member_account_ids', 'actor_id', 'entity_id'], []);
    const membersList = Array.isArray(membersRaw) ? membersRaw : [String(membersRaw)];
    const membersStr = membersList.join(', ');
    const count = membersList.length;

    return {
      ...group,
      resolvedType: type,
      resolvedScore: scoreVal,
      resolvedScoreDisplay: scoreDisplay,
      resolvedPeriod: period,
      resolvedMembersCount: count,
      resolvedMembersStr: membersStr
    };
  });

  const columns = [
    {
      key: 'id',
      label: 'Group ID',
      sortable: true,
      width: '100px',
      render: (row) => <span style={{ fontWeight: '600' }}>#{row.id}</span>
    },
    {
      key: 'resolvedType',
      label: 'Type',
      sortable: true,
      width: '120px',
      render: (row) => <span className="badge badge-primary">{row.resolvedType}</span>
    },
    {
      key: 'resolvedScore',
      label: 'Score',
      sortable: true,
      width: '120px',
      render: (row) => <span style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{row.resolvedScoreDisplay}</span>
    },
    {
      key: 'resolvedPeriod',
      label: 'Time Period',
      sortable: true,
      width: '180px',
      render: (row) => <span className="text-muted">{row.resolvedPeriod}</span>
    },
    {
      key: 'resolvedMembersCount',
      label: 'Members',
      sortable: true,
      render: (row) => (
        <div>
          <span className="text-navy" style={{ fontWeight: '600' }}>{row.resolvedMembersCount} Members</span>
          <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '4px', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.resolvedMembersStr}>
            {row.resolvedMembersStr}
          </div>
        </div>
      )
    }
  ];

  if (loading && groups.length === 0) return <div className="loading">Loading coordination data...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Coordination Detection</h2>
        <p className="page-subtitle">Identify groups of actors exhibiting coordinated behavior patterns</p>
      </div>

      {/* Network Graph Card */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h3 className="card-title">Coordination Network</h3>
        </div>
        <div style={{ padding: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px', overflow: 'auto' }}>
          {graphData.nodes.length === 0 ? (
             <div className="empty">Network graph needs group members data. Backend enrichment required.</div>
          ) : (
            <svg width="600" height="400" viewBox="0 0 600 400" style={{ maxWidth: '100%', height: 'auto' }}>
              {/* Edges */}
              {renderEdges()}
              
              {/* Nodes */}
              {renderNodes()}
            </svg>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Detected Groups</h3>
        </div>

        <div className="toolbar">
          <input
            type="text"
            placeholder="Search by Group ID or Actor Handle..."
            value={filterTerm}
            onChange={e => setFilterTerm(e.target.value)}
            style={{ width: '350px' }}
          />
          <span className="controls-count">
             Found {filteredGroups.length} groups
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={processedGroups}
          onRowClick={setSelectedGroup}
          highlightedRowId={selectedGroup ? selectedGroup.id : null}
          defaultSortKey="resolvedScore"
          defaultSortDir="desc"
        />
      </div>

      {/* Group Details Panel */}
      {selectedGroup && (
        <div className="card" style={{ marginTop: '24px', borderTop: '4px solid var(--primary)' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 className="card-title">Group #{selectedGroup.id} Details</h3>
            <button 
              className="btn btn-ghost" 
              onClick={() => setSelectedGroup(null)}
              style={{ fontSize: '1.2rem', padding: '4px 8px' }}
            >
              ×
            </button>
          </div>
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
              <div>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Metrics</h4>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <div className="info-box" style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', minWidth: '120px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Similarity Score</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                      {(() => {
                        const s = getField(selectedGroup, ['score', 'similarity', 'similarity_score', 'group_score', 'coordination_score'], null);
                        return s !== null ? (typeof s === 'number' ? (s * 100).toFixed(1) + '%' : s) : '-';
                      })()}
                    </div>
                  </div>
                  <div className="info-box" style={{ background: 'var(--bg)', padding: '12px', borderRadius: '8px', minWidth: '120px' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Time Period</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: '600' }}>
                      {getField(selectedGroup, ['period', 'week', 'week_start', 'time_period', 'window', 'label', 'time_window'], 'Unknown')}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '8px' }}>Why Flagged</h4>
                <div style={{ background: '#FFFBEB', color: '#92400E', padding: '12px', borderRadius: '8px', fontSize: '0.9rem', lineHeight: '1.5' }}>
                  {getField(selectedGroup, ['reason', 'description', 'summary'], 
                    "Flagged because multiple actors shifted topics in the same time window with high similarity.")}
                </div>
              </div>
            </div>

            <div>
              <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Group Members</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {(() => {
                   const membersRaw = getField(selectedGroup, ['members', 'actors', 'actor_handles', 'handles', 'member_handles', 'accounts', 'member_account_ids'], []);
                   const list = Array.isArray(membersRaw) ? membersRaw : [String(membersRaw)];
                   
                   return list.map((member, i) => (
                     <span key={i} className="badge badge-gray" style={{ padding: '6px 12px', fontSize: '0.85rem' }}>
                       {String(member)}
                     </span>
                   ));
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
