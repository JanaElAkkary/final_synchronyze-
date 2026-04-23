import React from 'react';

export default function Breadcrumbs({ items }) {
  if (!items || items.length === 0) return null;

  return (
    <div className="breadcrumbs" style={{
      display: 'flex',
      alignItems: 'center',
      fontSize: '0.875rem',
      color: '#6b7280',
      marginBottom: '1rem',
      fontWeight: 500
    }}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        
        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <span style={{ margin: '0 8px', color: '#9ca3af' }}>&gt;</span>
            )}
            
            {item.onClick && !isLast ? (
              <span 
                onClick={item.onClick}
                style={{ 
                  cursor: 'pointer', 
                  color: '#6b7280',
                  transition: 'color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.color = '#0492C2'}
                onMouseOut={(e) => e.currentTarget.style.color = '#6b7280'}
              >
                {item.label}
              </span>
            ) : (
              <span style={{ 
                color: isLast ? '#5576d1' : '#6b7280',
                cursor: isLast ? 'default' : 'inherit'
              }}>
                {item.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}