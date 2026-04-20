import path from 'path'
import { loadEnv } from 'payload/node'
import { fileURLToPath } from 'url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default defineConfig(() => {
  loadEnv(path.resolve(dirname, './dev'))

  return {
    plugins: [
      tsconfigPaths({
        ignoreConfigErrors: true,
      }),
    ],
    test: {
      environment: 'node',
      hookTimeout: 30_000,
      testTimeout: 30_000,
      include: [
        'dev/int.spec.ts',
        'dev/responsiveImage.unit.spec.ts',
        'dev/regenerateSlugGuard.unit.spec.ts',
        'dev/adminThumbnail.unit.spec.ts',
        'dev/responseHeaders.unit.spec.ts',
        'dev/metadataPolicy.unit.spec.ts',
        'dev/clientResize.unit.spec.ts',
        'dev/filenameStrategies.unit.spec.ts',
      ],
    },
  }
})
