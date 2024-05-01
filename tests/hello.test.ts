import { describe, expect, test } from "@jest/globals";
import { createLogger } from "../src/log";
const logger = createLogger(module);

describe("hello world by jest", () => {
    test("adds 1 + 2 to equal 3", () => {
        logger.info("hello world");
        expect(1 + 2).toBe(3);
    });
});
