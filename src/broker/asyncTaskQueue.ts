import { Queue } from "data-structure-typed";
import { createLogger } from "../log";
const logger = createLogger(module);

type Entry<T> = [cond: Promise<T>, then: (ret: T) => Promise<void>];
export class AsyncTaskQueue {
    terminated = false;
    queue: Queue<() => Promise<void>>;
    constructor() {
        this.queue = new Queue();
    }
    enqueue(task: () => Promise<void>) {
        this.queue.push(task);
        if (!this.terminated && !this.workers) {
            this.start();
        }
    }
    enroll(): [ready: Promise<void>, commit: () => void] {
        const { promise: commitPromise, resolve: commit } =
            Promise.withResolvers<void>();
        const queuePromise = new Promise<void>((resolve) => {
            this.enqueue(async () => {
                resolve(void 0);
                await commitPromise;
            });
        });
        return [queuePromise, commit];
    }
    workers: number = 0;
    async start() {
        logger.debug("Starting a worker");
        this.workers += 1;
        while (!this.terminated) {
            const next = this.queue.shift();
            if (next) {
                await next();
            } else {
                break;
            }
        }
        logger.debug("Stopping a worker");
        this.workers = 0;
    }
    terminate() {
        this.terminated = true;
    }
}
