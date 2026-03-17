import type { MediaResource } from '../types.js';
export type ImageOptimizerProps = {
    placeholder: 'blur' | 'empty';
    blurDataURL?: string;
    style: {
        objectPosition: string;
    };
};
/**
 * Extracts image optimization props from a Payload media resource.
 *
 * Returns props that can be spread onto a Next.js `<Image>` component to add
 * ThumbHash blur placeholders and focal-point-based object positioning.
 *
 * Works with any component — including the Payload website template's `ImageMedia`:
 *
 * ```tsx
 * import { getImageOptimizerProps } from '@inoo-ch/payload-image-optimizer/client'
 *
 * const optimizerProps = getImageOptimizerProps(resource)
 * <NextImage {...existingProps} {...optimizerProps} />
 * ```
 */
export declare function getImageOptimizerProps(resource: MediaResource | null | undefined): ImageOptimizerProps;
