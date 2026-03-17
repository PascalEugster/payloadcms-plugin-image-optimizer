export const resolveConfig = (config)=>({
        collections: config.collections,
        disabled: config.disabled ?? false,
        formats: config.formats ?? [
            {
                format: 'webp',
                quality: 80
            }
        ],
        generateThumbHash: config.generateThumbHash ?? true,
        maxDimensions: config.maxDimensions ?? {
            width: 2560,
            height: 2560
        },
        replaceOriginal: config.replaceOriginal ?? true,
        stripMetadata: config.stripMetadata ?? true
    });
export const resolveCollectionConfig = (resolvedConfig, collectionSlug)=>{
    const collectionValue = resolvedConfig.collections[collectionSlug];
    if (!collectionValue || collectionValue === true) {
        return {
            formats: resolvedConfig.formats,
            maxDimensions: resolvedConfig.maxDimensions,
            replaceOriginal: resolvedConfig.replaceOriginal
        };
    }
    return {
        formats: collectionValue.formats ?? resolvedConfig.formats,
        maxDimensions: collectionValue.maxDimensions ?? resolvedConfig.maxDimensions,
        replaceOriginal: collectionValue.replaceOriginal ?? resolvedConfig.replaceOriginal
    };
};

//# sourceMappingURL=defaults.js.map