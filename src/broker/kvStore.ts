import type { RedisClientType } from "@redis/client";

// kvstore backed by redis.
export class KVStore {
    client: RedisClientType;
    prefix: string;
    constructor(client: RedisClientType, prefix: string) {
        this.client = client;
        this.prefix = prefix;
    }
    prefixedKey(key: string): string {
        return `${this.prefix}:${key}`;
    }
    async get(key: string): Promise<string | null> {
        return await this.client.get(this.prefixedKey(key));
    }
    async set(key: string, value: string, duration?: number) {
        if (duration !== undefined) {
            await this.client.set(this.prefixedKey(key), value, {
                PX: duration,
            });
        } else {
            await this.client.set(this.prefixedKey(key), value);
        }
    }
}
