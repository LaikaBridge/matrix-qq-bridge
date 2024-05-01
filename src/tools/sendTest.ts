import { parseArgs } from "node:util";
import { type RedisClientType, createClient } from "redis";
import { Producer } from "../broker/messageQueue";
import { readConfig } from "../config";
import { createLogger } from "../log";
import type { OutgoingMessage } from "../model/qq/outgoing";

const logger = createLogger(module);

(async () => {
    const config = readConfig();
    const redisClient = (await createClient({
        url: config.redisConfig.connString,
    })) as RedisClientType;
    await redisClient.connect();
    const outgoingQueue = new Producer<OutgoingMessage>(
        redisClient,
        `${config.redisConfig.namespace}-qqOutgoingQueue`,
    );
    const args = parseArgs({
        options: {
            group: {
                type: "string",
                short: "g",
            },
        },
        allowPositionals: true,
    });
    const group = args.values.group;
    if (group === undefined) {
        logger.error("No group specified");
        process.exit(1);
    }
    const groupId = Number.parseInt(group);
    if (Number.isNaN(groupId)) {
        logger.error("Invalid group specified");
        process.exit(1);
    }
    if (args.positionals.length !== 1) {
        logger.error("Invalid number of positionals");
        process.exit(1);
    }
    await outgoingQueue.push({
        metadata: {
            group: groupId,
        },
        components: [{ type: "text", data: args.positionals[0] }],
    });
    logger.info("Message sent.");
    await redisClient.quit();
})();
