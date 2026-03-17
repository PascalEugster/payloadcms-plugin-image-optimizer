import { rgbaToThumbHash, thumbHashToDataURL } from 'thumbhash';
export function encodeImageToThumbHash(buffer, width, height) {
    const thumbHash = rgbaToThumbHash(width, height, buffer);
    return Buffer.from(thumbHash).toString('base64');
}
export function decodeThumbHashToDataURL(thumbHash) {
    const thumbHashBuffer = Buffer.from(thumbHash, 'base64');
    return thumbHashToDataURL(thumbHashBuffer);
}

//# sourceMappingURL=thumbhash.js.map