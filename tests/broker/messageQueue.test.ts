import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { type RedisClientType, createClient } from "redis";
import { Consumer, Producer } from "../../src/utils/messageQueue";

import crypto from "node:crypto";

import { createLogger } from "../../src/utils/log";
const logger = createLogger(import.meta);

function generateRandomString(length: number): string {
    const randomBytes = crypto.randomBytes(length);
    const randomString = randomBytes.toString("base64");
    return randomString.substring(0, length);
}
function createDataset(size: number, keyLength: number = 100): string[] {
    return [...Array(size)].map(
        (_, i) => `${i}:${generateRandomString(keyLength)}`,
    );
}

async function withPair<T, U>(
    fn: (
        producer: Producer<T>,
        consumer: Consumer<T>,
        resetConsumer: () => Consumer<T>,
    ) => Promise<U>,
): Promise<U> {
    const clientProducer = createClient() as RedisClientType;
    const clientConsumer = createClient() as RedisClientType;
    await clientProducer.connect();
    await clientConsumer.connect();

    const stream = `MSGQUEUE_STREAM_TEST_${generateRandomString(10)}`;
    await clientConsumer.DEL(stream);
    logger.debug(`Using stream ${stream}`);
    const consumer = new Consumer<T>(clientConsumer, stream);
    const producer = new Producer<T>(clientProducer, stream);

    try {
        const result = await fn(producer, consumer, () => {
            return new Consumer<T>(clientConsumer, stream);
        });
        return result;
    } finally {
        logger.debug(`Cleaning up stream ${stream}`);
        await clientConsumer.DEL(stream);
        await clientConsumer.QUIT();
        await clientProducer.QUIT();
    }
}

describe("msgQueue test", () => {
    test("simple consumer test", async () => {
        const data = createDataset(100);
        const rx: string[] = [];
        await withPair<string, void>(async (producer, consumer) => {
            const fin = (async () => {
                for (let i = 0; i < data.length; i++) {
                    const d = await consumer.next();
                    rx.push(d[1]);
                    consumer.commit(d[0]);
                }
            })();
            for (const d of data) {
                await producer.push(d);
            }
            await fin;
        });
        expect(rx).toEqual(data);
    });
    test("simple unreliable consumer test", async () => {
        const data = createDataset(100);
        const rx: string[] = [];
        await withPair<string, void>(
            async (producer, consumer, resetConsumer) => {
                let currentConsumer = consumer;
                for (const d of data) {
                    await producer.push(d);
                }
                const fin = (async () => {
                    for (let i = 0; i < data.length; i++) {
                        const d = await currentConsumer.next();
                        // not commiited yet.
                        if (i % 7 === 6) {
                            //logger.debug("Pre-crash", consumer.pending, consumer.loaded);
                            // emulate crash once.
                            currentConsumer = resetConsumer();
                            const d2 = await currentConsumer.next();
                            rx.push(d2[1]);
                            await currentConsumer.commit(d2[0]);
                            //logger.debug(`Committing [${d2[0]}]${d2[1]} post-crash, iter: ${i}`)
                            //logger.debug("Post-crash", consumer.pending, consumer.loaded);
                            expect(d).toEqual(d2);
                        } else {
                            rx.push(d[1]);
                            await currentConsumer.commit(d[0]);
                            //logger.debug(`Committing [${d[0]}]${d[1]} as-is, iter: ${i}`)
                        }
                    }
                })();

                await fin;
            },
        );
        expect(rx).toEqual(data);
    });
    test("unreliable consumer test", async () => {
        const total = 1000;
        const data = createDataset(total);
        const rx: string[] = [];
        await withPair<string, void>(
            async (producer, _consumer, resetConsumer) => {
                const task_tx = (async () => {
                    for (const d of data) {
                        await new Promise((resolve) => {
                            setTimeout(
                                () => {
                                    resolve(null);
                                },
                                Math.round(Math.random() * 10),
                            );
                        });
                        logger.debug(`Pushing [${d}]`);
                        await producer.push(d);
                    }
                })();

                const task_rx = (async () => {
                    let committed = 0;
                    while (committed < total) {
                        const consumer = resetConsumer();
                        const d = await consumer.next();
                        await new Promise((resolve) => {
                            setTimeout(
                                () => {
                                    resolve(null);
                                },
                                Math.round(Math.random() * 5),
                            );
                        });
                        if (Math.random() < 0.1) {
                            // Crash after read
                            continue;
                        }
                        rx.push(d[1]);
                        await consumer.commit(d[0]);
                        committed += 1;
                        await new Promise((resolve) => {
                            setTimeout(
                                () => {
                                    resolve(null);
                                },
                                Math.round(Math.random() * 5),
                            );
                        });
                    }
                })();
                await task_tx;
                await task_rx;
            },
        );
        expect(rx).toEqual(data);
    }, 20000);
});
