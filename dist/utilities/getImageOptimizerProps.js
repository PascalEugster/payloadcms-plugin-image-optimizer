import { thumbHashToDataURL } from 'thumbhash';
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
 */ export function getImageOptimizerProps(resource) {
    if (!resource) {
        return {
            placeholder: 'empty',
            style: {
                objectPosition: 'center'
            }
        };
    }
    const objectPosition = resource.focalX != null && resource.focalY != null ? `${resource.focalX}% ${resource.focalY}%` : 'center';
    const thumbHash = resource.imageOptimizer?.thumbHash;
    if (!thumbHash) {
        return {
            placeholder: 'empty',
            style: {
                objectPosition
            }
        };
    }
    try {
        const bytes = Uint8Array.from(atob(thumbHash), (c)=>c.charCodeAt(0));
        const blurDataURL = thumbHashToDataURL(bytes);
        return {
            placeholder: 'blur',
            blurDataURL,
            style: {
                objectPosition
            }
        };
    } catch  {
        return {
            placeholder: 'empty',
            style: {
                objectPosition
            }
        };
    }
}

//# sourceMappingURL=getImageOptimizerProps.js.map