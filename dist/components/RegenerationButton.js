'use client';
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useEffect, useCallback, useRef } from 'react';
const STALL_THRESHOLD = 5;
export const RegenerationButton = ()=>{
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [queued, setQueued] = useState(null);
    const [force, setForce] = useState(false);
    const [error, setError] = useState(null);
    const [stalled, setStalled] = useState(false);
    const [collectionSlug, setCollectionSlug] = useState(null);
    const [stats, setStats] = useState(null);
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
                    stopPolling();
                    return;
                }
                // Stall detection
                const processed = data.complete + data.errored;
                if (processed === stallRef.current.lastProcessed) {
                    stallRef.current.stallCount += 1;
                } else {
                    stallRef.current.stallCount = 0;
                    stallRef.current.lastProcessed = processed;
                }
                if (stallRef.current.stallCount >= STALL_THRESHOLD) {
                    stopPolling();
                    setIsRunning(false);
                    setStalled(true);
                }
            }
        } catch  {
        // ignore polling errors
        }
    }, [
        collectionSlug,
        stopPolling
    ]);
    // On mount (once collectionSlug is known), check if there's an ongoing job and resume polling
    useEffect(()=>{
        if (!collectionSlug) return;
        let cancelled = false;
        const checkOngoing = async ()=>{
            try {
                const res = await fetch(`/api/image-optimizer/regenerate?collection=${collectionSlug}`);
                if (!res.ok || cancelled) return;
                const data = await res.json();
                // Always store stats on mount
                setStats(data);
                if (data.pending > 0) {
                    setProgress(data);
                    setIsRunning(true);
                    setStalled(false);
                    setQueued(null);
                    stallRef.current = {
                        lastProcessed: data.complete + data.errored,
                        stallCount: 0
                    };
                    intervalRef.current = setInterval(pollProgress, 2000);
                }
            } catch  {
            // ignore
            }
        };
        checkOngoing();
        return ()=>{
            cancelled = true;
        };
    }, [
        collectionSlug,
        pollProgress
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
    const handleRegenerate = async ()=>{
        if (!collectionSlug) return;
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
            const res = await fetch('/api/image-optimizer/regenerate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    collectionSlug,
                    force
                })
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
            // Start polling
            intervalRef.current = setInterval(pollProgress, 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setIsRunning(false);
        }
    };
    // Cleanup interval on unmount
    useEffect(()=>{
        return ()=>{
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);
    if (!collectionSlug) return null;
    const progressPercent = progress && progress.total > 0 ? Math.round(progress.complete / progress.total * 100) : 0;
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
            /*#__PURE__*/ _jsx("button", {
                onClick: handleRegenerate,
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
                children: isRunning ? 'Regenerating...' : 'Regenerate Images'
            }),
            /*#__PURE__*/ _jsxs("label", {
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
            queued === 0 && !isRunning && !stalled && /*#__PURE__*/ _jsx("span", {
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
                    "Process stalled. ",
                    progress.pending,
                    " image",
                    progress.pending !== 1 ? 's' : '',
                    " failed to process."
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
                    /*#__PURE__*/ _jsx("div", {
                        style: {
                            height: '6px',
                            backgroundColor: '#e5e7eb',
                            borderRadius: '3px',
                            overflow: 'hidden'
                        },
                        children: /*#__PURE__*/ _jsx("div", {
                            style: {
                                height: '100%',
                                width: `${progressPercent}%`,
                                backgroundColor: stalled ? '#f59e0b' : '#10b981',
                                borderRadius: '3px',
                                transition: 'width 0.3s ease'
                            }
                        })
                    })
                ]
            }),
            !isRunning && !stalled && progress && progress.complete > 0 && queued !== 0 && /*#__PURE__*/ _jsxs("span", {
                style: {
                    fontSize: '13px'
                },
                children: [
                    /*#__PURE__*/ _jsxs("span", {
                        style: {
                            color: '#10b981'
                        },
                        children: [
                            "Done! ",
                            progress.complete,
                            "/",
                            progress.total,
                            " optimized."
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
            !isRunning && stats && stats.total > 0 && /*#__PURE__*/ _jsxs("div", {
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