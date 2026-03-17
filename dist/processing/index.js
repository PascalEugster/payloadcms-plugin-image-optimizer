import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
export async function stripAndResize(buffer, maxDimensions, stripMetadata) {
    let pipeline = sharp(buffer).rotate().resize(maxDimensions.width, maxDimensions.height, {
        fit: 'inside',
        withoutEnlargement: true
    });
    if (!stripMetadata) {
        pipeline = pipeline.keepMetadata();
    }
    const { data, info } = await pipeline.toBuffer({
        resolveWithObject: true
    });
    return {
        buffer: data,
        width: info.width,
        height: info.height,
        size: info.size
    };
}
export async function generateThumbHash(buffer) {
    const { data, info } = await sharp(buffer).resize(100, 100, {
        fit: 'inside'
    }).raw().ensureAlpha().toBuffer({
        resolveWithObject: true
    });
    const thumbHash = rgbaToThumbHash(info.width, info.height, data);
    return Buffer.from(thumbHash).toString('base64');
}
export async function convertFormat(buffer, format, quality) {
    const { data, info } = await sharp(buffer).toFormat(format, {
        quality
    }).toBuffer({
        resolveWithObject: true
    });
    const mimeType = format === 'webp' ? 'image/webp' : 'image/avif';
    return {
        buffer: data,
        width: info.width,
        height: info.height,
        size: info.size,
        mimeType
    };
}

//# sourceMappingURL=index.js.map