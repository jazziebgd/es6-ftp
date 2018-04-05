/**
 * @fileOverview FtpLogger class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');

/**
 * Class FtpLogger
 *
 * Class for logging
 *
 * @extends {FtpBase}
 */
class FtpLogger {

    /**
     * Class constructor
     *
     * @param  {FtpClientConfiguration} options Configuration object
     *
     * @return {undefined}
     */
    constructor (options) {
        this.options = options;
    }

    /**
     * Checks whether debugging is enabled globally
     *
     * @return {Boolean} True if debug is enabled, false otherwise
     */
    debugEnabled () {
        return this.options && this.options.debug && this.options.debug.enabled;
    }

    /**
     * Checks whether given debug level is enabled
     *
     * @param  {String}  debugLevel Debug level name (debug, error, commands etc)
     *
     * @return {Boolean}            True if given debug level is enabled, false otherwise
     */
    hasDebugLevel (debugLevel) {
        return this.debugEnabled() && this.options.debug.debugLevels && _.includes(this.options.debug.debugLevels, debugLevel);
    }

    /**
     * Method that logs message to console
     *
     * @return {undefined}
     */
    log() {
        console.log.apply(console, Array.prototype.slice.call(arguments));
    }

    /**
     * Method that logs info message to console
     *
     * @return {undefined}
     */
    info() {
        this.log.apply(this, Array.prototype.slice.call(arguments));
    }

    /**
     * Method that logs debug message to console
     *
     * @return {undefined}
     */
    debug() {
        this.log.apply(this, Array.prototype.slice.call(arguments));
    }

    /**
     * Method that logs warning message to console
     *
     * @return {undefined}
     */
    warn() {
        console.warn.apply(console, Array.prototype.slice.call(arguments));
    }

    /**
     * Method that logs error message to console
     *
     * @return {undefined}
     */
    error() {
        console.error.apply(console, Array.prototype.slice.call(arguments));
    }

    /**
     * Method that logs commands to console
     *
     * @param  {String} command Command to log
     *
     * @return {undefined}
     */
    logCommand (command) {
        if (this.hasDebugLevel('commands')) {
            if (!(this.options.debug.debugCommands && this.options.debug.debugCommands.length) || _.includes(this.options.debug.debugCommands, command.split(' ')[0])) {
                this.log('SEND CMD: ' + command);
            }
        }
    }

    /**
     * Method that logs function calls
     *
     * @param  {String} fName      Name of the method to log
     * @param  {Array}  fArguments Method arguments
     *
     * @return {undefined}
     */
    logCall(fName, fArguments) {
        if (this.hasDebugLevel('functionCalls') && this.options.debug.debugFunctions[fName]) {
            this.log('FUNC: ' + fName, fArguments);
        }
    }

    /**
     * Method that logs ftp server responses
     *
     * @param  {Mixed} message Response to log
     *
     * @return {undefined}
     */
    logResponse(message) {
        if (this.hasDebugLevel('responses')) {
            this.log('RESPONSE', message);
        }
    }

    /**
     * Method that logs debug messages
     *
     * @param  {Mixed} message Message to log
     *
     * @return {undefined}
     */
    logDebug(message) {
        if (this.hasDebugLevel('debug')) {
            this.log('DEBUG', message);
        }
    }

    /**
     * Method that logs info messages
     *
     * @param  {Mixed} message Message to log
     *
     * @return {undefined}
     */
    logInfo(message) {
        if (this.hasDebugLevel('info')) {
            this.log('INFO', message);
        }
    }

    /**
     * Method that logs warning messages
     *
     * @param  {Mixed} message Message to log
     *
     * @return {undefined}
     */
    logWarning(message) {
        if (this.hasDebugLevel('warning')) {
            this.warn(message);
        }
    }

    /**
     * Method that logs error messages
     *
     * @param  {Mixed} message Message to log
     *
     * @return {undefined}
     */
    logError(message) {
        if (this.hasDebugLevel('error')) {
            this.error(message);
        }
    }

    /**
     * Method that logs queue messages
     *
     * @param  {Mixed} message Message to log
     *
     * @return {undefined}
     */
    logQueue(message) {
        if (this.hasDebugLevel('queue')) {
            this.log('QUEUE', message);
        }
    }

    /**
     * Method that logs progress messages
     *
     * @param  {Mixed} message Message to log
     *
     * @return {undefined}
     */
    logProgress(message) {
        if (this.hasDebugLevel('progress')) {
            this.log('PROGRESS', message);
        }
    }
}

module.exports = FtpLogger;