'use client'

import React, { useMemo, useState } from 'react'
import NextImage, { type ImageProps } from 'next/image'
import type { MediaResource } from '../types.js'
import { getImageOptimizerProps } from '../utilities/getImageOptimizerProps.js'
import { createVariantLoader, getDefaultSizes } from '../utilities/responsiveImage.js'

export interface ImageBoxProps extends Omit<ImageProps, 'src' | 'alt'> {
  media: MediaResource | string
  alt?: string
  /** Enable smooth blur-to-sharp fade transition on load. Defaults to `true`. */
  fade?: boolean
  /** Duration of the fade animation in milliseconds. Defaults to `500`. */
  fadeDuration?: number
}

export const ImageBox: React.FC<ImageBoxProps> = ({
  media,
  alt: altFromProps,
  fill,
  sizes,
  priority,
  loading: loadingFromProps,
  style: styleFromProps,
  fade = true,
  fadeDuration = 500,
  ...props
}) => {
  const [loaded, setLoaded] = useState(false)
  const loading = priority ? undefined : (loadingFromProps ?? 'lazy')

  const fadeStyle = fade
    ? {
        filter: loaded ? 'blur(0px)' : 'blur(20px)',
        transition: loaded ? `filter ${fadeDuration}ms ease-in-out` : undefined,
      }
    : undefined

  if (typeof media === 'string') {
    return (
      <NextImage
        {...props}
        src={media}
        alt={altFromProps || ''}
        quality={80}
        fill={fill}
        sizes={sizes ?? getDefaultSizes(fill)}
        style={{ objectFit: 'cover', objectPosition: 'center', ...fadeStyle, ...styleFromProps }}
        priority={priority}
        loading={loading}
        onLoad={fade ? () => setLoaded(true) : undefined}
      />
    )
  }

  const width = media.width ?? undefined
  const height = media.height ?? undefined
  const alt = altFromProps || (media as any).alt || media.filename || ''
  const src = media.url ? `${media.url}${media.updatedAt ? `?${media.updatedAt}` : ''}` : ''

  const optimizerProps = getImageOptimizerProps(media)
  const variantLoader = useMemo(() => createVariantLoader(media), [media])

  return (
    <NextImage
      {...props}
      src={src}
      alt={alt}
      quality={80}
      fill={fill}
      width={!fill ? width : undefined}
      height={!fill ? height : undefined}
      sizes={sizes ?? getDefaultSizes(fill)}
      loader={variantLoader}
      style={{ objectFit: 'cover', ...optimizerProps.style, ...fadeStyle, ...styleFromProps }}
      placeholder={optimizerProps.placeholder}
      blurDataURL={optimizerProps.blurDataURL}
      priority={priority}
      loading={loading}
      onLoad={fade ? () => setLoaded(true) : undefined}
    />
  )
}
