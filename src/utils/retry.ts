import { createLogger } from "./log";

const logger = createLogger();

export class RetryLimitExceededError extends Error {
    constructor() {
        super("Too many retries. Give up.");
        Object.setPrototypeOf(this, RetryLimitExceededError.prototype);
    }
}
export async function retry<T>(fn: () => Promise<T>, maxRetries: number = 3) {
    let retries = 0;
    while (true) {
        try {
            return await fn();
        } catch (error) {
            logger.error(`Error encountered: ${error}`);
            retries++;
            if (retries > maxRetries) {
                throw new RetryLimitExceededError();
            }
            logger.error(`Retrying ${retries + 1}/${maxRetries}`);
        }
    }
}
