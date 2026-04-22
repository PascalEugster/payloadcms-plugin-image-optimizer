const DEFAULT_FORMAT = {
    format: 'webp',
    quality: 80
};
const resolveRegenerateButton = (value)=>{
    if (value === false) {
        return {
            allowForceAll: false,
            enabled: false
        };
    }
    if (value === true || value == null) {
        return {
            allowForceAll: false,
            enabled: true
        };
    }
    return {
        allowForceAll: value.allowForceAll ?? false,
        enabled: value.enabled ?? true
    };
};
const LOGGING_PRESETS = {
    normal: {
        errors: true,
        includeDocDetails: false,
        lifecycle: true,
        skips: {
            docDeleted: false,
            notImage: false,
            userCancelled: true
        }
    },
    silent: {
        errors: true,
        includeDocDetails: false,
        lifecycle: false,
        skips: {
            docDeleted: false,
            notImage: false,
            userCancelled: false
        }
    },
    verbose: {
        errors: true,
        includeDocDetails: true,
        lifecycle: true,
        skips: {
            docDeleted: true,
            notImage: true,
            userCancelled: true
        }
    }
};
const resolveSkips = (value, base)=>{
    if (value === true) {
        return {
            docDeleted: true,
            notImage: true,
            userCancelled: true
        };
    }
    if (value === false) {
        return {
            docDeleted: false,
            notImage: false,
            userCancelled: false
        };
    }
    if (value == null) {
        return base;
    }
    return {
        docDeleted: value.docDeleted ?? base.docDeleted,
        notImage: value.notImage ?? base.notImage,
        userCancelled: value.userCancelled ?? base.userCancelled
    };
};
/**
 * Resolves the `logging` option against preset baselines.
 *
 * - `undefined` → `'silent'` preset (errors-only, no lifecycle noise).
 * - `LoggingMode` → matching preset.
 * - `LoggingConfig` → merged field-by-field over the `'silent'` preset, with
 *   `skips` accepting a boolean shorthand or the per-reason object.
 *
 * Errors default on in every preset but can still be explicitly disabled via
 * the object form (`{ errors: false }`) for consumers that route task-boundary
 * errors through a different log pipeline.
 */ export const resolveLogging = (value)=>{
    if (value == null) {
        return LOGGING_PRESETS.silent;
    }
    if (typeof value === 'string') {
        return LOGGING_PRESETS[value];
    }
    const base = LOGGING_PRESETS.silent;
    return {
        errors: value.errors ?? base.errors,
        includeDocDetails: value.includeDocDetails ?? base.includeDocDetails,
        lifecycle: value.lifecycle ?? base.lifecycle,
        skips: resolveSkips(value.skips, base.skips)
    };
};
export const resolveConfig = (config)=>({
        adminThumbnail: config.adminThumbnail ?? 'auto',
        clientOptimization: config.clientOptimization ?? true,
        collections: config.collections,
        disabled: config.disabled ?? false,
        format: config.format === null ? null : config.format ?? DEFAULT_FORMAT,
        generateFilename: config.generateFilename,
        generateThumbHash: config.generateThumbHash ?? true,
        logging: resolveLogging(config.logging),
        maxDimensions: config.maxDimensions ?? {
            height: 2560,
            width: 2560
        },
        metadataPolicy: config.metadataPolicy,
        regenerateButton: resolveRegenerateButton(config.regenerateButton),
        regenerateUseTransactions: config.regenerateUseTransactions ?? false,
        responseHeaders: config.responseHeaders ?? false,
        storeBlurDataURL: config.storeBlurDataURL ?? false,
        stripMetadata: config.stripMetadata ?? true
    });
export const resolveCollectionConfig = (resolvedConfig, collectionSlug)=>{
    const collectionValue = resolvedConfig.collections[collectionSlug];
    if (!collectionValue || collectionValue === true) {
        return {
            format: resolvedConfig.format,
            maxDimensions: resolvedConfig.maxDimensions
        };
    }
    return {
        format: collectionValue.format ?? resolvedConfig.format,
        maxDimensions: collectionValue.maxDimensions ?? resolvedConfig.maxDimensions
    };
};

//# sourceMappingURL=defaults.js.map