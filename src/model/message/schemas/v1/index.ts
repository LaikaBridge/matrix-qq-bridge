import type { ModelStatic } from "@sequelize/core";
import type { MessageSchema } from "..";
import { createLogger } from "../../../../utils/log.ts";
import schemas from "./message";
const logger = createLogger(import.meta);

const schema: MessageSchema = {
    models(): ModelStatic[] {
        return schemas;
    },
    async migrate(db) {
        logger.info("Creating schema for v1");
        db.removeAllModels();
        db.addModels(this.models());
        await db.sync();
        logger.info("Schema created.");
    },
};

export default schema;
