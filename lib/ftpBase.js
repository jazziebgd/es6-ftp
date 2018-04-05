/**
 * @fileOverview FtpBase class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;
const FtpLogger = require('./ftpLogger');

/**
 * FtpClientDebugConfiguration Object that contains ftp client debug configuration data
 * @typedef  {Object}    FtpClientDebugConfiguration
 *
 * @property {Boolean}  enabled                     Flag to enable or disable debugging globally
 * @property {String[]} debugLevels                 An array of debug levels (debug, info, warning, error, queue, events, progress, commands, responses, functionCalls)
 * @property {Object}   debugFunctions              Object that controls function calls logging with function (method) names as keys and true/false as values
 * @property {String[]} debugCommands               An array of base FTP commands to debug (i.e. LIST, STOR, SYST)

/**
 * FtpClientConfiguration Object that contains ftp client configuration data
 * @typedef  {Object}    FtpClientConfiguration
 *
 * @property {Boolean}                      compression             Flag to enable or disable compression globally
 * @property {Number}                       compressionLevel        Compression level (1-9)
 * @property {Object}                       ftpClientData           Ftp client data object
 * @property {Class}                        fileItemClass           Custom file item class implementation
 * @property {Class}                        ftpResponseParserClass  Custom ftp response parser class implementation
 * @property {Class}                        ftpRequestClass         Custom ftp request class implementation
 * @property {Boolean}                      limitSpeed              Flag to enable or disable transfer speed throttling
 * @property {Number}                       limitUpload             Value for upload speed limiting (bytes / second)
 * @property {Number}                       limitDownload           Value for download speed limiting (bytes / second)
 * @property {Number}                       maxPassiveRetries       Maximum number of retries for establishing PASV data connection
 * @property {Boolean}                      keepFinishedQueue       Flag to enable or disable storing finished requests
 * @property {FtpClientDebugConfiguration}  debug                   Ftp client debug configuration
 */

/**
 * FtpSecureConnectionConfiguration Object that contains ftp secure connection configuration data
 * @typedef  {Object}    FtpSecureConnectionConfiguration
 *
 * @property {String}       host                Hostname for the secure connection
 * @property {Socket}       socket              Source socket for secure connection
 * @property {Uint8Array}   session             ASN.1 encoded TLS session
 * @property {Boolean}      rejectUnauthorized  Flag to indicate whether to reject unathorized (i.e. self-signed) certificates
*/

/**
 * FtpConnectionConfiguration Object that contains ftp connection configuration data
 * @typedef  {Object}    FtpConnectionConfiguration
 *
 * @property {String}                               host            Hostname for the connection
 * @property {Number}                               port            Port for the connection
 * @property {String}                               user            Username for authentication if required
 * @property {String}                               password        Password for authentication if required
 * @property {Boolean}                              secure          Flag that indicates whether connection is secure
 * @property {FtpSecureConnectionConfiguration}     secureOptions   Secure connection options
 * @property {Number}                               connTimeout     Number of milliseconds for connection timeout
 * @property {Number}                               pasvTimeout     Number of milliseconds for passive connection timeout
 * @property {Number}                               aliveTimeout    Number of milliseconds for alive timeout
 */

/**
 * Class FtpBase
 *
 * Base class for extending, containing basic logging and common logic for all client classes
 *
 * @extends {EventEmitter}
 */
class FtpBase extends EventEmitter {

    /**
     * Class constructor
     *
     * @param  {FtpClientConfiguration} options Configuration object
     *
     * @return {undefined}
     */
    constructor (options) {
        super(options);

        this.defaultOptions = {
            compression: false,
            compressionLevel: 8,
            ftpClientData: null,
            fileItemClass: null,
            ftpResponseParserClass: null,
            ftpRequestClass: null,
            limitSpeed: false,
            limitUpload: 10000,
            limitDownload: 10000,
            maxPassiveRetries: 3,
            keepFinishedQueue: false,
            loggerClass: FtpLogger,

            defaultConnection: {
                host: undefined,
                port: undefined,
                user: undefined,
                password: undefined,
                secure: false,
                secureOptions: {
                    host: null,
                    socket: null,
                    session: null,
                    rejectUnauthorized: false,
                },
                connTimeout: 10000,
                pasvTimeout: 10000,
                aliveTimeout: 10000
            },

            debug: {
                enabled: false,
                debugLevels: [
                    // 'debug',
                    // 'info',
                    'warning',
                    'error',

                    // 'queue',
                    // 'events',
                    // 'socketEvents',
                    // 'progress',

                    // 'commands',
                    // 'responses',
                    // 'functionCalls',
                ],
                debugFunctions: {
                    // handleData: true,
                },
                debugCommands: [],
            },
        };

        this.setOptions(options);
        this.initializeLogger();
    }

