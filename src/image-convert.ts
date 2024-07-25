import concatStream from "concat-stream";
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "node:stream";
import { WASMagic } from "wasmagic";
type FFMpegCodec = [format: string, codec: string];
class MimeInfo{
    mime: Mime;
    format: string;
    isAnimated: boolean;
    ffmpegCodec: FFMpegCodec;
    constructor(mime: string, format: string, isAnimated: boolean, ffmpegCodec: FFMpegCodec){
        this.mime = mime as Mime;
        this.format = format;
        this.isAnimated = isAnimated;

        this.ffmpegCodec = ffmpegCodec;
    }
}

export const SUPPORTED_MIMES = {
    "image/png": new MimeInfo("image/png", "png", false, ["image2", "png"]),
    "image/gif": new MimeInfo("image/gif", "gif", true, ["image2", "gif"]),
    "image/webp": new MimeInfo("image/webp", "webp", false, ["image2", "webp"]),
    "video/webm": new MimeInfo("video/webm", "webm", true, ["webm", "vp9"]),
    "video/mp4": new MimeInfo("video/mp4", "mp4", true, ["mp4", "h264"]),
} as const;
export const SUPPORTED_MIME_LIST = Object.keys(SUPPORTED_MIMES) as Mime[];
export type Mime = keyof typeof SUPPORTED_MIMES;
export interface MimedImage {
    mime: Mime;
    data: Buffer;
}
function createPipe() {
    let res: (arg0: Buffer) => void, rej!: (x: any)=>void;
    const prom: Promise<Buffer> = new Promise((resolve, reject) => {
        res = resolve;
        rej = reject;
    });
    let cs = concatStream((buf) => res(buf));
    return { stream: cs, promise: prom, rej: rej };
}
const MAGIC = WASMagic.create();
export async function guessMime(buffer: Buffer){
    const mime = (await MAGIC).detect(buffer);
    if(!mime) throw new Error("Unknown mime type");
    const mimeInfo = SUPPORTED_MIMES[mime as Mime];
    if(!mimeInfo) throw new Error("Unsupported mime type");
    return { mime: mimeInfo.mime, data: buffer };
}
export async function convertTo(image: MimedImage, target: Mime): Promise<MimedImage>{
    const mimeInfo = SUPPORTED_MIMES[target];
    const srcMimeInfo = SUPPORTED_MIMES[image.mime];
    const stream = createPipe();
    ffmpeg()
        .addInput(Readable.from(image.data))
        .format(mimeInfo.ffmpegCodec[0])
        .videoCodec(mimeInfo.ffmpegCodec[1])
        .on("error", (err) => {
            console.log("ffmpeg conversion failed");
            console.error(err);
            stream.rej(err);
        })
        .on("end", () => {
            console.log("ffmpeg conversion successful");
        })
        .pipe(stream.stream, { end: true });
    const outputBuffer = await stream.promise;
    return { mime: target, data: outputBuffer };
}

export async function convertToQQ(buffer: Buffer){
    const mimedImage = await guessMime(buffer);
    const mime = SUPPORTED_MIMES[mimedImage.mime];
    const targetMime = mime.isAnimated? "image/gif" : "image/png";
    return convertTo(mimedImage, targetMime);
}
export async function convertToMX(buffer: Buffer){
    const mimedImage = await guessMime(buffer);
    const mime = SUPPORTED_MIMES[mimedImage.mime];
    const targetMime = mime.isAnimated? "video/webm" : "image/webp";
    return convertTo(mimedImage, targetMime);
}
