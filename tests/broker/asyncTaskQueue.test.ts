import { describe, expect, test } from "@jest/globals";
import { AsyncTaskQueue } from "../../src/broker/asyncTaskQueue";
import { createLogger } from "../../src/log";
const logger = createLogger(module);

describe("AsyncTaskQueue test", () => {
    test("Enqueue all at once test", async () => {
        const taskQueue = new AsyncTaskQueue();
        const N = 100;
        const resolvers: (() => void)[] = [];
        logger.info("Expected 0 to N-1");
        const expected = Array.from({ length: N }, (_, i) => i);
        const got: number[] = [];
        logger.info("Populating resolvers and task queue");
        for (let i = 0; i < N; i++) {
            const task = new Promise((resolve) => {
                resolvers.push(() => resolve(void 0));
            });
            taskQueue.enqueue(async () => {
                await task;
                logger.debug(`Task #${i} resolved`);
                got.push(i);
            });
        }
        logger.info("Generating permutation");
        const permutation = [];
        for (let i = 0; i < N; i++) {
            permutation.push(i);
        }
        for (let i = 0; i < N; i++) {
            const j = Math.floor(Math.random() * (N - i)) + i;
            [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
        }

        logger.info("Waiting for all tasks to finish");
        // timeout until all tasks finished
        const sleep = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
        // execute permutation
        for (const i of permutation) {
            resolvers[i]();
        }
        while (true) {
            if (taskQueue.queue.size === 0) {
                break;
            }
            await sleep(100);
        }

        expect(expected).toEqual(got);
    });
    test("Enroll api", async () => {
        const taskQueue = new AsyncTaskQueue();
        const N = 100;
        const resolvers: (() => void)[] = [];
        logger.info("Expected 0 to N-1");
        const expected = Array.from({ length: N }, (_, i) => i);
        const got: number[] = [];
        logger.info("Populating resolvers and task queue");
        for (let i = 0; i < N; i++) {
            const [ready, commit] = taskQueue.enroll();
            (async () => {
                const task = new Promise((resolve) => {
                    resolvers.push(() => resolve(void 0));
                });
                await task;
                logger.debug(`Task #${i} resolved`);
                await ready;
                logger.debug(`Task #${i} committed`);
                got.push(i);
                commit();
            })();
        }
        logger.info("Generating permutation");
        const permutation = [];
        for (let i = 0; i < N; i++) {
            permutation.push(i);
        }
        for (let i = 0; i < N; i++) {
            const j = Math.floor(Math.random() * (N - i)) + i;
            [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
        }

        logger.info("Waiting for all tasks to finish");
        // timeout until all tasks finished
        const sleep = (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms));
        // execute permutation
        for (const i of permutation) {
            resolvers[i]();
        }
        while (true) {
            if (taskQueue.queue.size === 0) {
                break;
            }
            await sleep(100);
        }

        expect(expected).toEqual(got);
    });
});
