'use client'

import React from 'react'
import { thumbHashToDataURL } from 'thumbhash'
import { useAllFormFields, useDocumentInfo } from '@payloadcms/ui'

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

const POLL_INTERVAL_MS = 2000

type PolledData = {
  status?: string
  originalSize?: number
  optimizedSize?: number
  thumbHash?: string
  error?: string
  variants?: Array<{
    format?: string
    filename?: string
    filesize?: number
    width?: number
    height?: number
  }>
}

export const OptimizationStatus: React.FC<{ path?: string }> = (props) => {
  const [formState] = useAllFormFields()
  const { collectionSlug, id } = useDocumentInfo()
  const basePath = props.path ?? 'imageOptimizer'

  const formStatus = formState[`${basePath}.status`]?.value as string | undefined
  const formOriginalSize = formState[`${basePath}.originalSize`]?.value as number | undefined
  const formOptimizedSize = formState[`${basePath}.optimizedSize`]?.value as number | undefined
  const formThumbHash = formState[`${basePath}.thumbHash`]?.value as string | undefined
  const formError = formState[`${basePath}.error`]?.value as string | undefined

  const [polledData, setPolledData] = React.useState<PolledData | null>(null)

  // Reset polled data when a new upload changes the form status back to pending
  React.useEffect(() => {
    if (formStatus === 'pending') {
      setPolledData(null)
    }
  }, [formStatus])

  // Poll for status updates when status is non-terminal
  React.useEffect(() => {
    const currentStatus = polledData?.status ?? formStatus
    if (!currentStatus || currentStatus === 'complete' || currentStatus === 'error') return
    if (!collectionSlug || !id) return

    const controller = new AbortController()

    const poll = async () => {
      try {
        const res = await fetch(`/api/${collectionSlug}/${id}?depth=0`, {
          signal: controller.signal,
        })
        if (!res.ok) return
        const doc = await res.json()
        const optimizer = doc.imageOptimizer
        if (!optimizer) return

        setPolledData({
          status: optimizer.status,
          originalSize: optimizer.originalSize,
          optimizedSize: optimizer.optimizedSize,
          thumbHash: optimizer.thumbHash,
          error: optimizer.error,
          variants: optimizer.variants,
        })
      } catch {
        // Silently ignore fetch errors (abort, network issues)
      }
    }

    const intervalId = setInterval(poll, POLL_INTERVAL_MS)
    // Run immediately on mount
    poll()

    return () => {
      controller.abort()
      clearInterval(intervalId)
    }
  }, [polledData?.status, formStatus, collectionSlug, id])

  // Use polled data when available, otherwise fall back to form state
  const status = polledData?.status ?? formStatus
  const originalSize = polledData?.originalSize ?? formOriginalSize
  const optimizedSize = polledData?.optimizedSize ?? formOptimizedSize
  const thumbHash = polledData?.thumbHash ?? formThumbHash
  const error = polledData?.error ?? formError

  const thumbHashUrl = React.useMemo(() => {
    if (!thumbHash) return null
    try {
      const bytes = Uint8Array.from(atob(thumbHash), c => c.charCodeAt(0))
      return thumbHashToDataURL(bytes)
    } catch {
      return null
    }
  }, [thumbHash])

  // Read variants from polled data or form state
  const variants: Array<{
    format?: string
    filename?: string
    filesize?: number
    width?: number
    height?: number
  }> = React.useMemo(() => {
    if (polledData?.variants) return polledData.variants

    const variantsField = formState[`${basePath}.variants`]
    const rowCount = (variantsField as any)?.rows?.length ?? 0
    const formVariants: typeof variants = []
    for (let i = 0; i < rowCount; i++) {
      formVariants.push({
        format: formState[`${basePath}.variants.${i}.format`]?.value as string | undefined,
        filename: formState[`${basePath}.variants.${i}.filename`]?.value as string | undefined,
        filesize: formState[`${basePath}.variants.${i}.filesize`]?.value as number | undefined,
        width: formState[`${basePath}.variants.${i}.width`]?.value as number | undefined,
        height: formState[`${basePath}.variants.${i}.height`]?.value as number | undefined,
      })
    }
    return formVariants
  }, [polledData?.variants, formState, basePath])

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
