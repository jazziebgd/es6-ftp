class FtpLogger {

    constructor (options) {
        this.options = options;
    }

    log(message) {
        console.log(message);
    }

    logCommand (command) {
        if (this.options.debug.enabled && _.includes(this.options.debug.debugLevels, 'commands')) {
            console.log('SEND CMD: ' + command);
        }
    }

    logCall(fName, fArguments) {
        if (this.options.debug.enabled && _.includes(this.options.debug.debugLevels, 'functionCalls') && this.options.debug.debugFunctions[fName]) {
            console.log('FUNC: ' + fName, fArguments);
        }
    }

    logResponse(message) {
        if (this.options.debug.enabled && _.includes(this.options.debug.debugLevels, 'responses')) {
            console.log(message);
        }
    }

    logDebug(message) {
        if (this.options.debug.enabled && _.includes(this.options.debug.debugLevels, 'debug')) {
            console.log(message);
        }
    }

    logInfo(message) {
        if (this.options.debug.enabled && _.includes(this.options.debug.debugLevels, 'info')) {
            console.log(message);
        }
    }

    logWarning(message) {
        if (this.options.debug.enabled && _.includes(this.options.debug.debugLevels, 'warning')) {
            console.warn(message);
        }
    }

    logError(message) {
        if (this.options.debug.enabled && _.includes(this.options.debug.debugLevels, 'error')) {
            console.error(message);
        }
    }
};

module.exports = FtpLogger;