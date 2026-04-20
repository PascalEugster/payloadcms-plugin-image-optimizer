const resolveRegenerateButton = (value)=>{
    if (value === false) return {
        enabled: false,
        allowForceAll: false
    };
    if (value === true || value == null) return {
        enabled: true,
        allowForceAll: false
    };
    return {
        enabled: value.enabled ?? true,
        allowForceAll: value.allowForceAll ?? false
    };
};
export const resolveConfig = (config)=>({
        adminThumbnail: config.adminThumbnail ?? 'auto',
        clientOptimization: config.clientOptimization ?? true,
        collections: config.collections,
        disabled: config.disabled ?? false,
        formats: config.formats ?? [
            {
                format: 'webp',
                quality: 80
            }
        ],
        generateFilename: config.generateFilename,
        generateThumbHash: config.generateThumbHash ?? true,
        maxDimensions: config.maxDimensions ?? {
            width: 2560,
            height: 2560
        },
        metadataPolicy: config.metadataPolicy,
        regenerateButton: resolveRegenerateButton(config.regenerateButton),
        replaceOriginal: config.replaceOriginal ?? true,
        responseHeaders: config.responseHeaders ?? false,
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