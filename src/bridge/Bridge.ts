import { type RedisClientType, createClient } from "redis";
import type { MatrixMessage } from "../model/matrix/message";
import type { IncomingMessage } from "../model/qq/incoming";
import type { OutgoingMessage } from "../model/qq/outgoing";
import type { Config } from "../utils/config";
import { type HasLogger, createLogger } from "../utils/log";
import { Consumer, Producer } from "../utils/messageQueue";
import { Service } from "../utils/service";
const logger = createLogger();
/**
 * The bridge stores messages and routes them between brokers.
 */
export class Bridge extends Service implements HasLogger {
    // qq broker
    qqBrokerIncoming: Consumer<IncomingMessage>;
    qqBrokerOutgoing: Producer<OutgoingMessage>;
    // matrix broker
    matrixBrokerIncoming: Consumer<MatrixMessage>;
    matrixBrokerOutgoing: Producer<MatrixMessage>;
    // redis clients
    clients: RedisClientType[] = [];
    async connect() {
        this.logger.info("Redis connecting.");
        for (const client of this.clients) {
            await client.connect();
        }
        this.logger.info("Redis connected.");
    }

    desc(): string {
        return "Bridge router";
    }
    onError(err: unknown) {
        this.logger.error("Error with Redis client: ${err}");
    }
    newClient(client: RedisClientType) {
        const next = client.duplicate();
        this.clients.push(next);
        return next;
    }
    private constructor(config: Config) {
        super();
        const client: RedisClientType = createClient({
            url: config.redisConfig.connString,
        });
        client.on("error", (err) => this.onError(err));

        this.qqBrokerIncoming = new Consumer(
            this.newClient(client),
            config.redisNames.QQ_INCOMING_QUEUE,
        );
        this.qqBrokerOutgoing = new Producer(
            this.newClient(client),
            config.redisNames.QQ_OUTGOING_QUEUE,
        );
        this.matrixBrokerIncoming = new Consumer(
            this.newClient(client),
            config.redisNames.MATRIX_INCOMING_QUEUE,
        );
        this.matrixBrokerOutgoing = new Producer(
            this.newClient(client),
            config.redisNames.MATRIX_OUTGOING_QUEUE,
        );

        this.setLogger(logger);
    }
    static async create(config: Config) {
        const bridge = new Bridge(config);
        await bridge.connect();
        bridge.enableGracefulShowdown();
        return bridge;
    }
    async shutdown() {
        for (const client of this.clients) {
            await client.disconnect();
        }
    }
}
