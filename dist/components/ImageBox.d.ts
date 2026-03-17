import React from 'react';
import { type ImageProps } from 'next/image';
import type { MediaResource } from '../types.js';
export interface ImageBoxProps extends Omit<ImageProps, 'src' | 'alt'> {
    media: MediaResource | string;
    alt?: string;
}
export declare const ImageBox: React.FC<ImageBoxProps>;
