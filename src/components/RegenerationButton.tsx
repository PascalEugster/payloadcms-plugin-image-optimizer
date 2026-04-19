'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSelection } from '@payloadcms/ui'

type RegenerationProgress = {
  total: number
  complete: number
  errored: number
  pending: number
}

type RegenerationStats = RegenerationProgress & { allowForceAll?: boolean }

const POLL_INTERVAL_MS = 2000
// With sequential processing each image takes ~4-5s, so no progress for 30s
// (15 polls) strongly suggests a real stall rather than slow processing.
const STALL_THRESHOLD = 15
const SESSION_KEY = 'imageOptimizer_running'

export const RegenerationButton: React.FC = () => {
  const { count: selectionCount, getSelectedIds } = useSelection()
  const hasSelection = selectionCount > 0
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<RegenerationProgress | null>(null)
  const [queued, setQueued] = useState<number | null>(null)
  const [force, setForce] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [collectionSlug, setCollectionSlug] = useState<string | null>(null)
  const [stats, setStats] = useState<RegenerationStats | null>(null)
  const [allowForceAll, setAllowForceAll] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stallRef = useRef({ lastProcessed: 0, stallCount: 0 })
  // Snapshot of complete+errored at the moment regeneration starts,
  // so we can compute batch-relative progress for selective regeneration.
  const baselineRef = useRef<number | null>(null)
  const prevIsRunningRef = useRef(false)

  // Extract collection slug from URL after mount to avoid hydration mismatch
  useEffect(() => {
    const slug = window.location.pathname.split('/collections/')[1]?.split('/')[0] ?? null
    setCollectionSlug(slug)
  }, [])

  // Fetch optimization stats (independent of regeneration)
  const fetchStats = useCallback(async () => {
    if (!collectionSlug) return
    try {
      const res = await fetch(
        `/api/image-optimizer/regenerate?collection=${collectionSlug}`,
      )
      if (res.ok) {
        const data: RegenerationStats = await res.json()
        setStats(data)
        if (typeof data.allowForceAll === 'boolean') setAllowForceAll(data.allowForceAll)
      }
    } catch {
      // ignore stats fetch errors
    }
  }, [collectionSlug])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const startPolling = useCallback(
    (pollFn: () => void) => {
      // Prevent duplicate intervals
      stopPolling()
      intervalRef.current = setInterval(pollFn, POLL_INTERVAL_MS)
    },
    [stopPolling],
  )

  const pollProgress = useCallback(async () => {
    if (!collectionSlug) return
    try {
      const res = await fetch(
        `/api/image-optimizer/regenerate?collection=${collectionSlug}`,
      )
      if (res.ok) {
        const data = await res.json()
        setProgress(data)

        // Stop polling if server reports cancellation
        if (data.cancelled) {
          setCancelled(true)
          setIsRunning(false)
          setStalled(false)
          stopPolling()
          sessionStorage.removeItem(SESSION_KEY)
          return
        }

        // Stop polling when no more pending
        if (data.pending <= 0) {
          setIsRunning(false)
          setStalled(false)
          stopPolling()
          sessionStorage.removeItem(SESSION_KEY)
          return
        }

        // Stall detection — warn but keep polling so we detect when jobs resume
        const processed = data.complete + data.errored
        if (processed === stallRef.current.lastProcessed) {
          stallRef.current.stallCount += 1
        } else {
          stallRef.current.stallCount = 0
          stallRef.current.lastProcessed = processed
          // Clear stall warning when progress resumes
          setStalled(false)
        }

        if (stallRef.current.stallCount >= STALL_THRESHOLD) {
          setStalled(true)
          // Keep polling — jobs may still be running server-side
        }
      }
    } catch {
      // ignore polling errors
    }
  }, [collectionSlug, stopPolling])

  // On mount: fetch stats for the counter display. If the user previously
  // triggered regeneration (sessionStorage flag) and there are still pending
  // images, resume polling so the UI reconnects after page navigation.
  useEffect(() => {
    if (!collectionSlug) return
    let cancelled = false
    const loadStats = async () => {
      try {
        const res = await fetch(
          `/api/image-optimizer/regenerate?collection=${collectionSlug}`,
        )
        if (!res.ok || cancelled) return
        const data: RegenerationStats = await res.json()
        setStats(data)
        if (typeof data.allowForceAll === 'boolean') setAllowForceAll(data.allowForceAll)

        // Resume polling only if the user triggered regeneration in this session
        const wasRunning = sessionStorage.getItem(SESSION_KEY) === collectionSlug
        if (wasRunning && data.pending > 0) {
          setProgress(data)
          setIsRunning(true)
          setStalled(false)
          stallRef.current = { lastProcessed: data.complete + data.errored, stallCount: 0 }
          startPolling(pollProgress)
        } else if (wasRunning && data.pending <= 0) {
          // Jobs finished while we were away — clear the flag
          sessionStorage.removeItem(SESSION_KEY)
        }
      } catch {
        // ignore
      }
    }
    loadStats()
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [collectionSlug, pollProgress, startPolling, stopPolling])

  // Refresh stats when regeneration finishes (isRunning transitions from true to false)
  useEffect(() => {
    if (prevIsRunningRef.current && !isRunning) {
      fetchStats()
    }
    prevIsRunningRef.current = isRunning
  }, [isRunning, fetchStats])

  // Phase 1: Show confirmation with counts
  const handlePreflight = async () => {
    if (!collectionSlug) return
    setError(null)
    // Refresh stats to get the latest counts before confirming
    await fetchStats()
    setConfirming(true)
  }

  const handleCancel = () => {
    setConfirming(false)
  }

  const handleStop = async () => {
    if (!collectionSlug) return
    try {
      await fetch('/api/image-optimizer/regenerate', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionSlug }),
      })
      setCancelled(true)
      setIsRunning(false)
      setStalled(false)
      stopPolling()
      sessionStorage.removeItem(SESSION_KEY)
      fetchStats()
    } catch {
      // ignore cancel errors
    }
  }

  // Phase 2: Actually start regeneration (after user confirms)
  const handleConfirm = async () => {
    if (!collectionSlug) return
    setConfirming(false)
    setError(null)
    setStalled(false)
    setCancelled(false)
    setIsRunning(true)
    setQueued(null)
    setProgress(null)
    stallRef.current = { lastProcessed: 0, stallCount: 0 }
    // Capture current complete+errored as baseline before new jobs run
    baselineRef.current = stats ? stats.complete + stats.errored : 0

    try {
      const effectiveForce = allowForceAll && force
      const requestBody: Record<string, unknown> = { collectionSlug, force: effectiveForce }
      if (hasSelection) {
        requestBody.docIds = getSelectedIds().map(String)
      }

      const res = await fetch('/api/image-optimizer/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
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

      // Persist running state so we can resume after page navigation
      sessionStorage.setItem(SESSION_KEY, collectionSlug)
      // Start polling
      startPolling(pollProgress)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsRunning(false)
    }
  }

  // Cleanup interval on unmount
  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  if (!collectionSlug) return null

  // When a batch is running, compute progress relative to the queued count
  // (not the total collection) so selective regeneration shows e.g. 1/2, not 1/167.
  const batchTotal = queued ?? progress?.total ?? 0
  const batchProcessed = progress
    ? (progress.complete + progress.errored) - (baselineRef.current ?? 0)
    : 0
  const batchComplete = progress
    ? progress.complete - Math.max((baselineRef.current ?? 0) - (progress.errored), 0)
    : 0
  const batchErrored = progress ? Math.max(batchProcessed - Math.max(batchComplete, 0), 0) : 0

  const progressPercent =
    batchTotal > 0
      ? Math.min(Math.round((batchProcessed / batchTotal) * 100), 100)
      : 0

  const showProgressBar = (isRunning && progress) || (stalled && progress)

  // Stats computations
  const statsPercent =
    stats && stats.total > 0
      ? Math.round((stats.complete / stats.total) * 100)
      : 0
  const allOptimized = stats && stats.total > 0 && stats.complete === stats.total

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
      {!confirming && !isRunning && (() => {
        const pending = stats?.pending ?? 0
        // Primary action is scoped to what actually needs work. Force-all is an
        // explicit opt-in via plugin config.
        const nothingToDo =
          !hasSelection && pending === 0 && !(allowForceAll && force)
        const label = hasSelection
          ? `Regenerate ${selectionCount} Selected`
          : allowForceAll && force
            ? `Re-process all ${stats?.total ?? 0} images`
            : pending > 0
              ? `Regenerate ${pending} Unoptimized`
              : 'All images optimized'
        return (
          <button
            onClick={handlePreflight}
            disabled={nothingToDo}
            style={{
              backgroundColor: nothingToDo ? '#9ca3af' : '#4f46e5',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: nothingToDo ? 'not-allowed' : 'pointer',
            }}
          >
            {label}
          </button>
        )
      })()}

      {!confirming && isRunning && (
        <button
          onClick={handleStop}
          style={{
            backgroundColor: '#ef4444',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Stop Processing
        </button>
      )}

      {confirming && stats && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', color: '#374151' }}>
            {hasSelection
              ? `Regenerate ${selectionCount} selected image${selectionCount !== 1 ? 's' : ''}?`
              : allowForceAll && force
                ? `Re-process all ${stats.total} images across the entire collection?`
                : `Regenerate ${stats.pending} unoptimized image${stats.pending !== 1 ? 's' : ''} across the entire collection?`}
          </span>
          <button
            onClick={handleConfirm}
            style={{
              backgroundColor: '#4f46e5',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Confirm
          </button>
          <button
            onClick={handleCancel}
            style={{
              backgroundColor: 'transparent',
              color: '#6b7280',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              padding: '6px 14px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {!confirming && allowForceAll && (
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
      )}

      {error && (
        <span style={{ color: '#ef4444', fontSize: '13px' }}>{error}</span>
      )}

      {queued !== null && queued > 0 && isRunning && !confirming && (
        <span style={{ color: '#4f46e5', fontSize: '13px' }}>
          Queued {queued} image{queued !== 1 ? 's' : ''} for processing
        </span>
      )}

      {queued === 0 && !isRunning && !stalled && !confirming && !cancelled && (
        <span style={{ color: '#10b981', fontSize: '13px' }}>
          All images already optimized.
        </span>
      )}

      {cancelled && !isRunning && !confirming && (
        <span style={{ color: '#f59e0b', fontSize: '13px' }}>
          Processing cancelled.
        </span>
      )}

      {stalled && progress && (
        <span style={{ color: '#f59e0b', fontSize: '13px' }}>
          Processing appears slow — {progress.pending} image{progress.pending !== 1 ? 's' : ''} still pending.
          Jobs may still be running server-side.
        </span>
      )}

      {showProgressBar && (
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
              {Math.max(batchProcessed, 0)} / {batchTotal} complete
            </span>
            {batchErrored > 0 && (
              <span style={{ color: '#ef4444' }}>{batchErrored} errors</span>
            )}
            <span>{progressPercent}%</span>
          </div>
          <div
            style={{
              height: '6px',
              backgroundColor: '#e5e7eb',
              borderRadius: '3px',
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${batchTotal > 0 ? Math.min(Math.round(((batchProcessed - batchErrored) / batchTotal) * 100), 100) : 0}%`,
                backgroundColor: '#10b981',
                transition: 'width 0.3s ease',
              }}
            />
            {batchErrored > 0 && (
              <div
                style={{
                  height: '100%',
                  width: `${batchTotal > 0 ? Math.round((batchErrored / batchTotal) * 100) : 0}%`,
                  backgroundColor: '#ef4444',
                  transition: 'width 0.3s ease',
                }}
              />
            )}
          </div>
        </div>
      )}

      {!isRunning && !stalled && !cancelled && progress && batchProcessed > 0 && queued !== 0 && !confirming && (
        <span style={{ fontSize: '13px' }}>
          <span style={{ color: batchErrored > 0 ? '#f59e0b' : '#10b981' }}>
            Done! {Math.max(batchProcessed - batchErrored, 0)}/{batchTotal} optimized.
          </span>
          {batchErrored > 0 && (
            <span style={{ color: '#ef4444' }}>
              {' '}{batchErrored} failed.
            </span>
          )}
        </span>
      )}

      {/* Persistent optimization stats — always visible when not actively regenerating */}
      {!isRunning && !stalled && stats && stats.total > 0 && (
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '4px',
            minWidth: '180px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
            {allOptimized ? (
              <span style={{ color: '#10b981' }}>
                &#10003; All {stats.total} images optimized
              </span>
            ) : (
              <>
                <span style={{ color: '#6b7280' }}>
                  {stats.complete}/{stats.total} optimized
                </span>
                {stats.errored > 0 && (
                  <>
                    <span style={{ color: '#d1d5db' }}>&middot;</span>
                    <span style={{ color: '#ef4444' }}>{stats.errored} errors</span>
                  </>
                )}
              </>
            )}
          </div>
          {!allOptimized && (
            <div
              style={{
                width: '100%',
                height: '3px',
                backgroundColor: '#e5e7eb',
                borderRadius: '2px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${statsPercent}%`,
                  backgroundColor: stats.errored > 0 ? '#f59e0b' : '#10b981',
                  borderRadius: '2px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
