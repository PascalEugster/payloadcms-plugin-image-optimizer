'use client'

import React from 'react'
import { thumbHashToDataURL } from 'thumbhash'
import { useAllFormFields } from '@payloadcms/ui'

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

export const OptimizationStatus: React.FC<{ path?: string }> = (props) => {
  const [formState] = useAllFormFields()
  const basePath = props.path ?? 'imageOptimizer'

  const status = formState[`${basePath}.status`]?.value as string | undefined
  const originalSize = formState[`${basePath}.originalSize`]?.value as number | undefined
  const optimizedSize = formState[`${basePath}.optimizedSize`]?.value as number | undefined
  const thumbHash = formState[`${basePath}.thumbHash`]?.value as string | undefined
  const error = formState[`${basePath}.error`]?.value as string | undefined

  const thumbHashUrl = React.useMemo(() => {
    if (!thumbHash) return null
    try {
      const bytes = Uint8Array.from(atob(thumbHash), c => c.charCodeAt(0))
      return thumbHashToDataURL(bytes)
    } catch {
      return null
    }
  }, [thumbHash])

  // Read variants array from form state
  const variantsField = formState[`${basePath}.variants`]
  const rowCount = (variantsField as any)?.rows?.length ?? 0
  const variants: Array<{
    format?: string
    filename?: string
    filesize?: number
    width?: number
    height?: number
  }> = []

  for (let i = 0; i < rowCount; i++) {
    variants.push({
      format: formState[`${basePath}.variants.${i}.format`]?.value as string | undefined,
      filename: formState[`${basePath}.variants.${i}.filename`]?.value as string | undefined,
      filesize: formState[`${basePath}.variants.${i}.filesize`]?.value as number | undefined,
      width: formState[`${basePath}.variants.${i}.width`]?.value as number | undefined,
      height: formState[`${basePath}.variants.${i}.height`]?.value as number | undefined,
    })
  }

  if (!status) {
    return (
      <div style={{ padding: '12px 0' }}>
        <div style={{ color: '#6b7280', fontSize: '13px' }}>
          No optimization data yet. Upload an image to optimize.
        </div>
      </div>
    )
  }

  const savings =
    originalSize && optimizedSize
      ? Math.round((1 - optimizedSize / originalSize) * 100)
      : null

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ marginBottom: '8px' }}>
        <span
          style={{
            backgroundColor: statusColors[status] || '#6b7280',
            borderRadius: '4px',
            color: '#fff',
            display: 'inline-block',
            fontSize: '12px',
            fontWeight: 600,
            padding: '2px 8px',
            textTransform: 'uppercase',
          }}
        >
          {status}
        </span>
      </div>

      {error && (
        <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '8px' }}>{error}</div>
      )}

      {originalSize != null && optimizedSize != null && (
        <div style={{ fontSize: '13px', marginBottom: '8px' }}>
          <div>Original: <strong>{formatBytes(originalSize)}</strong></div>
          <div>
            Optimized: <strong>{formatBytes(optimizedSize)}</strong>
            {savings != null && savings > 0 && (
              <span style={{ color: '#10b981', marginLeft: '4px' }}>(-{savings}%)</span>
            )}
          </div>
        </div>
      )}

      {thumbHashUrl && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontSize: '12px', marginBottom: '4px', opacity: 0.7 }}>Blur Preview</div>
          <img
            alt="Blur placeholder"
            src={thumbHashUrl}
            style={{ borderRadius: '4px', height: '40px', width: 'auto' }}
          />
        </div>
      )}

      {variants.length > 0 && (
        <div>
          <div style={{ fontSize: '12px', marginBottom: '4px', opacity: 0.7 }}>Variants</div>
          {variants.map((v, i) => (
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
