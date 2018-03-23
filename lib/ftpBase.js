const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;

class FtpBase extends EventEmitter {

    constructor (options) {
        super(options);
        this.options = options;
    }

    emit () {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'events')) {
            console.log('emit', arguments);
        }
        return super.emit.apply(this, arguments);
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

    logQueue(message) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'queue')) {
            console.log('QUEUE: ' + message);
        }
    }

    logProgress(message) {
        if (this.options.debug.enabled && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, 'progress')) {
            console.log('Progress: ' + message);
        }
    }

    sanitizeCommand(command) {
        let sanitized;
        if (!command.match(/^PASS/i)) {
            sanitized = command;
        } else {
            sanitized = 'PASS ******';
        }
        return sanitized;
    }

    /**
     * Helper method for adding event listener to an object
     *
     * @param {Object}   object     Object that listener will be added to
     * @param {String}   eventName  Name of the event to observe
     * @param {Function} handler    Handler method that event will trigger
     * @return {undefined}
     */
    addObjListener(object, eventName, handler) {
        this.logDebug('Add listener for ' + eventName);
        if (object && object.on && _.isFunction(object.on)){
            object.on(eventName, handler);
        }
    }

    /**
     * Helper method for adding event 'once' listener to an object
     *
     * @param {Object}   object     Object that listener will be added to
     * @param {String}   eventName  Name of the event to observe
     * @param {Function} handler    Handler method that event will trigger
     * @return {undefined}
     */
    addOnceObjListener(object, eventName, handler) {
        this.logDebug('Add "once" listener for ' + eventName);
        if (object && object.once && _.isFunction(object.once)){
            object.once(eventName, handler);
        }
    }

    /**
     * Helper method for removing event listener (added with addObjListener or addOnceObjListener method) on an object
     *
     * @param {Object}   object     Object that listener will be removed from
     * @param {String}   eventName  Name of the event to remove listener for
     * @param {Function} handler    Handler method that event was bound to
     * @return {undefined}
     */
    removeObjListener(object, eventName, handler) {
        this.logDebug('Remove listener for ' + eventName);
        if (object && object.removeListener && _.isFunction(object.removeListener)){
            object.removeListener(eventName, handler);
        }
    }
}

module.exports = FtpBase;