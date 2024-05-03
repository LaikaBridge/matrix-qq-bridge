import { parseArgs } from "node:util";
import { uuidV4 } from "data-structure-typed";
import { type RedisClientType, createClient } from "redis";
import type { OutgoingMessage } from "../model/qq/outgoing.ts";
import type { Task, TaskResponse } from "../model/qq/tasks.ts";
import { readConfig } from "../utils/config.ts";
import { createLogger } from "../utils/log.ts";
import { Consumer, Producer } from "../utils/messageQueue.ts";

const logger = createLogger(import.meta);

(async () => {
    const config = readConfig();
    const redisClient = (await createClient({
        url: config.redisConfig.connString,
    })) as RedisClientType;
    const outgoingQueue = new Producer<OutgoingMessage>(
        redisClient.duplicate(),
        config.redisNames.QQ_OUTGOING_QUEUE,
    );
    const taskQueue = new Producer<Task>(
        redisClient.duplicate(),
        config.redisNames.QQ_TASK_QUEUE,
    );
    const taskResponseQueue = new Consumer<TaskResponse>(
        redisClient.duplicate(),
        config.redisNames.QQ_TASK_RESPONSE_QUEUE,
    );
    await outgoingQueue.connect();
    await taskQueue.connect();
    await taskResponseQueue.connect();
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
    const uuid = uuidV4();
    logger.info(`Randomly generating message ID: ${uuid}`);
    await outgoingQueue.push({
        metadata: {
            uuid,
            group: groupId,
        },
        components: [{ type: "text", data: args.positionals[0] }],
    });
    logger.info("Message sent.");
    await redisClient.quit();
})();
