import path from 'path';
export function resolveStaticDir(collectionConfig) {
    let staticDir = typeof collectionConfig.upload === 'object' ? collectionConfig.upload.staticDir || '' : '';
    if (staticDir && !path.isAbsolute(staticDir)) {
        staticDir = path.resolve(process.cwd(), staticDir);
    }
    return staticDir;
}

//# sourceMappingURL=resolveStaticDir.js.map