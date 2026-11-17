const winston = require("winston");
const { config, format, transports } = winston;
const { LEVEL, MESSAGE, SPLAT } = require("triple-beam");
const namespaces = require("winston-namespace/namespaces");
const v8 = require("v8");
const { combine, label, printf } = format;

const namespaceMeta = (info) => {
    let functionName, meta;
    if (info[SPLAT]) {
        if (typeof info[SPLAT][0] === "string") {
            [functionName, meta] = info[SPLAT];
        }
        else {
            meta = info[SPLAT];
        }
    }
    return [`${info["label"]}${functionName ? ":" + functionName : ""}`, meta];
};

const customFormat = printf((info) => {
    const [ns, meta] = namespaceMeta(info);
    const baseFormat = `${info["level"].toUpperCase()} ${ns}`;
    if (info["message"]) {
        const messageFormat = `${baseFormat} - ${info["message"]}`;
        if (meta) {
            return `${messageFormat} - ${JSON.stringify(meta)}`;
        }
        return messageFormat;
    }
    return baseFormat;
});


let customConsole;
let logger;

module.exports = (namespace) => {
    if (!customConsole) {
        customConsole = new transports.Console({
            log (info, callback) {
                setImmediate(() => this.emit("logged", info));
                const [ns, _] = namespaceMeta(info);
                const enabled = namespaces.check(ns);
                switch (info[LEVEL]) {
                case config.npm.levels.error:
                    console.error(info[MESSAGE]);
                    break;
                case config.npm.levels.warn:
                    console.warn(info[MESSAGE]);
                    break;
                case config.npm.levels.info:
                    console.info(info[MESSAGE]);
                    break;
                default:
                    if (enabled) {
                        console.debug(info[MESSAGE]);
                    }
                    break;
                }
                if (callback) {
                    callback();
                }
                return;
            }
        });
    }
    const baseOptions = {
        level: process.env.LOG_LEVEL || "info",
        levels: config.npm.levels,
        transports: [
            customConsole
        ],
        format: combine(
            label({ label: namespace }),
            customFormat,
        )
    };

    if (!logger) {
      logger = winston.createLogger(baseOptions);
      console.log(`Logger Created (${process.pid})`);
    }
    console.log(`Logger Namespace ${namespace} Created (${process.pid})`);

    return {
        error: (message, ...meta) => logger.error(message, ...meta),
        warn: (message, ...meta) => logger.warn(message, ...meta),
        info: (message, ...meta) => logger.info(message, ...meta),
        debug: (message, ...meta) => logger.debug(message, ...meta),
        startTrace: (functionName, ...meta) => logger.debug("START", functionName, v8.getHeapStatistics(),...meta),
        trace: (functionName, ...meta) => logger.debug("TRACE", functionName, ...meta),
        endTrace: (functionName, ...meta) => logger.debug("END", functionName, v8.getHeapStatistics(), ...meta),
    };
};