    /**
     * Sets client options (or resets them if no options passed)
     *
     * @param {FtpClientConfiguration|undefined} options Options object or undefined to reset options to defaults
     *
     * @return {undefined}
     */
    setOptions(options) {
        if (options && _.isObject(options)) {
            this.options = _.defaultsDeep(options, this.defaultOptions);
        } else {
            this.options = _.cloneDeep(this.defaultOptions);
        }
    }


    /**
     * Sets option for ftp client instance
     *
     * @param {String}  optionPath  Path to property to set (i.e. 'debug.enabled' or 'limitSpeed')
     * @param {Mixed}   optionValue Value to set for the option
     *
     * @return {undefined}
     */
    setOption(optionPath, optionValue) {
        _.set(this.options, optionPath, optionValue);
    }

    /**
     * Gets value of option for ftp client instance
     *
     * @param {String}  optionPath      Path to property to get (i.e. 'debug.enabled' or 'limitSpeed')
     * @param {Mixed}   defaultValue    Default value to return if option is undefined
     *
     * @return {Mixed}                  Value of the option or defaultValue if option value is undefined
     */
    getOption(optionPath, defaultValue) {
        return _.get(this.options, optionPath, defaultValue);
    }

    /**
     * Initializes logger object based on the options
     *
     * @return {undefined}
     */
    initializeLogger () {
        if (!this.logger) {
            if (this.options.loggerClass) {
                let loggerOptions = {};
                loggerOptions.debug = this.options.debug;
                this.logger = new this.options.loggerClass(loggerOptions);
            } else {
                this.logger = console;
            }
        }
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
     * Override for default 'emit' implementation
     *
     * @return {undefined}
     */
    emit () {
        if (this.hasDebugLevel('events')) {
            this.log('emit', arguments);
        }
        return super.emit.apply(this, arguments);
    }

    /**
     * Method that logs message to console
     *
     * @return {undefined}
     */
    log() {
        this.logger.log.apply(this.logger, Array.prototype.slice.call(arguments));
        // if (this.options.loggerTransport && this.options.loggerTransport.log && _.isFunction(this.options.loggerTransport.log)) {
        //     this.options.loggerTransport.log.apply(this.options.loggerTransport, Array.prototype.slice.call(arguments));
        // } else {
        //     console.log.apply(console, Array.prototype.slice.call(arguments));
        // }
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
        this.logger.warn.apply(this.logger, Array.prototype.slice.call(arguments));
        // if (this.options.loggerTransport && this.options.loggerTransport.warn && _.isFunction(this.options.loggerTransport.warn)) {
        //     this.options.loggerTransport.warn.apply(this.options.loggerTransport, Array.prototype.slice.call(arguments));
        // } else {
        //     console.warn.apply(console, Array.prototype.slice.call(arguments));
        // }
    }

    /**
     * Method that logs error message to console
     *
     * @return {undefined}
     */
    error() {
        this.logger.error.apply(this.logger, Array.prototype.slice.call(arguments));
        // if (this.options.loggerTransport && this.options.loggerTransport.error && _.isFunction(this.options.loggerTransport.error)) {
        //     this.options.loggerTransport.error.apply(this.options.loggerTransport, Array.prototype.slice.call(arguments));
        // } else {
        //     console.error.apply(console, Array.prototype.slice.call(arguments));
        // }
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

    /**
     * Method that sanitizes command before logging (obfuscates password from PASS command)
     *
     * @param  {String} command Command to sanitize
     *
     * @return {String}         Sanitized command
     */
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