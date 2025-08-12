import path from "path";
import { logger } from "./logger";
import { LanguageServiceMode } from "typescript";

// $INIT_CWD
export const workdir_root = function () {
    return process.env.LAIKA_ROOT || process.env.INIT_CWD || process.cwd();
}

export const workdir_relative = function (...args: string[]) {
    return path.resolve(workdir_root(), ...args);
}

export const WORKDIR_ROOT = workdir_root();
logger.info("workdir_root: " + WORKDIR_ROOT);
export const DATABASE_PATH = workdir_relative("./extra-storage-sqlite.db");
export const CONFIG_PATH = workdir_relative("./config.yaml");
export const LOG_ROOT = workdir_relative("./logs");
export const MUMBLE_CONFIG_PATH = workdir_relative("./mumble-bridge-config.yaml");
export const GEMINI_CONFIG_PATH = workdir_relative("./gemini-config.yaml");
