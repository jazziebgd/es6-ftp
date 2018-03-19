const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;

class FtpBase extends EventEmitter {

    constructor (options) {
        super(options);
        this.options = options;
    }

    log(message) {
        console.log(message);
    }

    logCommand (command) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'commands')) {
            if (!(this.options.debug.debugCommands && this.options.debug.debugCommands.length) || _.includes(this.options.debug.debugCommands, command.split(' ')[0])) {
                console.log('SEND CMD: ' + command);
            }
        }
    }

    logCall(fName, fArguments) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'functionCalls') && this.options.debug.debugFunctions[fName]) {
            console.log('FUNC: ' + fName, fArguments);
        }
    }

    logResponse(message) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'responses')) {
            console.log(message);
        }
    }

    logDebug(message) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'debug')) {
            console.log(message);
        }
    }

    logInfo(message) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'info')) {
            console.log(message);
        }
    }

    logWarning(message) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'warning')) {
            console.warn(message);
        }
    }

    logError(message) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'error')) {
            console.error(message);
        }
    }
}

module.exports = FtpBase;