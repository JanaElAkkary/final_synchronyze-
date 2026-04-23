import React, { useState, useEffect, useMemo } from 'react';

export default function DataTable({ 
  columns, 
  rows, 
  defaultSortKey = null, 
  defaultSortDir = 'asc',
  pageSizeOptions = [10, 25, 50],
  onRowClick = null,
  highlightedRowId = null,
  manualPagination = false,
  totalRows = null,
  currentPage: externalPage = null,
  pageSize: externalPageSize = null,
  onPageChange = null,
  onPageSizeChange = null
}) {
  const [sortConfig, setSortConfig] = useState({
    key: defaultSortKey,
    direction: defaultSortDir
  });

  const [internalPage, setInternalPage] = useState(1);
  const [internalPageSize, setInternalPageSize] = useState(pageSizeOptions[0]);

  const currentPage = externalPage !== null ? externalPage : internalPage;
  const pageSize = externalPageSize !== null ? externalPageSize : internalPageSize;

  // 1. Sorting Logic
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedRows = useMemo(() => {
    if (!sortConfig.key || manualPagination) return rows;

    return [...rows].sort((a, b) => {
      const valA = a[sortConfig.key];
      const valB = b[sortConfig.key];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
      }

      const strA = String(valA).toLowerCase();
      const strB = String(valB).toLowerCase();
      
      if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [rows, sortConfig, manualPagination]);

  // 2. Pagination Logic
  const effectiveTotalRows = manualPagination ? (totalRows || rows.length) : rows.length;
  const totalPages = Math.ceil(effectiveTotalRows / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const currentRows = manualPagination ? rows : sortedRows.slice(startIndex, startIndex + pageSize);

  // Sync / Reset page if out of bounds
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      if (externalPage !== null) {
        onPageChange?.(1);
      } else {
        setInternalPage(1);
      }
    }
  }, [currentPage, totalPages, externalPage, onPageChange]);

  const handlePageChange = (newPage) => {
    if (externalPage !== null) {
      onPageChange?.(newPage);
    } else {
      setInternalPage(newPage);
    }
  };

  const handlePageSizeChangeLocal = (newSize) => {
    if (externalPageSize !== null) {
      onPageSizeChange?.(newSize);
      return;
    }

    setInternalPageSize(newSize);
    if (externalPage !== null) {
      onPageChange?.(1);
    } else {
      setInternalPage(1);
    }
  };

  if (!rows || rows.length === 0) {
    return <div className="emptyState">No data to display.</div>;
  }

  return (
    <div className="datatable-wrapper">
      <div className="table-responsive">
        <table className="table">
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th 
                  key={idx}
                  className={`th ${col.sortable ? 'sortable' : ''} ${sortConfig.key === col.key ? 'active-sort' : ''}`}
                  onClick={() => col.sortable && handleSort(col.key)}
                  style={col.width ? { width: col.width } : {}}
                >
                  {col.label}
                  {col.sortable && sortConfig.key === col.key && (
                    <span className="sortIcon">
                      {sortConfig.direction === 'asc' ? ' ▲' : ' ▼'}
                    </span>
                  )}
                  {col.sortable && sortConfig.key !== col.key && (
                    <span className="sortIcon text-muted"> ⇅</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentRows.map((row, rIdx) => {
              const isHighlighted = highlightedRowId && (String(row.id) === String(highlightedRowId));
              return (
                <tr 
                  key={row.id || rIdx} 
                  className={`tr ${rIdx % 2 === 0 ? 'trStripe' : ''} ${onRowClick ? 'trHover' : ''} ${isHighlighted ? 'highlight-row' : ''}`}
                  onClick={() => onRowClick && onRowClick(row)}
                >
                  {columns.map((col, cIdx) => (
                    <td key={cIdx}>
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="paginationBar">
        <div className="page-info">
          Showing {effectiveTotalRows > 0 ? startIndex + 1 : 0}–{Math.min(startIndex + pageSize, effectiveTotalRows)} of {effectiveTotalRows}
        </div>
        
        <div className="page-controls">
          <select 
            className="pageSelect"
            value={pageSize}
            onChange={(e) => handlePageSizeChangeLocal(Number(e.target.value))}
          >
            {pageSizeOptions.map(opt => (
              <option key={opt} value={opt}>{opt} per page</option>
            ))}
          </select>

          <div className="btn-group">
            <button 
              className="pageBtn"
              disabled={currentPage === 1}
              onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
            >
              Prev
            </button>
            <span className="page-number">
              Page {currentPage} of {totalPages || 1}
            </span>
            <button 
              className="pageBtn"
              disabled={currentPage >= totalPages}
              onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
