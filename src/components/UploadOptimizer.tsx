'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, useDocumentInfo, useField, useTranslation } from '@payloadcms/ui'

import { resizeImage } from '../utilities/clientResize.js'

export const UploadOptimizer: React.FC = () => {
  const { collectionSlug, docConfig, initialState, setUploadStatus } = useDocumentInfo()
  const uploadConfig = docConfig && 'upload' in docConfig ? docConfig.upload : undefined
  const { value: fileValue, setValue: setFileValue } = useField<File | null>({ path: 'file' })
  // Record the true pre-resize byte count so the server can report accurate
  // savings. Without this, `beforeOperation` would only see the post-canvas
  // buffer and `originalSize` would equal the browser-compressed size, making
  // the admin UI stat silently under-report the full optimization win.
  const { setValue: setReportedOriginalSize } = useField<number | null>({
    path: 'imageOptimizer.originalSize',
  })
  const processedFiles = useRef(new WeakSet<File>())
  const [optimizing, setOptimizing] = useState(false)
  const { t } = useTranslation()
  const optimizingLabel =
    (t as unknown as (key: string) => string)('plugin-imageOptimizer:optimizing') ||
    'Optimizing image…'

  const handleResize = useCallback(async (file: File): Promise<File> => {
    return resizeImage(file)
  }, [])

  useEffect(() => {
    if (!fileValue || !(fileValue instanceof File)) return
    if (processedFiles.current.has(fileValue)) return

    let cancelled = false
    // Payload's SaveButton short-circuits when uploadStatus === 'uploading',
    // so Save is blocked until the resize completes. Without this, submit
    // captures the field snapshot before setFileValue(resized) lands, and
    // either the original oversized file is sent, or (on Vercel) an empty
    // body reaches /api/media and returns 400.
    setUploadStatus?.('uploading')
    setOptimizing(true)

    // Snapshot the byte count BEFORE canvas touches the file. Written whether
    // or not resize actually fires — if the file is small/non-resizable this
    // just equals the server-received size, which is also the correct
    // `originalSize`. Server reads this back in `beforeChange` with a
    // guardrail.
    const preResizeSize = fileValue.size
    setReportedOriginalSize(preResizeSize)

    handleResize(fileValue)
      .then((resized) => {
        if (cancelled) return
        processedFiles.current.add(resized)
        if (resized !== fileValue) {
          setFileValue(resized)
        }
      })
      .catch(() => {
        // Defensive — resizeImage already catches its own errors and falls
        // back to the original, but treat an unexpected throw as "let the
        // original through" rather than leaving Save blocked forever.
      })
      .finally(() => {
        if (cancelled) return
        setOptimizing(false)
        setUploadStatus?.('idle')
      })

    return () => {
      cancelled = true
      // Ensure Save is re-enabled if the component unmounts mid-resize.
      setUploadStatus?.('idle')
    }
  }, [fileValue, handleResize, setFileValue, setReportedOriginalSize, setUploadStatus])

  if (!collectionSlug || !uploadConfig) return null

  return (
    <>
      <Upload
        collectionSlug={collectionSlug}
        initialState={initialState}
        uploadConfig={uploadConfig}
      />
      {optimizing && (
        <div
          style={{
            fontSize: 12,
            color: '#6b7280',
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          role="status"
          aria-live="polite"
        >
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              border: '2px solid #d1d5db',
              borderTopColor: '#4f46e5',
              borderRadius: '50%',
              animation: 'imageOptimizerSpin 0.8s linear infinite',
            }}
          />
          {optimizingLabel}
          <style>{`@keyframes imageOptimizerSpin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </>
  )
}
