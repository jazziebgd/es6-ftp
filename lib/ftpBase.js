/**
 * @fileOverview FtpBase class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;

class FtpBase extends EventEmitter {

    constructor (options) {
        super(options);
        this.options = options;
    }

    debugEnabled () {
        return this.options && this.options.debug && this.options.debug.enabled;
    }

    hasDebugLevel (debugLevel) {
        return this.debugEnabled() && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, debugLevel);
    }

    emit () {
        if (this.hasDebugLevel('events')) {
            console.log('emit', arguments);
        }
        return super.emit.apply(this, arguments);
    }

    log(message) {
        console.log(message);
    }

    logCommand (command) {
        if (this.hasDebugLevel('commands')) {
            if (!(this.options.debug.debugCommands && this.options.debug.debugCommands.length) || _.includes(this.options.debug.debugCommands, command.split(' ')[0])) {
                console.log('SEND CMD: ' + command);
            }
        }
    }

    logCall(fName, fArguments) {
        if (this.hasDebugLevel('functionCalls') && this.options.debug.debugFunctions[fName]) {
            console.log('FUNC: ' + fName, fArguments);
        }
    }

    logResponse(message) {
        if (this.hasDebugLevel('responses')) {
            console.log('RESPONSE', message);
        }
    }

    logDebug(message) {
        if (this.hasDebugLevel('debug')) {
            console.log('DEBUG', message);
        }
    }

    logInfo(message) {
        if (this.hasDebugLevel('info')) {
            console.log('INFO', message);
        }
    }

    logWarning(message) {
        if (this.hasDebugLevel('warning')) {
            console.warn(message);
        }
    }

    logError(message) {
        if (this.hasDebugLevel('error')) {
            console.error(message);
        }
    }

    logQueue(message) {
        if (this.hasDebugLevel('queue')) {
            console.log('QUEUE', message);
        }
    }

    logProgress(message) {
        if (this.hasDebugLevel('progress')) {
            console.log('PROGRESS', message);
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

    /**
     * Checks whether given ftp request instance requires passive mode
     *
     * @param  {FtpRequest} ftpRequest  Ftp request
     * @return {Boolean}                True if passive, false otherwise
     */
    isRequestPassive(ftpRequest) {
        let requestPassive = false;
        if (ftpRequest && ftpRequest.baseCommand) {
            for (let i=0; i<this.ftpClientData.passiveCommands.length; i++){
                if (ftpRequest.baseCommand.match(new RegExp(this.ftpClientData.passiveCommands[i], 'i'))) {
                    requestPassive = true;
                }
            }
            ftpRequest.isPassive = requestPassive;
        }
        return requestPassive;
    }

    /**
     * Checks whether given ftp request instance requires passive mode
     *
     * @param  {FtpRequest} ftpRequest  Ftp request
     * @return {Boolean}                True if passive, false otherwise
     */
    isRequestUpload(ftpRequest) {
        let requestUpload = false;
        let requestPassive = this.isRequestPassive(ftpRequest);
        if (requestPassive && ftpRequest && ftpRequest.baseCommand) {
            for (let i=0; i<this.ftpClientData.uploadCommands.length; i++){
                if (ftpRequest.baseCommand.match(new RegExp(this.ftpClientData.uploadCommands[i], 'i'))) {
                    requestUpload = true;
                }
            }
            ftpRequest.isUpload = requestUpload;
        }
        return requestUpload;
    }

    /**
     * Asynchronous wait function - waits for n milliseconds before returning true
     *
     * @async
     * @param  {Number} milliseconds Number of milliseconds to wait
     * @return {Boolean}             Returns true
     */
    async wait(milliseconds = 0) {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(true);
            }, milliseconds);
        });
    }
}

module.exports = FtpBase;