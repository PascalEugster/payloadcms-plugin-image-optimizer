'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { thumbHashToDataURL } from 'thumbhash';
import { useAllFormFields, useDocumentInfo } from '@payloadcms/ui';
const formatBytes = (bytes)=>{
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = [
        'B',
        'KB',
        'MB',
        'GB'
    ];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};
const statusColors = {
    complete: '#10b981',
    error: '#ef4444'
};
const POLL_INTERVAL_MS = 2000;
export const OptimizationStatus = (props)=>{
    const [formState] = useAllFormFields();
    const { collectionSlug, id } = useDocumentInfo();
    const basePath = props.path ?? 'imageOptimizer';
    const formStatus = formState[`${basePath}.status`]?.value;
    const formOriginalSize = formState[`${basePath}.originalSize`]?.value;
    const formOptimizedSize = formState[`${basePath}.optimizedSize`]?.value;
    const formThumbHash = formState[`${basePath}.thumbHash`]?.value;
    const formError = formState[`${basePath}.error`]?.value;
    const [polledData, setPolledData] = React.useState(null);
    const [regenerating, setRegenerating] = React.useState(false);
    const [regenError, setRegenError] = React.useState(null);
    // updatedAt snapshot captured before POSTing a regenerate so we can detect
    // the doc has been re-written (status stays 'complete' throughout, so we
    // can't rely on a status transition to signal completion).
    const regenerateStartRef = React.useRef(null);
    // Poll for status updates only while a regeneration we initiated is in
    // flight. beforeChange now always resolves status to 'complete' or 'error'
    // synchronously, so there's no "non-terminal" state to poll for on upload.
    React.useEffect(()=>{
        if (!regenerating) return;
        if (!collectionSlug || !id) return;
        const controller = new AbortController();
        const poll = async ()=>{
            try {
                const res = await fetch(`/api/${collectionSlug}/${id}?depth=0`, {
                    signal: controller.signal
                });
                if (!res.ok) return;
                const doc = await res.json();
                const optimizer = doc.imageOptimizer;
                if (!optimizer) return;
                setPolledData({
                    status: optimizer.status,
                    originalSize: optimizer.originalSize,
                    optimizedSize: optimizer.optimizedSize,
                    thumbHash: optimizer.thumbHash,
                    error: optimizer.error
                });
                // If a user-initiated regeneration wrote a new revision (updatedAt
                // advanced) and status is terminal, we're done.
                const baseline = regenerateStartRef.current;
                if (regenerating && baseline && typeof doc.updatedAt === 'string' && doc.updatedAt !== baseline && (optimizer.status === 'complete' || optimizer.status === 'error')) {
                    regenerateStartRef.current = null;
                    setRegenerating(false);
                }
            } catch  {
            // Silently ignore fetch errors (abort, network issues)
            }
        };
        const intervalId = setInterval(poll, POLL_INTERVAL_MS);
        // Run immediately on mount
        poll();
        return ()=>{
            controller.abort();
            clearInterval(intervalId);
        };
    }, [
        collectionSlug,
        id,
        regenerating
    ]);
    // Use polled data when available, otherwise fall back to form state
    const status = polledData?.status ?? formStatus;
    const originalSize = polledData?.originalSize ?? formOriginalSize;
    const optimizedSize = polledData?.optimizedSize ?? formOptimizedSize;
    const thumbHash = polledData?.thumbHash ?? formThumbHash;
    const error = polledData?.error ?? formError;
    const thumbHashUrl = React.useMemo(()=>{
        if (!thumbHash) return null;
        try {
            const bytes = Uint8Array.from(atob(thumbHash), (c)=>c.charCodeAt(0));
            return thumbHashToDataURL(bytes);
        } catch  {
            return null;
        }
    }, [
        thumbHash
    ]);
    const handleRegenerate = React.useCallback(async ()=>{
        if (!collectionSlug || !id || regenerating) return;
        setRegenError(null);
        try {
            // Snapshot updatedAt so the poll loop can detect the re-write.
            const baseline = await fetch(`/api/${collectionSlug}/${id}?depth=0`);
            if (baseline.ok) {
                const doc = await baseline.json();
                regenerateStartRef.current = typeof doc.updatedAt === 'string' ? doc.updatedAt : null;
            }
            // Flip to regenerating before the POST so the in-flight state is visible
            // during the network round-trip, not just while the job actually runs.
            setRegenerating(true);
            const res = await fetch('/api/image-optimizer/regenerate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    collectionSlug,
                    docIds: [
                        String(id)
                    ]
                })
            });
            if (!res.ok) {
                const data = await res.json().catch(()=>({}));
                throw new Error(data?.error || `Regenerate request failed (${res.status})`);
            }
        } catch (err) {
            setRegenerating(false);
            regenerateStartRef.current = null;
            setRegenError(err instanceof Error ? err.message : String(err));
        }
    }, [
        collectionSlug,
        id,
        regenerating
    ]);
    const savings = originalSize && optimizedSize ? Math.round((1 - optimizedSize / originalSize) * 100) : null;
    return /*#__PURE__*/ _jsxs("div", {
        style: {
            padding: '12px 0'
        },
        children: [
            status ? /*#__PURE__*/ _jsx("div", {
                style: {
                    marginBottom: '8px'
                },
                children: /*#__PURE__*/ _jsx("span", {
                    style: {
                        backgroundColor: statusColors[status] || '#6b7280',
                        borderRadius: '4px',
                        color: '#fff',
                        display: 'inline-block',
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '2px 8px',
                        textTransform: 'uppercase'
                    },
                    children: status
                })
            }) : /*#__PURE__*/ _jsx("div", {
                style: {
                    color: '#6b7280',
                    fontSize: '13px',
                    marginBottom: '8px'
                },
                children: "No optimization data yet. Click below to optimize."
            }),
            error && /*#__PURE__*/ _jsx("div", {
                style: {
                    color: '#ef4444',
                    fontSize: '13px',
                    marginBottom: '8px'
                },
                children: error
            }),
            originalSize != null && optimizedSize != null && /*#__PURE__*/ _jsxs("div", {
                style: {
                    fontSize: '13px',
                    marginBottom: '8px'
                },
                children: [
                    /*#__PURE__*/ _jsxs("div", {
                        children: [
                            "Original: ",
                            /*#__PURE__*/ _jsx("strong", {
                                children: formatBytes(originalSize)
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        children: [
                            "Optimized: ",
                            /*#__PURE__*/ _jsx("strong", {
                                children: formatBytes(optimizedSize)
                            }),
                            savings != null && savings > 0 && /*#__PURE__*/ _jsxs("span", {
                                style: {
                                    color: '#10b981',
                                    marginLeft: '4px'
                                },
                                children: [
                                    "(-",
                                    savings,
                                    "%)"
                                ]
                            })
                        ]
                    })
                ]
            }),
            thumbHashUrl && /*#__PURE__*/ _jsxs("div", {
                style: {
                    marginBottom: '8px'
                },
                children: [
                    /*#__PURE__*/ _jsx("div", {
                        style: {
                            fontSize: '12px',
                            marginBottom: '4px',
                            opacity: 0.7
                        },
                        children: "Blur Preview"
                    }),
                    /*#__PURE__*/ _jsx("img", {
                        alt: "Blur placeholder",
                        src: thumbHashUrl,
                        style: {
                            borderRadius: '4px',
                            height: '40px',
                            width: 'auto'
                        }
                    })
                ]
            }),
            collectionSlug && id != null && /*#__PURE__*/ _jsxs("div", {
                style: {
                    marginTop: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                },
                children: [
                    /*#__PURE__*/ _jsx("button", {
                        type: "button",
                        onClick: handleRegenerate,
                        disabled: regenerating,
                        style: {
                            alignSelf: 'flex-start',
                            backgroundColor: regenerating ? '#9ca3af' : '#4f46e5',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '12px',
                            fontWeight: 500,
                            cursor: regenerating ? 'wait' : 'pointer'
                        },
                        children: regenerating ? status ? 'Regenerating…' : 'Optimizing…' : status ? 'Regenerate this image' : 'Optimize this image'
                    }),
                    regenError && /*#__PURE__*/ _jsx("span", {
                        style: {
                            color: '#ef4444',
                            fontSize: '12px'
                        },
                        children: regenError
                    })
                ]
            })
        ]
    });
};

//# sourceMappingURL=OptimizationStatus.js.map