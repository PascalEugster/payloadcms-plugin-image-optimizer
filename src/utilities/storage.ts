import fs from 'fs/promises'
import path from 'path'

import { resolveStaticDir } from './resolveStaticDir.js'

/**
 * Returns true when the collection uses cloud/external storage (disableLocalStorage: true).
 * When true, files are uploaded by external adapter hooks — no local FS writes should happen.
 */
export function isCloudStorage(collectionConfig: { upload?: boolean | Record<string, any> }): boolean {
  return typeof collectionConfig.upload === 'object' && collectionConfig.upload.disableLocalStorage === true
}

/**
 * Reads a file buffer from local disk or fetches it from URL.
 * Tries local disk first (when available), falls back to URL fetch.
 * This makes the plugin storage-agnostic — works with local FS and cloud storage alike.
 *
 * `serverURL` is used as the base when `doc.url` is relative. Callers should
 * pass `req.payload.config.serverURL` so the plugin stays framework-agnostic.
 * `NEXT_PUBLIC_SERVER_URL` is kept as a fallback for backwards compatibility
 * with legacy callers that predate this parameter.
 */
export async function fetchFileBuffer(
  doc: { filename?: string; url?: string },
  collectionConfig: { upload?: boolean | Record<string, any> },
  serverURL?: string,
): Promise<Buffer> {
  const safeFilename = doc.filename ? path.basename(doc.filename) : undefined

  // Try local disk first (only when local storage is enabled)
  if (!isCloudStorage(collectionConfig) && safeFilename) {
    const staticDir = resolveStaticDir(collectionConfig)
    if (staticDir) {
      try {
        return await fs.readFile(path.join(staticDir, safeFilename))
      } catch {
        // Fall through to URL fetch
      }
    }
  }

  // Fetch from URL (works for cloud storage and as fallback for local)
  if (doc.url) {
    const baseURL = serverURL || process.env.NEXT_PUBLIC_SERVER_URL || ''
    const url = doc.url.startsWith('http') ? doc.url : `${baseURL}${doc.url}`

    if (!url.startsWith('http')) {
      throw new Error(
        `Cannot fetch file "${doc.filename}": URL "${doc.url}" is relative and no serverURL is configured (pass payload.config.serverURL or set NEXT_PUBLIC_SERVER_URL)`,
      )
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      throw new Error(`Failed to fetch file from ${url}: ${response.status} ${response.statusText}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  throw new Error(`Cannot read file: no local path or URL available for "${doc.filename}"`)
}
