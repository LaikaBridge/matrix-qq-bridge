import { type Config, readConfig } from "../../config.ts";

import { existsSync } from "node:fs";
import Sequelize, { sql } from "@sequelize/core";
import { SqliteDialect } from "@sequelize/sqlite3";

import { createLogger } from "../../log.ts";
import schemas from "./schemas";
const logger = createLogger(import.meta);

const DATABASE_VERSION = schemas.length;
const DATABASE_APPLICATION_ID = 0x249af790;

function error(s: string) {
    logger.error(s);
    throw new Error(s);
}
export class Database {
    database: Sequelize;
    firstInit = false;
    private constructor(connString: string) {
        if (!existsSync(connString)) {
            logger.info("Database does not exist. Creating new database.");
            this.firstInit = true;
        }
        this.database = new Sequelize({
            dialect: SqliteDialect,
            storage: connString,
            logging: (msg) => logger.debug(msg),
        });
    }

    async getPragma<T>(pragma: string) {
        const [result] = (await this.database.query(`pragma ${pragma};`)) as [
            [{ [key: string]: T }],
            _: unknown,
        ];
        return result[0][pragma];
    }
    async setPragma<T>(pragma: string, value: T) {
        await this.database.query(`pragma ${pragma} = ${value};`);
    }
    async assureApplicationId() {
        const application_id = await this.getPragma<number>("application_id");
        if (application_id === DATABASE_APPLICATION_ID) {
            logger.info("Application ID checked.");
        } else if (this.firstInit) {
            await this.setPragma("application_id", DATABASE_APPLICATION_ID);
        } else {
            error(
                `Application ID (${application_id}) does not match. This is not a valid database!`,
            );
        }
    }
    private async getCurrentDBVersion() {
        const user_version = await this.getPragma<number>("user_version");
        return user_version;
    }

    async migrate() {
        let currentVersion = await this.getCurrentDBVersion();
        logger.info(`DB schema version: ${currentVersion}`);
        logger.info(`Expected schema version: ${DATABASE_VERSION}`);
        if (currentVersion < DATABASE_VERSION) {
            while (currentVersion < DATABASE_VERSION) {
                const intermediate = schemas[currentVersion];
                if (intermediate === undefined) {
                    error(
                        `Database version (${currentVersion}) is not supported.`,
                    );
                }

                logger.info(
                    `Running migration ${currentVersion} -> ${
                        currentVersion + 1
                    }`,
                );
                await intermediate.migrate(this.database);
                currentVersion++;

                this.setPragma("user_version", `${currentVersion}`);
                logger.info(
                    `Migration complete. Current version: ${currentVersion}`,
                );
            }
        } else if (currentVersion > DATABASE_VERSION) {
            error(
                `Database version (${currentVersion}) is newer than the current version (${DATABASE_VERSION}). This is not supported.`,
            );
        } else {
            logger.info("Schema is up to date.");
        }
        logger.info("Loading latest schema.");
        this.database.removeAllModels();
        const currentSchema = schemas[DATABASE_VERSION - 1];
        this.database.addModels(currentSchema.models());
    }

    static async open(config: Config): Promise<Database> {
        const db = new Database(config.dbConfig.path);
        await db.assureApplicationId();
        await db.migrate();
        return db;
    }
}

(async () => {
    const config = readConfig();
    const db = await Database.open(config);
})();
