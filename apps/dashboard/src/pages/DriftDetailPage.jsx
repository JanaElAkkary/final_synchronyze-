import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchActorDrift, fetchActorDetails } from '../api/client';

export default function DriftDetailPage({ onBack }) {
  const { actorId } = useParams();
  const [drift, setDrift] = useState([]);
  const [driftLoading, setDriftLoading] = useState(true);
  const [driftError, setDriftError] = useState(null);
  const [maxDrift, setMaxDrift] = useState(0);
  const [actor, setActor] = useState(null);

  useEffect(() => {
    async function loadData() {
      if (!actorId) return;
      
      // Load Actor Basic Info
      try {
        const details = await fetchActorDetails(actorId);
        if (details.status === 'ok' || details.status === 'success') {
           const data = details.actor || details.data?.actor || details.data || details;
           setActor(data);
        }
      } catch (e) {
        console.error(e);
      }

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
        
        // Calculate max drift
        let max = 0;
        for (let i = 0; i < driftItems.length; i++) {
          const val = driftItems[i].drift || driftItems[i].drift_score || driftItems[i].score || driftItems[i].cosine_drift || 0;
          if (val > max) max = val;
        }
        setMaxDrift(max);
      }
      setDriftLoading(false);
    }

    loadData();
  }, [actorId]);

  return (
    <div>
       <button className="btn btn-back" onClick={onBack}>
        <span style={{ marginRight: '8px' }}>&larr;</span> Back
      </button>

      <div className="page-header">
        <h2 className="page-title">Drift Analysis</h2>
        {actor && <p className="page-subtitle">For actor: <strong>{actor.handle}</strong> ({actor.platform})</p>}
      </div>

      <div className="card">
          <div className="card-header">
            <h3 className="card-title">Drift History</h3>
            <span className="badge badge-blue">Max: {(maxDrift * 100).toFixed(1)}%</span>
          </div>
          
          {driftLoading ? (
            <div className="loading">Loading drift data...</div>
          ) : driftError ? (
            <div className="error">Error: {driftError}</div>
          ) : drift.length === 0 ? (
            <div className="empty">No drift data available.</div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Drift Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {drift.map((item, index) => {
                    const label = item.week || item.week_start || item.period || item.label || `Week #${index + 1}`;
                    const value = item.drift || item.drift_score || item.score || item.cosine_drift;
                    const driftVal = (value !== undefined && value !== null) ? value : null;
                    const isHighDrift = driftVal >= 0.30;

                    return (
                      <tr key={index}>
                        <td>{label}</td>
                        <td>
                          {driftVal !== null ? (Number(driftVal) * 100).toFixed(1) + '%' : '-'}
                        </td>
                        <td>
                           {isHighDrift ? 
                             <span className="badge badge-teal">High Drift</span> : 
                             <span className="badge">Normal</span>
                           }
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
  );
}
