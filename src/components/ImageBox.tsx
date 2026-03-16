'use client'

import React from 'react'
import NextImage, { type ImageProps } from 'next/image'
import { thumbHashToDataURL } from 'thumbhash'

type ImageOptimizerData = {
  thumbHash?: string | null
}

type MediaResource = {
  url?: string | null
  alt?: string | null
  width?: number | null
  height?: number | null
  filename?: string | null
  focalX?: number | null
  focalY?: number | null
  imageOptimizer?: ImageOptimizerData | null
  updatedAt?: string
}

export interface ImageBoxProps extends Omit<ImageProps, 'src' | 'alt'> {
  media: MediaResource | string
  alt?: string
}

export const ImageBox: React.FC<ImageBoxProps> = ({
  media,
  alt: altFromProps,
  fill,
  sizes,
  priority,
  loading: loadingFromProps,
  ...props
}) => {
  const loading = priority ? undefined : (loadingFromProps ?? 'lazy')

  if (typeof media === 'string') {
    return (
      <NextImage
        {...props}
        src={media}
        alt={altFromProps || ''}
        quality={80}
        fill={fill}
        sizes={sizes}
        style={{ objectFit: 'cover', objectPosition: 'center' }}
        priority={priority}
        loading={loading}
      />
    )
  }

  const width = media.width ?? undefined
  const height = media.height ?? undefined
  const alt = altFromProps || (media as any).alt || media.filename || ''
  const src = media.url ? `${media.url}${media.updatedAt ? `?${media.updatedAt}` : ''}` : ''

  const objectPosition =
    media.focalX != null && media.focalY != null
      ? `${media.focalX}% ${media.focalY}%`
      : 'center'

  // Decode thumbhash to data URL for blur placeholder
  const thumbHashUrl = React.useMemo(() => {
    const thumbHash = media.imageOptimizer?.thumbHash
    if (!thumbHash) return null
    try {
      const bytes = Uint8Array.from(atob(thumbHash), (c) => c.charCodeAt(0))
      return thumbHashToDataURL(bytes)
    } catch {
      return null
    }
  }, [media.imageOptimizer?.thumbHash])

  return (
    <NextImage
      {...props}
      src={src}
      alt={alt}
      quality={80}
      fill={fill}
      width={!fill ? width : undefined}
      height={!fill ? height : undefined}
      sizes={sizes}
      style={{ objectFit: 'cover', objectPosition }}
      placeholder={thumbHashUrl ? 'blur' : 'empty'}
      blurDataURL={thumbHashUrl || undefined}
      priority={priority}
      loading={loading}
    />
  )
}
