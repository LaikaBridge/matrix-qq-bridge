/* eslint-disable @typescript-eslint/no-unused-vars */
import { createClient, RedisClientType } from "redis";
import { Config } from "../config";
export class QQBroker {
    //qqSendQueue: string;
    //qqRecvQueue: string;
    redisClient: RedisClientType;
    constructor(config: Config) {
        this.redisClient = createClient({
            url: config.redisConfig.connString,
        });
        this.redisClient.on("error", (err) => {});
        const qqSendQueue = `${config.redisConfig.namespace}-qqSendQueue`;
        const qqRecvQueue = `${config.redisConfig.namespace}-qqRecvQueue`;
    }
}
