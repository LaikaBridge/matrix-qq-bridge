import * as winston from "winston";

export const envLogLevel = process.env.LOG_LEVEL || "info";

export const mainLogger = winston.createLogger({
    level: envLogLevel,
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.timestamp({
                    format: "YYYY-MM-DD HH:mm:ss",
                }),
                winston.format.printf(
                    (info) =>
                        `[${info.timestamp}][${info.label}][${info.level}] ${info.message}`,
                ),
                winston.format.colorize({ all: true }),
            ),
        }),
    ],
});

export const createLogger = (base: string | NodeModule) => {
    let label: string;
    if (typeof base === "string") {
        label = base;
    } else {
        const parts = base.filename.split("/");
        label = `${parts[parts.length - 2]}/${parts.pop()}`;
    }
    return mainLogger.child({
        label,
    });
};
