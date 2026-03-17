'use client';
import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import NextImage from 'next/image';
import { getImageOptimizerProps } from '../utilities/getImageOptimizerProps.js';
export const ImageBox = ({ media, alt: altFromProps, fill, sizes, priority, loading: loadingFromProps, style: styleFromProps, ...props })=>{
    const loading = priority ? undefined : loadingFromProps ?? 'lazy';
    if (typeof media === 'string') {
        return /*#__PURE__*/ _jsx(NextImage, {
            ...props,
            src: media,
            alt: altFromProps || '',
            quality: 80,
            fill: fill,
            sizes: sizes,
            style: {
                objectFit: 'cover',
                objectPosition: 'center',
                ...styleFromProps
            },
            priority: priority,
            loading: loading
        });
    }
    const width = media.width ?? undefined;
    const height = media.height ?? undefined;
    const alt = altFromProps || media.alt || media.filename || '';
    const src = media.url ? `${media.url}${media.updatedAt ? `?${media.updatedAt}` : ''}` : '';
    const optimizerProps = getImageOptimizerProps(media);
    return /*#__PURE__*/ _jsx(NextImage, {
        ...props,
        src: src,
        alt: alt,
        quality: 80,
        fill: fill,
        width: !fill ? width : undefined,
        height: !fill ? height : undefined,
        sizes: sizes,
        style: {
            objectFit: 'cover',
            ...optimizerProps.style,
            ...styleFromProps
        },
        placeholder: optimizerProps.placeholder,
        blurDataURL: optimizerProps.blurDataURL,
        priority: priority,
        loading: loading
    });
};

//# sourceMappingURL=ImageBox.js.map