import { ErrorReply, type RedisClientType } from "redis";
import { toReversed } from "../ponyfill/array.ts";
import { createLogger } from "./log.ts";

const logger = createLogger(import.meta);

export class InterruptedError extends Error {
    constructor() {
        super("Redis client Interrupted!");
        Object.setPrototypeOf(this, InterruptedError.prototype);
    }
}

const CONSUMER_GROUP = "consumers";
const CONSUMER_NAME = "consumer";
const DATA_KEY = "jsonData";
export const MAX_QUEUE_SIZE = 10;
/**
 * Message queue backed by Redis.
 * Using a consumer group but only one consumer.
 */
export type Entry<T> = [id: string, data: T];
export class Producer<T> {
    async connect() {
        await this.client.connect();
    }
    async terminate() {
        await this.client.disconnect();
    }
    private client: RedisClientType;
    private stream: string;
    constructor(redis: RedisClientType, stream: string) {
        this.client = redis.duplicate();
        this.stream = stream;
    }
    async push(data: T): Promise<string> {
        const id = await this.client.xAdd(this.stream, "*", {
            [DATA_KEY]: JSON.stringify(data),
        });
        logger.debug(`Pushed ${id}`);
        return id;
    }
}
export class Consumer<T> {
    async connect() {
        await this.blockingClient.connect();
        await this.nonblockingClient.connect();
    }
    async terminate() {
        await this.blockingClient.disconnect();
        await this.nonblockingClient.disconnect();
    }
    private blockingClient: RedisClientType;
    private nonblockingClient: RedisClientType;
    private stream: string;
    pending: string[] = [];
    loaded: Entry<T>[] = [];
    constructor(redis: RedisClientType, stream: string) {
        this.blockingClient = redis.duplicate();
        this.nonblockingClient = redis.duplicate();
        this.stream = stream;
    }
    private initialized = false;
    private async init() {
        if (this.initialized) {
            return;
        }
        // create group
        try {
            await this.nonblockingClient.xGroupCreate(
                this.stream,
                CONSUMER_GROUP,
                "0-0",
                {
                    MKSTREAM: true,
                },
            );
        } catch (e: unknown) {
            if (e instanceof ErrorReply) {
                if (e.message.includes("BUSYGROUP")) {
                    logger.debug("Consumer group already created.");
                }
            } else {
                // rethrow exception
                throw e;
            }
        }
        // create consumer
        await this.nonblockingClient.xGroupCreateConsumer(
            this.stream,
            CONSUMER_GROUP,
            CONSUMER_NAME,
        );
        await this.populatePendingMessages();

        this.initialized = true;
    }
    private parse(a: string): T {
        return JSON.parse(a) as T;
    }
    private pendingFinished = false;
    lastPendingId = "0-0";
    private async populatePendingMessages() {
        if (this.pendingFinished) {
            throw new Error("Pending already finished!");
        }

        if (this.pending.length !== 0) {
            throw new Error("Pending queue is not empty.");
        }
        const pending = await this.nonblockingClient.xPendingRange(
            this.stream,
            CONSUMER_GROUP,
            `(${this.lastPendingId}`,
            "+",
            MAX_QUEUE_SIZE,
            { consumer: CONSUMER_NAME },
        );
        this.pending = toReversed(pending.map((x) => x.id));
        // all pending items are populated.
        if (this.pending.length === 0) {
            logger.debug("All pending terms loaded.");
            this.pendingFinished = true;
            return;
        }
        this.lastPendingId = this.pending[0];
    }
    private async loadMessages() {
        if (!this.pendingFinished) {
            throw new Error("Pending not finished!");
        }
        if (this.loaded.length !== 0) {
            throw new Error("Loaded queue is not empty.");
        }
        // read some from queue.
        const messages = await (async () => {
            try {
                return await this.blockingClient.xReadGroup(
                    CONSUMER_GROUP,
                    CONSUMER_NAME,
                    {
                        key: this.stream,
                        id: ">",
                    },
                    {
                        COUNT: MAX_QUEUE_SIZE,
                        BLOCK: 0,
                    },
                );
            } catch (e: unknown) {
                throw new InterruptedError();
            }
        })();
        if (messages === null) {
            throw new Error("XREADGROUP early return with BLOCK=0.");
        }
        this.loaded = toReversed(
            messages[0].messages.map(
                (x) => [x.id, this.parse(x.message[DATA_KEY])] as Entry<T>,
            ),
        );
    }
    private async readWithId(id: string): Promise<Entry<T> | null> {
        const result = await this.nonblockingClient.xRange(
            this.stream,
            id,
            id,
            {
                COUNT: 1,
            },
        );
        if (result.length === 0) {
            return null;
        }
        const json = JSON.parse(result[0].message[DATA_KEY]) as T;
        return [result[0].id, json];
    }

    // Exported interfaces.
    async next(): Promise<Entry<T>> {
        await this.init();
        const last = this.loaded.pop();
        if (last) {
            return last;
        }

        // No loaded.
        while (this.pending.length !== 0) {
            //logger.debug(this.pending, this.pendingFinished);
            const next_pending = this.pending.pop()!;

            if (this.pending.length === 0 && !this.pendingFinished) {
                await this.populatePendingMessages();
            }
            const next_data = await this.readWithId(next_pending);
            if (next_data) {
                return next_data;
            }
            logger.debug(`ID ${next_pending} not found. May have expired.`);
        }
        // Pending is also empty.
        await this.loadMessages();
        const top = this.loaded.pop();
        if (!top) {
            throw new InterruptedError();
            //throw new Error("No more messages, but we should block!");
        }
        return top;
    }
    async commit(id: string) {
        await this.init();
        const value = await this.nonblockingClient.XACK(
            this.stream,
            CONSUMER_GROUP,
            id,
        );
        if (value !== 1) {
            throw new Error(`Failed to commit ${id}`);
        }
    }
    async nextWithCommit() {
        const [id, val] = await this.next();
        return [
            val,
            () => {
                return this.commit(id);
            },
        ] as const;
    }
}
