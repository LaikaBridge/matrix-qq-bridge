import { describe, expect, jest, test } from "@jest/globals";
import { createLogger } from "../src/log";
const logger = createLogger(import.meta);

describe("hello world by jest", () => {
    test("adds 1 + 2 to equal 3", () => {
        logger.info("hello world");
        expect(1 + 2).toBe(3);
    });
});
