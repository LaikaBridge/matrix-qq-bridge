import { createLogger } from "./log";
import { type MimedFilePath, guessMime, writeMimedFile } from "./mime";
import { RetryLimitExceededError, retry } from "./retry";

const logger = createLogger();

export async function downloadMimedFile(
    uuid: string,
    url: string,
    maxRetries: number = 3,
) {
    try {
        const maxRetries = 3;
        logger.debug(`Downloading mimed file from ${url}`);
        const [img, preferredMime] = await retry(async () => {
            const res = await fetch(url);
            let mime: string | undefined = undefined;
            for (const [header, value] of res.headers.entries()) {
                if (header.toLowerCase() === "content-type") {
                    mime = value.toLowerCase();
                }
            }
            const buffer = await res.arrayBuffer();
            return [buffer, mime];
        }, maxRetries);
        let mime: string | null = await guessMime(img);
        if (mime === null) {
            if (preferredMime) {
                logger.warn(
                    `Mime guess failed for ${url}. Defaulting to preferred mime: ${preferredMime}`,
                );
                mime = preferredMime;
            } else {
                logger.warn(
                    `Mime guess failed for ${url}. Defaulting to image/png.`,
                );
                mime = "image/png";
            }
        } else {
            if (preferredMime && preferredMime !== mime) {
                logger.warn(
                    `Mime guess mismatch for ${url}. Expected ${preferredMime}, got ${mime}. Defaulting to ${mime}`,
                );
            }
        }
        const file: MimedFilePath = { uuid, mime };
        await writeMimedFile(file, Buffer.from(img));
        return file;
    } catch (err) {
        if (err instanceof RetryLimitExceededError) {
            logger.error(`Failed to download image from ${url}`);
            return null;
        } else {
            throw err;
        }
    }
}
