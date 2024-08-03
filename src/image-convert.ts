import concatStream from "concat-stream";
import ffmpeg from "fluent-ffmpeg";
import { Readable } from "node:stream";
import { WASMagic } from "wasmagic";
type FFMpegCodec = [format: string, codec: string];
class MimeInfo{
    mime: Mime;
    format: string;
    isAnimated: boolean;
    matrixMsgType: string;
    ffmpegCodec: FFMpegCodec;
    constructor(mime: string, format: string, isAnimated: boolean, ffmpegCodec: FFMpegCodec, matrixMsgType = "m.image"){
        this.mime = mime as Mime;
        this.format = format;
        this.isAnimated = isAnimated;
        this.ffmpegCodec = ffmpegCodec;
        this.matrixMsgType = matrixMsgType;
    }
}

export const SUPPORTED_MIMES = {
    "image/jpeg": new MimeInfo("image/jpeg", "jpeg", false, ["image2", "jpeg"]),
    "image/png": new MimeInfo("image/png", "png", false, ["image2", "png"]),
    "image/gif": new MimeInfo("image/gif", "gif", true, ["gif", "gif"]),
    "image/webp": new MimeInfo("image/webp", "webp", false, ["image2", "webp"]),
    "video/webm": new MimeInfo("video/webm", "webm", true, ["webm", "vp9"], "m.video"),
    "video/mp4": new MimeInfo("video/mp4", "mp4", true, ["mp4", "h264"], "m.video"),
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
export function withResolvers<T, E>(){
    let resolve!: (a: T)=>void, reject!: (a: E)=>void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };

}
export async function convertTo(image: MimedImage, target: Mime): Promise<MimedImage>{
    const mimeInfo = SUPPORTED_MIMES[target];
    const srcMimeInfo = SUPPORTED_MIMES[image.mime];
    const stream = createPipe();
    const ffmpegFin = withResolvers();
    ffmpeg()
        .addInput(Readable.from(image.data))
        .format(mimeInfo.ffmpegCodec[0])
        .outputOptions(["-c", mimeInfo.ffmpegCodec[1]])
        .on("error", (err) => {
            console.log("ffmpeg conversion failed");
            console.error(err);
            ffmpegFin.reject(err);
        })
        .on("end", () => {
            console.log("ffmpeg conversion successful");
            ffmpegFin.resolve(0);
        })
        .pipe(stream.stream, { end: true });
    await ffmpegFin.promise;
    const outputBuffer = await stream.promise;
    return { mime: target, data: outputBuffer };
}
export abstract class Target{
    abstract preferredMime(animated: boolean): Mime;
    abstract compatibleMimes(): Mime[];

    async convert(image: MimedImage | Buffer): Promise<MimedImage>{
        if(image instanceof Buffer){
            const mimedImage = await guessMime(image);
            return this.convert(mimedImage);
        }
        const mime = image.mime;
        if(this.compatibleMimes().indexOf(mime)!=-1){
            return image;
        }
        const targetMime = this.preferredMime(SUPPORTED_MIMES[mime].isAnimated);
        return convertTo(image, targetMime);
    }

}

export class QQTarget extends Target{
    preferredMime(animated: boolean): Mime{
        return animated? "image/gif" : "image/png";
    }
    compatibleMimes(): Mime[]{
        return ["image/gif", "image/png", "image/jpeg"];
    }
}
export class MXTarget extends Target{
    preferredMime(animated: boolean): Mime{
        return animated? "image/gif" : "image/png";
    }
    compatibleMimes(): Mime[]{
        return ["video/webm", "image/png", "image/jpeg", "video/mp4"];
    }
}

export async function convertToQQ(buffer: Buffer){
    return (new QQTarget()).convert(buffer);
}
export async function convertToMX(buffer: Buffer){
    return (new MXTarget()).convert(buffer);
}
