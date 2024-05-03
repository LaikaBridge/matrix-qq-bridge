import { Bridge } from "../bridge/Bridge";
import { readConfig } from "../utils/config";
import { createLogger } from "../utils/log";

const logger = createLogger(import.meta);

(async function main() {
    const config = readConfig();
    const bridge = await Bridge.create(config);
    logger.info("Bridge initialized.");
})();
