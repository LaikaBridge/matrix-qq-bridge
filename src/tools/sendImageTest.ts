import { parseArgs } from "node:util";
import { uuidV4 } from "data-structure-typed";
import { type RedisClientType, createClient } from "redis";
import type { OutgoingMessage } from "../model/qq/outgoing.ts";
import type { Task, TaskResponse } from "../model/qq/tasks.ts";
import { readConfig } from "../utils/config.ts";
import { createLogger } from "../utils/log.ts";
import { Consumer, Producer } from "../utils/messageQueue.ts";
import { MimedFilePath } from "../utils/mime.ts";

const logger = createLogger(import.meta);

(async () => {
    const config = readConfig();
    const redisClient = (await createClient({
        url: config.redisConfig.connString,
    })) as RedisClientType;
    await redisClient.connect();
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
    const url = args.positionals[0];
    const imageUUID = uuidV4();
    logger.info(`Randomly generating image ID: ${imageUUID}`);
    logger.info("First, downloading image.");
    await taskQueue.push({
        type: "fetchImage",
        uuid: imageUUID,
        url: url,
    });
    async function pollTaskResponse<K extends TaskResponse["type"]>(
        type: K,
        pred: (task: TaskResponse & { type: K }) => boolean,
    ): Promise<TaskResponse & { type: K }> {
        while (true) {
            const [resp, commit] = await taskResponseQueue.nextWithCommit();
            await commit();
            if (resp.type === type) {
                const respK = resp as TaskResponse & { type: K };
                if (pred(respK)) {
                    return respK;
                }
            }
        }
    }
    logger.info("Waiting for image download to finish.");
    const resFetch = await pollTaskResponse(
        "fetchImageResponse",
        (resp) => resp.uuid === imageUUID,
    );

    if (resFetch.response.type === "error") {
        logger.error(`Image download failed: ${resFetch.response.reason}`);
        process.exit(1);
    }

    logger.info("Image download finished.");
    const file = resFetch.response.path;

    logger.info("Uploading image to QQ.");
    await taskQueue.push({
        type: "uploadImage",
        file,
        group: groupId,
    });

    logger.info("Waiting for image upload to finish.");
    const resUpload = await pollTaskResponse(
        "uploadImageResponse",
        (resp) => resp.uuid === imageUUID,
    );
    if (resUpload.response.type === "error") {
        logger.error(`Image upload failed: ${resUpload.response.reason}`);
        process.exit(1);
    }
    logger.info("Image upload finished.");

    const imageId = resUpload.response.imageId;

    const msgUUID = uuidV4();
    logger.info(`Randomly generating message ID: ${msgUUID}`);
    await outgoingQueue.push({
        metadata: {
            group: groupId,
            uuid: msgUUID,
        },
        components: [{ type: "image", imageId }],
    });
    logger.info("Waiting for message to be sent.");

    const resSend = await pollTaskResponse(
        "messageSent",
        (resp) => resp.uuid === msgUUID,
    );
    logger.info("Message sent.");

    await redisClient.quit();
})();
