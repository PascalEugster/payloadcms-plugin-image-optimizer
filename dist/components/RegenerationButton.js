'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSelection } from '@payloadcms/ui';
const POLL_INTERVAL_MS = 2000;
// With sequential processing each image takes ~4-5s, so no progress for 30s
// (15 polls) strongly suggests a real stall rather than slow processing.
const STALL_THRESHOLD = 15;
const SESSION_KEY = 'imageOptimizer_running';
export const RegenerationButton = ()=>{
    const { count: selectionCount, getSelectedIds } = useSelection();
    const hasSelection = selectionCount > 0;
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [queued, setQueued] = useState(null);
    const [force, setForce] = useState(false);
    const [error, setError] = useState(null);
    const [stalled, setStalled] = useState(false);
    const [collectionSlug, setCollectionSlug] = useState(null);
    const [stats, setStats] = useState(null);
    const [confirming, setConfirming] = useState(false);
    const intervalRef = useRef(null);
    const stallRef = useRef({
        lastProcessed: 0,
        stallCount: 0
    });
    const prevIsRunningRef = useRef(false);
    // Extract collection slug from URL after mount to avoid hydration mismatch
    useEffect(()=>{
        const slug = window.location.pathname.split('/collections/')[1]?.split('/')[0] ?? null;
        setCollectionSlug(slug);
    }, []);
    // Fetch optimization stats (independent of regeneration)
    const fetchStats = useCallback(async ()=>{
        if (!collectionSlug) return;
        try {
            const res = await fetch(`/api/image-optimizer/regenerate?collection=${collectionSlug}`);
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch  {
        // ignore stats fetch errors
        }
    }, [
        collectionSlug
    ]);
    const stopPolling = useCallback(()=>{
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);
    const startPolling = useCallback((pollFn)=>{
        // Prevent duplicate intervals
        stopPolling();
        intervalRef.current = setInterval(pollFn, POLL_INTERVAL_MS);
    }, [
        stopPolling
    ]);
    const pollProgress = useCallback(async ()=>{
        if (!collectionSlug) return;
        try {
            const res = await fetch(`/api/image-optimizer/regenerate?collection=${collectionSlug}`);
            if (res.ok) {
                const data = await res.json();
                setProgress(data);
                // Stop polling when no more pending
                if (data.pending <= 0) {
                    setIsRunning(false);
                    setStalled(false);
                    stopPolling();
                    sessionStorage.removeItem(SESSION_KEY);
                    return;
                }
                // Stall detection — warn but keep polling so we detect when jobs resume
                const processed = data.complete + data.errored;
                if (processed === stallRef.current.lastProcessed) {
                    stallRef.current.stallCount += 1;
                } else {
                    stallRef.current.stallCount = 0;
                    stallRef.current.lastProcessed = processed;
                    // Clear stall warning when progress resumes
                    setStalled(false);
                }
                if (stallRef.current.stallCount >= STALL_THRESHOLD) {
                    setStalled(true);
                // Keep polling — jobs may still be running server-side
                }
            }
        } catch  {
        // ignore polling errors
        }
    }, [
        collectionSlug,
        stopPolling
    ]);
    // On mount: fetch stats for the counter display. If the user previously
    // triggered regeneration (sessionStorage flag) and there are still pending
    // images, resume polling so the UI reconnects after page navigation.
    useEffect(()=>{
        if (!collectionSlug) return;
        let cancelled = false;
        const loadStats = async ()=>{
            try {
                const res = await fetch(`/api/image-optimizer/regenerate?collection=${collectionSlug}`);
                if (!res.ok || cancelled) return;
                const data = await res.json();
                setStats(data);
                // Resume polling only if the user triggered regeneration in this session
                const wasRunning = sessionStorage.getItem(SESSION_KEY) === collectionSlug;
                if (wasRunning && data.pending > 0) {
                    setProgress(data);
                    setIsRunning(true);
                    setStalled(false);
                    stallRef.current = {
                        lastProcessed: data.complete + data.errored,
                        stallCount: 0
                    };
                    startPolling(pollProgress);
                } else if (wasRunning && data.pending <= 0) {
                    // Jobs finished while we were away — clear the flag
                    sessionStorage.removeItem(SESSION_KEY);
                }
            } catch  {
            // ignore
            }
        };
        loadStats();
        return ()=>{
            cancelled = true;
            stopPolling();
        };
    }, [
        collectionSlug,
        pollProgress,
        startPolling,
        stopPolling
    ]);
    // Refresh stats when regeneration finishes (isRunning transitions from true to false)
    useEffect(()=>{
        if (prevIsRunningRef.current && !isRunning) {
            fetchStats();
        }
        prevIsRunningRef.current = isRunning;
    }, [
        isRunning,
        fetchStats
    ]);
    // Phase 1: Show confirmation with counts
    const handlePreflight = async ()=>{
        if (!collectionSlug) return;
        setError(null);
        // Refresh stats to get the latest counts before confirming
        await fetchStats();
        setConfirming(true);
    };
    const handleCancel = ()=>{
        setConfirming(false);
    };
    // Phase 2: Actually start regeneration (after user confirms)
    const handleConfirm = async ()=>{
        if (!collectionSlug) return;
        setConfirming(false);
        setError(null);
        setStalled(false);
        setIsRunning(true);
        setQueued(null);
        setProgress(null);
        stallRef.current = {
            lastProcessed: 0,
            stallCount: 0
        };
        try {
            const requestBody = {
                collectionSlug,
                force
            };
            if (hasSelection) {
                requestBody.docIds = getSelectedIds().map(String);
            }
            const res = await fetch('/api/image-optimizer/regenerate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to start regeneration');
            }
            const data = await res.json();
            setQueued(data.queued);
            if (data.queued === 0) {
                setIsRunning(false);
                return;
            }
            // Persist running state so we can resume after page navigation
            sessionStorage.setItem(SESSION_KEY, collectionSlug);
            // Start polling
            startPolling(pollProgress);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setIsRunning(false);
        }
    };
    // Cleanup interval on unmount
    useEffect(()=>{
        return ()=>stopPolling();
    }, [
        stopPolling
    ]);
    if (!collectionSlug) return null;
    const progressPercent = progress && progress.total > 0 ? Math.round((progress.complete + progress.errored) / progress.total * 100) : 0;
    const showProgressBar = isRunning && progress || stalled && progress;
    // Stats computations
    const statsPercent = stats && stats.total > 0 ? Math.round(stats.complete / stats.total * 100) : 0;
    const allOptimized = stats && stats.total > 0 && stats.complete === stats.total;
    return /*#__PURE__*/ _jsxs("div", {
        style: {
            padding: '16px 24px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap'
        },
        children: [
            !confirming && /*#__PURE__*/ _jsx("button", {
                onClick: handlePreflight,
                disabled: isRunning,
                style: {
                    backgroundColor: isRunning ? '#9ca3af' : '#4f46e5',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 16px',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: isRunning ? 'not-allowed' : 'pointer'
                },
                children: isRunning ? 'Processing images...' : hasSelection ? `Regenerate ${selectionCount} Selected` : 'Regenerate All Images'
            }),
            confirming && stats && /*#__PURE__*/ _jsxs("div", {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                },
                children: [
                    /*#__PURE__*/ _jsx("span", {
                        style: {
                            fontSize: '13px',
                            color: '#374151'
                        },
                        children: hasSelection ? `Regenerate ${selectionCount} selected image${selectionCount !== 1 ? 's' : ''}?` : force ? `Re-process all ${stats.total} images across the entire collection?` : `Regenerate ${stats.pending} unoptimized image${stats.pending !== 1 ? 's' : ''} across the entire collection?`
                    }),
                    /*#__PURE__*/ _jsx("button", {
                        onClick: handleConfirm,
                        style: {
                            backgroundColor: '#4f46e5',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px 14px',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer'
                        },
                        children: "Confirm"
                    }),
                    /*#__PURE__*/ _jsx("button", {
                        onClick: handleCancel,
                        style: {
                            backgroundColor: 'transparent',
                            color: '#6b7280',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            padding: '6px 14px',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer'
                        },
                        children: "Cancel"
                    })
                ]
            }),
            !confirming && /*#__PURE__*/ _jsxs("label", {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px'
                },
                children: [
                    /*#__PURE__*/ _jsx("input", {
                        type: "checkbox",
                        checked: force,
                        onChange: (e)=>setForce(e.target.checked),
                        disabled: isRunning
                    }),
                    "Force re-process all"
                ]
            }),
            error && /*#__PURE__*/ _jsx("span", {
                style: {
                    color: '#ef4444',
                    fontSize: '13px'
                },
                children: error
            }),
            queued !== null && queued > 0 && isRunning && !confirming && /*#__PURE__*/ _jsxs("span", {
                style: {
                    color: '#4f46e5',
                    fontSize: '13px'
                },
                children: [
                    "Queued ",
                    queued,
                    " image",
                    queued !== 1 ? 's' : '',
                    " for processing"
                ]
            }),
            queued === 0 && !isRunning && !stalled && !confirming && /*#__PURE__*/ _jsx("span", {
                style: {
                    color: '#10b981',
                    fontSize: '13px'
                },
                children: "All images already optimized."
            }),
            stalled && progress && /*#__PURE__*/ _jsxs("span", {
                style: {
                    color: '#f59e0b',
                    fontSize: '13px'
                },
                children: [
                    "Processing appears slow — ",
                    progress.pending,
                    " image",
                    progress.pending !== 1 ? 's' : '',
                    " still pending. Jobs may still be running server-side."
                ]
            }),
            showProgressBar && /*#__PURE__*/ _jsxs("div", {
                style: {
                    flex: 1,
                    minWidth: '200px'
                },
                children: [
                    /*#__PURE__*/ _jsxs("div", {
                        style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '12px',
                            marginBottom: '4px'
                        },
                        children: [
                            /*#__PURE__*/ _jsxs("span", {
                                children: [
                                    progress.complete,
                                    " / ",
                                    progress.total,
                                    " complete"
                                ]
                            }),
                            progress.errored > 0 && /*#__PURE__*/ _jsxs("span", {
                                style: {
                                    color: '#ef4444'
                                },
                                children: [
                                    progress.errored,
                                    " errors"
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("span", {
                                children: [
                                    progressPercent,
                                    "%"
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        style: {
                            height: '6px',
                            backgroundColor: '#e5e7eb',
                            borderRadius: '3px',
                            overflow: 'hidden',
                            display: 'flex'
                        },
                        children: [
                            /*#__PURE__*/ _jsx("div", {
                                style: {
                                    height: '100%',
                                    width: `${progress.total > 0 ? Math.round(progress.complete / progress.total * 100) : 0}%`,
                                    backgroundColor: '#10b981',
                                    transition: 'width 0.3s ease'
                                }
                            }),
                            progress.errored > 0 && /*#__PURE__*/ _jsx("div", {
                                style: {
                                    height: '100%',
                                    width: `${progress.total > 0 ? Math.round(progress.errored / progress.total * 100) : 0}%`,
                                    backgroundColor: '#ef4444',
                                    transition: 'width 0.3s ease'
                                }
                            })
                        ]
                    })
                ]
            }),
            !isRunning && !stalled && progress && progress.complete > 0 && queued !== 0 && !confirming && /*#__PURE__*/ _jsxs("span", {
                style: {
                    fontSize: '13px'
                },
                children: [
                    /*#__PURE__*/ _jsxs("span", {
                        style: {
                            color: progress.errored > 0 ? '#f59e0b' : '#10b981'
                        },
                        children: [
                            "Done! ",
                            progress.complete,
                            "/",
                            progress.total,
                            " optimized (across entire collection)."
                        ]
                    }),
                    progress.errored > 0 && /*#__PURE__*/ _jsxs("span", {
                        style: {
                            color: '#ef4444'
                        },
                        children: [
                            ' ',
                            progress.errored,
                            " failed."
                        ]
                    })
                ]
            }),
            !isRunning && !stalled && stats && stats.total > 0 && /*#__PURE__*/ _jsxs("div", {
                style: {
                    marginLeft: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: '4px',
                    minWidth: '180px'
                },
                children: [
                    /*#__PURE__*/ _jsx("div", {
                        style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '13px'
                        },
                        children: allOptimized ? /*#__PURE__*/ _jsxs("span", {
                            style: {
                                color: '#10b981'
                            },
                            children: [
                                "✓ All ",
                                stats.total,
                                " images optimized"
                            ]
                        }) : /*#__PURE__*/ _jsxs(_Fragment, {
                            children: [
                                /*#__PURE__*/ _jsxs("span", {
                                    style: {
                                        color: '#6b7280'
                                    },
                                    children: [
                                        stats.complete,
                                        "/",
                                        stats.total,
                                        " optimized"
                                    ]
                                }),
                                stats.errored > 0 && /*#__PURE__*/ _jsxs(_Fragment, {
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            style: {
                                                color: '#d1d5db'
                                            },
                                            children: "·"
                                        }),
                                        /*#__PURE__*/ _jsxs("span", {
                                            style: {
                                                color: '#ef4444'
                                            },
                                            children: [
                                                stats.errored,
                                                " errors"
                                            ]
                                        })
                                    ]
                                })
                            ]
                        })
                    }),
                    !allOptimized && /*#__PURE__*/ _jsx("div", {
                        style: {
                            width: '100%',
                            height: '3px',
                            backgroundColor: '#e5e7eb',
                            borderRadius: '2px',
                            overflow: 'hidden'
                        },
                        children: /*#__PURE__*/ _jsx("div", {
                            style: {
                                height: '100%',
                                width: `${statsPercent}%`,
                                backgroundColor: stats.errored > 0 ? '#f59e0b' : '#10b981',
                                borderRadius: '2px',
                                transition: 'width 0.3s ease'
                            }
                        })
                    })
                ]
            })
        ]
    });
};

//# sourceMappingURL=RegenerationButton.js.map