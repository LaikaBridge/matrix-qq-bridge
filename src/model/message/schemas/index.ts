import type { ModelStatic, Sequelize } from "@sequelize/core";
import schemaV1 from "./v1";
export interface MessageSchema {
    models(): ModelStatic[];
    migrate(db: Sequelize): Promise<void>;
}

const schemas = [schemaV1];

export default schemas;
