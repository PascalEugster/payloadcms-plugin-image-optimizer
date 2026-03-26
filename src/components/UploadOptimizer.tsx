'use client'

import React, { useCallback, useEffect, useRef } from 'react'
import { Upload, useDocumentInfo, useField } from '@payloadcms/ui'

const MAX_WIDTH = 2560
const MAX_HEIGHT = 2560
const JPEG_QUALITY = 0.85

const RESIZABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
])

async function resizeImage(file: File): Promise<File> {
  if (!RESIZABLE_TYPES.has(file.type)) return file

  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap

  if (width <= MAX_WIDTH && height <= MAX_HEIGHT) {
    bitmap.close()
    return file
  }

  const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height)
  const targetWidth = Math.round(width * ratio)
  const targetHeight = Math.round(height * ratio)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()

  // Keep PNG for transparency, convert everything else to JPEG
  const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const quality = outputType === 'image/jpeg' ? JPEG_QUALITY : undefined
  const ext = outputType === 'image/png' ? 'png' : 'jpg'

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), outputType, quality)
  })

  const baseName = file.name.replace(/\.[^.]+$/, '')
  return new File([blob], `${baseName}.${ext}`, {
    type: outputType,
    lastModified: Date.now(),
  })
}

export const UploadOptimizer: React.FC = () => {
  const { collectionSlug, docConfig, initialState } = useDocumentInfo()
  const uploadConfig = docConfig && 'upload' in docConfig ? docConfig.upload : undefined
  const { value: fileValue, setValue: setFileValue } = useField<File | null>({ path: 'file' })
  const processedFiles = useRef(new WeakSet<File>())

  const handleResize = useCallback(async (file: File): Promise<File> => {
    return resizeImage(file)
  }, [])

  useEffect(() => {
    if (!fileValue || !(fileValue instanceof File)) return
    if (processedFiles.current.has(fileValue)) return

    let cancelled = false

    handleResize(fileValue).then((resized) => {
      if (cancelled) return
      processedFiles.current.add(resized)
      if (resized !== fileValue) {
        setFileValue(resized)
      }
    })

    return () => {
      cancelled = true
    }
  }, [fileValue, handleResize, setFileValue])

  if (!collectionSlug || !uploadConfig) return null

  return (
    <Upload
      collectionSlug={collectionSlug}
      initialState={initialState}
      uploadConfig={uploadConfig}
    />
  )
}
