import { mkdirSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import Jimp from "jimp";
import { extension } from "mime-types";
import { createLogger } from "./log";
const logger = createLogger();

async function guessImageMime(buffer: ArrayBuffer) {
    try {
        // Use JIMP to guess image.
        // TODO: JIMP relies on old node-fetch, which requires punycode that has been deprecated.
        const image = await Jimp.read(Buffer.from(buffer));
        return image.getMIME().toLowerCase();
    } catch (err) {
        logger.debug(`Failed to guess image mime: ${err}`);
        return null;
    }
}

export async function guessMime(buffer: ArrayBuffer) {
    const imageMime = await guessImageMime(buffer);
    if (imageMime) {
        return imageMime;
    }
    // Otherwise, unknown.
    return null;
}
export const UNMIMED_FILE_PATH = "./files/unmimed";
export const MIMED_FILE_PATH = "./files/mimed";

export function initializeFileStorage() {
    mkdirSync(UNMIMED_FILE_PATH, { recursive: true });
    mkdirSync(MIMED_FILE_PATH, { recursive: true });
}

export function mimedFilePath(file: MimedFilePath) {
    const ext = extension(file.mime);
    if (!ext) {
        logger.error(`Unknown mime type: ${file.mime}`);
        return "bin";
    }
    return path.join(MIMED_FILE_PATH, `${file.uuid}.${ext}`);
}
export async function writeMimedFile(file: MimedFilePath, buffer: Buffer) {
    const unmimedPath = path.join(UNMIMED_FILE_PATH, file.uuid);
    // write file.
    await writeFile(unmimedPath, buffer);
    // create symlink
    await symlink(`../unmimed/${file.uuid}`, mimedFilePath(file));
}

export type MimedFilePath = { uuid: string; mime: string };
