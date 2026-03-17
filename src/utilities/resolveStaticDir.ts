import path from 'path'

export function resolveStaticDir(collectionConfig: { upload?: boolean | Record<string, any> }): string {
  let staticDir =
    typeof collectionConfig.upload === 'object' ? collectionConfig.upload.staticDir || '' : ''

  if (staticDir && !path.isAbsolute(staticDir)) {
    staticDir = path.resolve(process.cwd(), staticDir)
  }

  return staticDir
}
