import { QQBroker } from "../broker/QQBroker";
import { readConfig } from "../utils/config";
import { createLogger } from "../utils/log";

const logger = createLogger(import.meta);

(async function main() {
    const config = readConfig();
    const broker = await QQBroker.create(config);
    logger.info("QQ Broker initialized.");
})();
