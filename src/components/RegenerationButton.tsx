'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'

type RegenerationProgress = {
  total: number
  complete: number
  errored: number
  pending: number
}

export const RegenerationButton: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<RegenerationProgress | null>(null)
  const [queued, setQueued] = useState<number | null>(null)
  const [force, setForce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Extract collection slug from URL
  const collectionSlug =
    typeof window !== 'undefined'
      ? window.location.pathname.split('/collections/')[1]?.split('/')[0]
      : null

  const pollProgress = useCallback(async () => {
    if (!collectionSlug) return
    try {
      const res = await fetch(
        `/api/image-optimizer/regenerate?collection=${collectionSlug}`,
      )
      if (res.ok) {
        const data = await res.json()
        setProgress(data)
        // Stop polling when no more pending
        if (data.pending <= 0) {
          setIsRunning(false)
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      }
    } catch {
      // ignore polling errors
    }
  }, [collectionSlug])

  const handleRegenerate = async () => {
    if (!collectionSlug) return
    setError(null)
    setIsRunning(true)
    setQueued(null)
    setProgress(null)

    try {
      const res = await fetch('/api/image-optimizer/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionSlug, force }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start regeneration')
      }

      const data = await res.json()
      setQueued(data.queued)

      if (data.queued === 0) {
        setIsRunning(false)
        return
      }

      // Start polling
      intervalRef.current = setInterval(pollProgress, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsRunning(false)
    }
  }

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  if (!collectionSlug) return null

  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.complete / progress.total) * 100)
      : 0

  return (
    <div
      style={{
        padding: '16px 24px',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
      }}
    >
      <button
        onClick={handleRegenerate}
        disabled={isRunning}
        style={{
          backgroundColor: isRunning ? '#9ca3af' : '#4f46e5',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          padding: '8px 16px',
          fontSize: '14px',
          fontWeight: 500,
          cursor: isRunning ? 'not-allowed' : 'pointer',
        }}
      >
        {isRunning ? 'Regenerating...' : 'Regenerate Images'}
      </button>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
      >
        <input
          type="checkbox"
          checked={force}
          onChange={(e) => setForce(e.target.checked)}
          disabled={isRunning}
        />
        Force re-process all
      </label>

      {error && (
        <span style={{ color: '#ef4444', fontSize: '13px' }}>{error}</span>
      )}

      {queued === 0 && !isRunning && (
        <span style={{ color: '#10b981', fontSize: '13px' }}>
          All images already optimized.
        </span>
      )}

      {isRunning && progress && (
        <div style={{ flex: 1, minWidth: '200px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '12px',
              marginBottom: '4px',
            }}
          >
            <span>
              {progress.complete} / {progress.total} complete
            </span>
            {progress.errored > 0 && (
              <span style={{ color: '#ef4444' }}>{progress.errored} errors</span>
            )}
            <span>{progressPercent}%</span>
          </div>
          <div
            style={{
              height: '6px',
              backgroundColor: '#e5e7eb',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                backgroundColor: '#10b981',
                borderRadius: '3px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}

      {!isRunning && progress && progress.complete > 0 && queued !== 0 && (
        <span style={{ color: '#10b981', fontSize: '13px' }}>
          Done! {progress.complete}/{progress.total} optimized.
        </span>
      )}
    </div>
  )
}
