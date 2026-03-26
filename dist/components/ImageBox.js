'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import React, { useMemo, useState } from 'react';
import NextImage from 'next/image';
import { getImageOptimizerProps } from '../utilities/getImageOptimizerProps.js';
import { createVariantLoader, getDefaultSizes } from '../utilities/responsiveImage.js';
export const ImageBox = ({ media, alt: altFromProps, fill, sizes, priority, loading: loadingFromProps, style: styleFromProps, fade = true, fadeDuration = 500, ...props })=>{
    const [loaded, setLoaded] = useState(false);
    const loading = priority ? undefined : loadingFromProps ?? 'lazy';
    const fadeStyle = fade ? {
        filter: loaded ? 'blur(0px)' : 'blur(20px)',
        transition: loaded ? `filter ${fadeDuration}ms ease-in-out` : undefined
    } : undefined;
    if (typeof media === 'string') {
        return /*#__PURE__*/ _jsx(NextImage, {
            ...props,
            src: media,
            alt: altFromProps || '',
            quality: 80,
            fill: fill,
            sizes: sizes ?? getDefaultSizes(fill),
            style: {
                objectFit: 'cover',
                objectPosition: 'center',
                ...fadeStyle,
                ...styleFromProps
            },
            priority: priority,
            loading: loading,
            onLoad: fade ? ()=>setLoaded(true) : undefined
        });
    }
    const width = media.width ?? undefined;
    const height = media.height ?? undefined;
    const alt = altFromProps || media.alt || media.filename || '';
    const src = media.url ? `${media.url}${media.updatedAt ? `?${media.updatedAt}` : ''}` : '';
    const optimizerProps = getImageOptimizerProps(media);
    const variantLoader = useMemo(()=>createVariantLoader(media), [
        media
    ]);
    return /*#__PURE__*/ _jsx(NextImage, {
        ...props,
        src: src,
        alt: alt,
        quality: 80,
        fill: fill,
        width: !fill ? width : undefined,
        height: !fill ? height : undefined,
        sizes: sizes ?? getDefaultSizes(fill),
        loader: variantLoader,
        style: {
            objectFit: 'cover',
            ...optimizerProps.style,
            ...fadeStyle,
            ...styleFromProps
        },
        placeholder: optimizerProps.placeholder,
        blurDataURL: optimizerProps.blurDataURL,
        priority: priority,
        loading: loading,
        onLoad: fade ? ()=>setLoaded(true) : undefined
    });
};

//# sourceMappingURL=ImageBox.js.map