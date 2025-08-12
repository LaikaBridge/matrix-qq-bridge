import * as fs from "node:fs";
import { convertToMX } from "./image-convert";
import { logger } from "./logger";
(async () => {
    const buffer = fs.readFileSync("/home/gjz010/图片/explode.gif");
    logger.info(buffer);
    const image = await convertToMX(buffer);
    logger.info("OK");
    logger.info(image);
})();