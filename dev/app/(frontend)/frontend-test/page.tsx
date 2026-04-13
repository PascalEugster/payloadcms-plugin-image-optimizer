import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { ImageBox, FadeImage, getImageOptimizerProps } from '@inoo-ch/payload-image-optimizer/frontend'

export const dynamic = 'force-dynamic'

export default async function FrontendTestPage() {
  const payload = await getPayload({ config: configPromise })
  const { docs } = await payload.find({ collection: 'media', limit: 1 })
  const media = docs[0]

  if (!media) {
    return (
      <main data-testid="frontend-test-root" style={{ padding: 32, fontFamily: 'system-ui' }}>
        <h1>Frontend Entry Point Test</h1>
        <p data-testid="no-media">No media found — upload an image at /admin first.</p>
      </main>
    )
  }

  const optimizerProps = getImageOptimizerProps(media as any)

  return (
    <main data-testid="frontend-test-root" style={{ padding: 32, fontFamily: 'system-ui' }}>
      <h1>Frontend Entry Point Test</h1>
      <p data-testid="import-source">
        Imported from: <code>@inoo-ch/payload-image-optimizer/frontend</code>
      </p>

      <section>
        <h2>ImageBox</h2>
        <div data-testid="imagebox-wrap" style={{ position: 'relative', width: 600, height: 400 }}>
          <ImageBox media={media as any} alt="ImageBox test" fill />
        </div>
      </section>

      <section>
        <h2>FadeImage + getImageOptimizerProps</h2>
        <div data-testid="fadeimage-wrap">
          <FadeImage
            src={(media as any).url ?? ''}
            alt="FadeImage test"
            width={600}
            height={400}
            optimizerProps={optimizerProps}
          />
        </div>
      </section>

      <section>
        <h2>Optimizer props (debug)</h2>
        <pre data-testid="optimizer-props" style={{ background: '#f5f5f5', padding: 12, fontSize: 12 }}>
          {JSON.stringify({ hasBlur: Boolean(optimizerProps.blurDataURL), style: optimizerProps.style }, null, 2)}
        </pre>
      </section>
    </main>
  )
}
