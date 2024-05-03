import { type Logger, createLogger } from "../utils/log.ts";
const baseLogger = createLogger(import.meta);

export abstract class Service {
    abstract connect(): Promise<void>;

    logger: Logger = baseLogger;
    setLogger(logger: Logger) {
        this.logger = logger;
    }

    abstract desc(): string;

    // Shutdown related
    abstract shutdown(): Promise<void>;
    private lastCtrlCTime: number = 0;
    private hasTerminated: boolean = false;
    get terminated() {
        return this.hasTerminated;
    }
    enableGracefulShowdown() {
        const gracefulShutdown = async () => {
            await this.onShutdown();
        };
        process.on("SIGINT", gracefulShutdown);
    }
    async onShutdown() {
        if (this.terminated) {
            const now = new Date().getTime();
            if (now - this.lastCtrlCTime >= 1000) {
                this.logger.warn(`${this.desc()} already terminating...`);
                this.logger.warn(
                    "Press Ctrl+C again in 1 second to force termination.",
                );
                this.lastCtrlCTime = now;
                return;
            } else {
                this.logger.warn(`${this.desc()} force terminating...`);
                process.exit(1);
            }
        }
        this.hasTerminated = true;
        this.logger.info(`${this.desc()} graceful shutdown started.`);
        await this.shutdown();
        this.logger.info(`${this.desc()} graceful shutdown completed.`);
        process.exit(0);
    }
}
