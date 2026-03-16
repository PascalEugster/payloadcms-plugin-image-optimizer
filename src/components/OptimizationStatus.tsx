'use client'

import React from 'react'

type VariantData = {
  format?: string
  filename?: string
  filesize?: number
  width?: number
  height?: number
  mimeType?: string
  url?: string
}

type ImageOptimizerData = {
  blurDataURL?: string
  originalSize?: number
  optimizedSize?: number
  status?: 'pending' | 'processing' | 'complete' | 'error'
  error?: string
  variants?: VariantData[]
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

const statusColors: Record<string, string> = {
  pending: '#f59e0b',
  processing: '#3b82f6',
  complete: '#10b981',
  error: '#ef4444',
}

export const OptimizationStatus: React.FC<{ data?: ImageOptimizerData }> = ({ data }) => {
  if (!data || !data.status) {
    return null
  }

  const savings =
    data.originalSize && data.optimizedSize
      ? Math.round((1 - data.optimizedSize / data.originalSize) * 100)
      : null

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ marginBottom: '8px' }}>
        <span
          style={{
            backgroundColor: statusColors[data.status] || '#6b7280',
            borderRadius: '4px',
            color: '#fff',
            display: 'inline-block',
            fontSize: '12px',
            fontWeight: 600,
            padding: '2px 8px',
            textTransform: 'uppercase',
          }}
        >
          {data.status}
        </span>
      </div>

      {data.error && (
        <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px' }}>{data.error}</div>
      )}

      {data.originalSize != null && data.optimizedSize != null && (
        <div style={{ fontSize: '13px', marginBottom: '8px' }}>
          <div>
            Original: <strong>{formatBytes(data.originalSize)}</strong>
          </div>
          <div>
            Optimized: <strong>{formatBytes(data.optimizedSize)}</strong>
            {savings != null && savings > 0 && (
              <span style={{ color: '#10b981', marginLeft: '4px' }}>(-{savings}%)</span>
            )}
          </div>
        </div>
      )}

      {data.blurDataURL && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', marginBottom: '4px', opacity: 0.7 }}>Blur Preview</div>
          <img
            alt="Blur placeholder"
            src={data.blurDataURL}
            style={{ borderRadius: '4px', height: '40px', width: 'auto' }}
          />
        </div>
      )}

      {data.variants && data.variants.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', marginBottom: '4px', opacity: 0.7 }}>Variants</div>
          {data.variants.map((v, i) => (
            <div key={i} style={{ fontSize: '12px', marginBottom: '2px' }}>
              <strong>{v.format?.toUpperCase()}</strong> — {v.filesize ? formatBytes(v.filesize) : '?'}{' '}
              ({v.width}x{v.height})
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
