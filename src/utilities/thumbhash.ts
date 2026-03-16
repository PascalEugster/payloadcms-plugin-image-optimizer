import { rgbaToThumbHash, thumbHashToDataURL } from 'thumbhash'

export function encodeImageToThumbHash(
  buffer: Buffer,
  width: number,
  height: number,
): string {
  const thumbHash = rgbaToThumbHash(width, height, buffer)
  return Buffer.from(thumbHash).toString('base64')
}

export function decodeThumbHashToDataURL(thumbHash: string): string {
  const thumbHashBuffer = Buffer.from(thumbHash, 'base64')
  return thumbHashToDataURL(thumbHashBuffer)
}
