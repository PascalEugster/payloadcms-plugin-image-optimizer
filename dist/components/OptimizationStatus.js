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
    pending: '#f59e0b',
    processing: '#3b82f6',
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
    // Reset polled data when a new upload changes the form status back to pending
    React.useEffect(()=>{
        if (formStatus === 'pending') {
            setPolledData(null);
        }
    }, [
        formStatus
    ]);
    // Poll for status updates when status is non-terminal
    React.useEffect(()=>{
        const currentStatus = polledData?.status ?? formStatus;
        if (!currentStatus || currentStatus === 'complete' || currentStatus === 'error') return;
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
                    error: optimizer.error,
                    variants: optimizer.variants
                });
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
        polledData?.status,
        formStatus,
        collectionSlug,
        id
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
    // Read variants from polled data or form state
    const variants = React.useMemo(()=>{
        if (polledData?.variants) return polledData.variants;
        const variantsField = formState[`${basePath}.variants`];
        const rowCount = variantsField?.rows?.length ?? 0;
        const formVariants = [];
        for(let i = 0; i < rowCount; i++){
            formVariants.push({
                format: formState[`${basePath}.variants.${i}.format`]?.value,
                filename: formState[`${basePath}.variants.${i}.filename`]?.value,
                filesize: formState[`${basePath}.variants.${i}.filesize`]?.value,
                width: formState[`${basePath}.variants.${i}.width`]?.value,
                height: formState[`${basePath}.variants.${i}.height`]?.value
            });
        }
        return formVariants;
    }, [
        polledData?.variants,
        formState,
        basePath
    ]);
    if (!status) {
        return /*#__PURE__*/ _jsx("div", {
            style: {
                padding: '12px 0'
            },
            children: /*#__PURE__*/ _jsx("div", {
                style: {
                    color: '#6b7280',
                    fontSize: '13px'
                },
                children: "No optimization data yet. Upload an image to optimize."
            })
        });
    }
    const savings = originalSize && optimizedSize ? Math.round((1 - optimizedSize / originalSize) * 100) : null;
    return /*#__PURE__*/ _jsxs("div", {
        style: {
            padding: '12px 0'
        },
        children: [
            /*#__PURE__*/ _jsx("div", {
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
            variants.length > 0 && /*#__PURE__*/ _jsxs("div", {
                children: [
                    /*#__PURE__*/ _jsx("div", {
                        style: {
                            fontSize: '12px',
                            marginBottom: '4px',
                            opacity: 0.7
                        },
                        children: "Variants"
                    }),
                    variants.map((v, i)=>/*#__PURE__*/ _jsxs("div", {
                            style: {
                                fontSize: '12px',
                                marginBottom: '2px'
                            },
                            children: [
                                /*#__PURE__*/ _jsx("strong", {
                                    children: v.format?.toUpperCase()
                                }),
                                " — ",
                                v.filesize ? formatBytes(v.filesize) : '?',
                                ' ',
                                "(",
                                v.width,
                                "x",
                                v.height,
                                ")"
                            ]
                        }, i))
                ]
            })
        ]
    });
};

//# sourceMappingURL=OptimizationStatus.js.map