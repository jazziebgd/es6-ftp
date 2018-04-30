/**
 * @fileOverview FtpClient class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');
const fs = require('fs');
// const path = require('path');
const zlib = require('zlib');
const tls = require('tls');
const ftpClientData = require('./ftpClientData');
const FtpFileItem = require('./ftpFileItem');
const FtpRequest = require('./ftpRequest');
const FtpResponseParser = require('./ftpResponseParser');
const FtpLimiter = require('./ftpLimiter');
const FtpBase = require('./ftpBase');
const Socket = require('net').Socket;
const stream = require('stream');
const Writable = stream.Writable;


/**
 * Class FtpClient
 *
 * Ftp client class for connecting to FTP server and performing FTP operations
 *
 * @extends {FtpBase}
 */
class FtpClient extends FtpBase {

    /**
     * Constructor method
     *
     * @param  {FtpClientConfiguration}     options     Ftp client options object
     *
     * @return {undefined}
     */
    constructor(options = null) {
        super(options);

        this.busy = false;

        this.connected = false;
        this.secureConnected = false;

        this.isPassive = false;
        this.passiveRetryCount = 0;

        this.queue = [];
        this.finishedQueue = [];
        this.queuePaused = false;

        this._currentBuffer = '';
        this._currentPassiveBuffer = '';

        this.features = [];

        this.greeting ='';

        this.currentProgress = 0;

        this.currentLimiter = null;

        this.socket = null;
        this.secureSocket = null;

        this.passiveSocket = null;
        this.securePassiveSocket = null;

        this.securityState = null;
        this.secureOptions = {
            host: null,
            socket: null,
            session: null,
            rejectUnauthorized: false,
        };

        this.handlingProgress = false;
        this.metaData = {
            activeFtpRequest: null,
        };

        this.statistics = {
            averageSpeed: 0,
            averageSpeedHistory: [],
            compressionEnabled: false,
            currentSpeed: 0,
            currentDownloadSpeed: 0,
            currentDownloadSpeedHistory: [],
            currentUploadSpeed: 0,
            currentUploadSpeedHistory: [],
            totalCommands: 0,
            totalTransferred: 0
        };

        this.intermediateStatistics = {
            measureCount: 0,
            previousTime: 0,
            previousTransferred: 0,
            speedSum: 0,
        };

        if (this.options.connection && _.isObject(this.options.connection)) {
            this.connection = _.defaultsDeep(this.options.connection, this.options.defaultConnection);
        }

        this.boundMethods = {
            handleData: this.handleData.bind(this),
            handlePassiveData: this.handlePassiveData.bind(this),
            onTimeout: this.onTimeout.bind(this),
            onData: this.onData.bind(this),
            onEnd: this.onEnd.bind(this),
            onClose: this.onClose.bind(this),
            onError: this.onError.bind(this),
            onPassiveTimeout: this.onPassiveTimeout.bind(this),
            onPassiveData: this.onPassiveData.bind(this),
            onPassiveClose: this.onPassiveClose.bind(this),
            onPassiveEnd: this.onPassiveEnd.bind(this),
            onPassiveError: this.onPassiveError.bind(this),
            onResponse: this.onResponse.bind(this),
            onQueueComplete: this.onQueueComplete.bind(this),
            onQueueAdd: this.onQueueAdd.bind(this),
            onQueueRemove: this.onQueueRemove.bind(this),
            onQueuePause: this.onQueuePause.bind(this),
            onQueueResume: this.onQueueResume.bind(this),
            onProgress: this.onProgress.bind(this),
        };

        this.responseHandler = new Writable({
            write: this.boundMethods.handleData
        });
        this.passiveResponseHandler = new Writable({
            write: this.boundMethods.handlePassiveData
        });

        this.initializeClasses();

        // process.on('uncaughtException', function (err, c, d, e, f) {
        //     console.log(err, c, d, e, f);
        // });
    }

    /**
     * Initializes default (or custom if passed in options) classes for objects used by FtpClient
     *
     * @return {undefined}
     */
    initializeClasses () {
        let fcd = ftpClientData;
        if (this.options.ftpClientData) {
            fcd = this.options.ftpClientData;
        }
        this.setFtpClientData(fcd);

        let fic = FtpFileItem;
        if (this.options.fileItemClass) {
            fic = this.options.fileItemClass;
        }
        this.setFileItemClass(fic);

        let frp = FtpResponseParser;
        if (this.options.ftpResponseParserClass) {
            frp = this.options.ftpResponseParserClass;
        }
        this.setParserClass(frp);
        this.initializeParser();

        let frc = FtpRequest;
        if (this.options.ftpRequestClass) {
            frc = this.options.ftpRequestClass;
        }
        this.setFtpRequestClass(frc);
    }

    /**
     * Initializes ftp response parser object
     *
     * @return {undefined}
     */
    initializeParser() {
        this.setParser(new this.parserClass(this.fileItemClass));
    }

    /**
     * Sets ftpClientData object for this instance
     *
     * @param {Object}  clientData  Client data object
     *
     * @return {undefined}
     */
    setFtpClientData(clientData) {
        this.ftpClientData = clientData;
    }

    /**
     * Sets class that is to be used as ftp response parser for this instance
     *
     * @param {Class} parserClass    ftp response parser class
     *
     * @return {undefined}
     */
    setParserClass(parserClass) {
        this.parserClass = parserClass;
    }

    /**
     * Sets class that is to be used as ftp request for this instance
     *
     * @param {Class} ftpRequestClass   Ftp request class
     *
     * @return {undefined}
     */
    setFtpRequestClass(ftpRequestClass) {
        this.ftpRequestClass = ftpRequestClass;
    }

    /**
     * Sets parser for this instance
     *
     * @param {Object} parser Ftp response parser object
     *
     * @return {undefined}
     */
    setParser(parser) {
        this.parser = parser;
    }

    /**
     * Sets class that is to be used as file item for this instance
     *
     * @param {Class} fileItemClass   file item class
     *
     * @return {undefined}
     */
    setFileItemClass(fileItemClass) {
        this.fileItemClass = fileItemClass;
    }

    /**
     * Sets connection data for client
     *
     * @param {Object} connection  Connection data
     *
     * @return {undefined}
     */
    setConnection(connection) {
        if (connection && _.isObject(connection)) {
            if (!this.connected) {
                this.connection = _.defaultsDeep(connection, this.options.defaultConnection);
            } else {
                this.logWarning('Can not set connection while connected');
            }
        }
    }

    /**
     * Sets statistics object for client
     *
     * @param {Object} statistics  Statistics object
     *
     * @return {undefined}
     */
    setStatisticsObject(statistics) {
        this.statistics = statistics;
    }

    /**
     * Sets client busy status based on parameter
     *
     * @param {Boolean}     busy    Busy status
     *
     * @return {undefined}
     */
    setBusy(busy) {
        if (busy) {
            if (!this.busy) {
                this.busy = true;
                this.emit('busy');
            }
        } else {
            if (this.busy) {
                this.busy = false;
                this.emit('free');
            }
        }
    }

    /**
     * Adds base socket listeners for client functionality
     *
     * @param {Socket|TLSSocket}  socket    Socket for adding listeners
     * @param {Boolean} passive   Flag to indicate whether socket is passive or active
     *
     * @return {undefined}
     */
    addSocketListeners(socket, passive = false) {
        if (!passive) {
            socket.on('data', this.boundMethods.onData);
            socket.on('end', this.boundMethods.onEnd);
            socket.on('close', this.boundMethods.onClose);
            socket.on('error', this.boundMethods.onError);
            socket.on('timeout', this.boundMethods.onTimeout);
        } else {
            socket.on('data', this.boundMethods.onPassiveData);
            socket.on('end', this.boundMethods.onPassiveEnd);
            socket.on('close', this.boundMethods.onPassiveClose);
            socket.on('error', this.boundMethods.onPassiveError);
            socket.on('timeout', this.boundMethods.onPassiveTimeout);
        }
    }

    /**
     * Removes base socket listeners added with addSocketListeners method
     *
     * @param {Socket|TLSSocket}  socket    Socket for removing listeners
     * @param {Boolean} passive   Flag to indicate whether socket is passive or active
     *
     * @return {undefined}
     */
    removeSocketListeners(socket, passive = false) {
        if (!passive) {
            socket.removeListener('data', this.boundMethods.onData);
            socket.removeListener('end', this.boundMethods.onEnd);
            socket.removeListener('close', this.boundMethods.onClose);
            socket.removeListener('error', this.boundMethods.onError);
            socket.removeListener('timeout', this.boundMethods.onTimeout);
        } else {
            socket.removeListener('data', this.boundMethods.onPassiveData);
            socket.removeListener('close', this.boundMethods.onPassiveClose);
            socket.removeListener('end', this.boundMethods.onPassiveEnd);
            socket.removeListener('error', this.boundMethods.onPassiveError);
            socket.removeListener('timeout', this.boundMethods.onPassiveTimeout);
        }
    }

    /**
     * Adds event listeners for client
     *
     * @return {undefined}
     */
    addEventListeners() {
        this.on('response', this.boundMethods.onResponse);
        this.on('queue:complete', this.boundMethods.onQueueComplete);
        this.on('queue:add', this.boundMethods.onQueueAdd);
        this.on('queue:remove', this.boundMethods.onQueueRemove);
        this.on('queue:pause', this.boundMethods.onQueuePause);
        this.on('queue:resume', this.boundMethods.onQueueResume);
    }

    /**
     * Removes event listeners added with addEventListeners method
     *
     * @return {undefined}
     */
    removeEventListeners() {
        this.removeListener('response', this.boundMethods.onResponse);
        this.removeListener('queue:complete', this.boundMethods.onQueueComplete);
        this.removeListener('queue:add', this.boundMethods.onQueueAdd);
        this.removeListener('queue:remove', this.boundMethods.onQueueRemove);
        this.removeListener('queue:pause', this.boundMethods.onQueuePause);
        this.removeListener('queue:resume', this.boundMethods.onQueueResume);
    }

    /**
     * Adds speed limiter (throttling) to socket or stream (if limiting is enabled in options)
     *
     * @param  {Socket|TLSSocket}           socket      Socket or stream on which speed limit will be applied
     * @param  {FtpRequest|null}            ftpRequest  Ftp request that is bound to this limiter
     * @param  {Number}                     limitRate   Rate (b/s) for transfer limiting
     *
     * @return {Socket|TLSSocket|Stream}                Socket or stream with applied speed limiter
     */
    limitTransferSpeed(socket, ftpRequest, limitRate) {
        let limited = socket;
        this.currentLimiter = new FtpLimiter();
        this.currentLimiter.setLimiting(this.options.limitSpeed);
        this.currentLimiter.setRate(limitRate);
        this.currentLimiter.setFtpRequest(ftpRequest);
        this.currentProgress = 0;
        this.currentLimiter.on('progress', this.boundMethods.onProgress);
        limited = socket.pipe(this.currentLimiter);
        return limited;
    }

    /**
     * Method that handles 'data' event on command sockets
     *
     * @param  {Buffer}   chunk     Buffer with data
     * @param  {String}   encoding  Encoding (default = null)
     * @param  {Function} callback  Callback function
     *
     * @return {undefined}
     */
    handleData (chunk, encoding, callback = null) {
        this.logCall('handleData', arguments);
        this._currentBuffer += chunk.toString('binary');

        let result = false;

        try {
            result = this.parser.parseCommandResponse(_.clone(this._currentBuffer));
        } catch (ex) {
            this.logError('Error parsing response: ' + ex.message + ', response: "' + chunk.toString('binary') + '"');
        }

        if (result) {
            if (!_.isNull(result.responseCode) && !_.isNull(result.text)){
                if (!_.isNull(result.rest)) {
                    this._currentBuffer = result.rest;
                } else {
                    this._currentBuffer = '';
                }
                this.emit('response', result);
            }
        } else {
            this.logError('Error parsing response: "' + chunk.toString('binary') + '"');
        }
        if (callback && _.isFunction(callback)) {
            callback();
        }
    }

    /**
     * Method that handles 'data' event on passive sockets
     *
     * @param  {Buffer}   chunk     Buffer with data
     * @param  {String}   encoding  Encoding (default = null)
     * @param  {Function} callback  Callback function
     *
     * @return {undefined}
     */
    handlePassiveData (chunk, encoding, callback = null) {
        this.logCall('handlePassiveData', arguments);
        this._currentPassiveBuffer += chunk.toString('binary');

        if (callback && _.isFunction(callback)) {
            callback();
        }
    }

    /**
     * Handler for passive socket 'close' event
     *
     * @async
     *
     * @param  {Boolean} hadErr Flag to indicate whether socket had error or not
     *
     * @return {undefined}
     */
    async onPassiveClose (hadErr) {
        this.logCall('onClose', arguments);
        if (hadErr) {
            this.logError('Passive connection closed with error');
        } else {
            this.logInfo('Passive connection closed');
        }
        if (this.isPassive) {
            await this.passiveDisconnect();
        }
    }


    /**
     * Handler for 'end' event on passive sockets
     *
     * @return {undefined}
     */
    onPassiveEnd () {
        this.logCall('onPassiveEnd', arguments);
        let text = this._currentPassiveBuffer;
        this._currentPassiveBuffer = '';
        this.emit('passive-response', text);
    }

    /**
     * Handler for 'error' event on passive sockets
     *
     * @param  {Error|String}  error    Error object or error message
     *
     * @return {undefined}
     */
    onPassiveError (error) {
        this.logCall('onPassiveError', arguments);
        this.logError(error);
        this.emit('error', error);
    }

    /**
     * Connects to ftp server using either connection data from argument or this.connection (if no argument passed)
     * Reads feature list from ftp server and sets up secure transfer if enabled in connection data and supported by server
     * Sets transfer mode to 'binary' by default
     *
     * @async
     * @throws {Error} If connection can't be established
     * @param  {Object} connection  Connection options
     *
     * @return {Boolean}            Connecting result
     */
    async connect (connection = null) {
        let _connect = async (resolve, reject) => {
            try {
                this.connected = await this.establishConnection(connection);
            } catch (ex) {
                reject(ex);
            }

            if (this.connected) {
                this.addSocketListeners(this.socket);
                this.addEventListeners();
                this.once('response', async () => {
                    await this.getFeatures();
                    await this.setSecurity();
                    this.canUseCompression();
                    let loggedIn = false;
                    if (this.connection.user && this.connection.password) {
                        try {
                            loggedIn = await this.login();
                        } catch (ex) {
                            reject(ex);
                        }
                    }
                    if (loggedIn) {
                        await this.binary();
                        this.emit('ready');
                        resolve(true);
                    } else {
                        reject(new Error('Can not log in'));
                    }
                });
                // setTimeout(async () => {
                //     this.socket.removeListener('data', this.boundMethods.onData);
                //     await this.getFeatures();
                //     await this.setSecurity();
                //     if (this.connection.user && this.connection.password) {
                //         await this.login();
                //     }
                //     await this.binary();
                //     setTimeout(() => {
                //         this.emit('ready');
                //         resolve(true);
                //     }, 1000);
                // }, 1000);
                // await this.getFeatures();
                // await this.setSecurity();
                // if (this.connection.user && this.connection.password) {
                //     await this.login();
                // }
                // await this.binary();
                // this.emit('ready');
                // resolve(true);
            }
        };
        return new Promise(_connect);
    }

    /**
     * Internal method that connects to FTP server
     *
     * @async
     * @throws {Error} If connection can't be established
     * @param  {Object} connection  Connection options
     *
     * @return {Boolean}            Connecting result
     */
    async establishConnection (connection = null) {
        if (!connection) {
            connection = this.connection;
        } else {
            this.connection = connection;
        }
        this.connection = _.defaultsDeep(this.connection, this.options.defaultConnection);
        let host = this.connection.host;
        let port = this.connection.port;

        this.socket = new Socket();
        this.socket.setTimeout(0);
        this.socket.setKeepAlive(true);
        // this.overrideEmitLog(this.socket, 'SOCKET', ['end', 'close', 'error']);

        let _establishConnection = (resolve, reject) => {
            let onError = async (err) => {
                this.removeObjListener(this.socket, 'connect', onConnect);
                reject(err);
            };
            let onConnect = async () => {
                this.logInfo('Ftp connected');
                this.removeObjListener(this.socket, 'error', onError);
                resolve(true);
            };
            this.addOnceObjListener(this.socket, 'connect', onConnect);
            this.addOnceObjListener(this.socket, 'error', onError);
            this.socket.connect(port, host);
        };
        return new Promise(_establishConnection);
    }

    /**
     * Disconnects current active FTP connection
     *
     * @async
     *
     * @return {undefined}
     */
    async disconnect() {
        this.logCall('disconnect', arguments);
        let disconnected = !this.connected;
        if (!disconnected) {
            let promises = [];
            if (this.isPassive) {
                await this.passiveDisconnect();
            }

            let disconnectSocket = false;
            if (this.socket && !this.socket.destroyed) {
                disconnectSocket = true;
            }
            let disconnectSecureSocket = false;
            if (this.secureSocket && !this.secureSocket.destroyed) {
                disconnectSecureSocket = true;
            }
            let _disconnectSocket = async (resolveFirst) => {
                if (this.socket && !this.socket.destroyed) {
                    let _onSocketClose = (hadErrors) => {
                        if (hadErrors) {
                            this.logError('Socket had errors on closing');
                        }
                        this.reset();
                        resolveFirst(true);
                    };

                    this.socket.removeAllListeners();
                    this.addOnceObjListener(this.socket, 'close', _onSocketClose);
                    this.socket.destroy();
                } else {
                    this.logWarning('Socket unavailable or already disconnected');
                    this.reset();
                    resolveFirst(true);
                }
            };
            let _disconnectSecureSocket = async (resolveSecond) => {
                if (this.secureSocket && !this.secureSocket.destroyed) {
                    let _onSecureSocketClose = (hadErrors) => {
                        if (hadErrors) {
                            this.logError('Secure socket had errors on closing');
                        }
                        this.reset();
                        resolveSecond(true);
                    };
                    this.secureSocket.removeAllListeners();
                    this.addOnceObjListener(this.secureSocket, 'close', _onSecureSocketClose);
                    this.secureSocket.destroy();
                } else {
                    this.reset();
                    resolveSecond(true);
                }
            };
            if (disconnectSecureSocket){
                promises.push(new Promise(_disconnectSecureSocket));
            } else if (disconnectSocket){
                promises.push(new Promise(_disconnectSocket));
            }

            if (promises.length) {
                return new Promise( (resolve, reject) => {
                    Promise.all(promises).then(() => {
                        this.removeEventListeners();
                        this.reset();
                        resolve(true);
                    }).catch((ex) => {
                        this.logError(ex + '');
                        reject(ex);
                    });
                });
            } else {
                return true;
            }
        } else {
            return true;
        }
    }

    /**
     * Resets ftp statistics data
     *
     * @return {undefined}
     */
    resetStatistics () {
        this.statistics.averageSpeed = 0;
        this.statistics.averageSpeedHistory = [];
        this.statistics.compressionEnabled = false;
        this.statistics.currentSpeed = 0;
        this.statistics.currentUploadSpeed = 0;
        this.statistics.currentUploadSpeedHistory = [];
        this.statistics.currentDownloadSpeed = 0;
        this.statistics.currentDownloadSpeedHistory = [];
        this.statistics.totalCommands = 0;
        this.statistics.totalTransferred = 0;

        this.intermediateStatistics.measureCount = 0;
        this.intermediateStatistics.previousTime = 0;
        this.intermediateStatistics.previousTransferred = 0;
        this.intermediateStatistics.speedSum = 0;
        this.canUseCompression();
    }

    /**
     * Resets ftp client data
     *
     * @return {undefined}
     */
    reset () {
        this.features = [];
        this.greeting = '';
        this.securityState = null;
        this.queue = [];
        this.finishedQueue = [];

        this.features = [];

        this._currentBuffer = '';
        this._currentPassiveBuffer = '';

        this.connected = false;
        this.secureConnected = false;
        this.isPassive = false;
        this.secureOptions = {
            host: null,
            socket: null,
            session: null,
            rejectUnauthorized: false,
        };

        this.resetStatistics();

        this.socket = null;
        this.secureSocket = null;
        this.passiveSocket = null;
        this.securePassiveSocket = null;
    }

    /**
     * Sets security level if specified by connection options
     *
     * @async
     *
     * @return {Boolean} Security setting result
     */
    async setSecurity () {
        this.logCall('setSecurity', arguments);
        let error = false;
        if (this.connection.secure) {
            try {
                let ftpRequest = await this.executeCommand('AUTH TLS', null, true);
                if (!(ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 234)) {
                    error = new Error(ftpRequest.response);
                }
            } catch (ex) {
                error = ex;
            }
            if (!error) {
                this.securityState = 'tls';
                this.secureOptions.host = this.connection.host;
                this.secureOptions.socket = this.socket;
                return await this.connectSecure();
            } else {
                this.logError(error + '');
                this.securityState = null;
                return false;
            }
        } else {
            return true;
        }
    }

    /**
     * Established secure connection
     *
     * @async
     * @throws {Exception} If secure connection can't be established
     *
     * @return {Boolean} Connecting result
     */
    async connectSecure() {
        this.logCall('connectSecure', arguments);
        if (this.securityState == 'tls') {
            let error = false;
            return new Promise( async (resolve, reject) => {
                let _onSecureConnect = async () => {
                    this.logInfo('Secure connection established');
                    if (this.secureSocket) {
                        this.secureSocket.setEncoding('binary');
                        this.secureSocket.setKeepAlive(true);
                        this.secureConnected = true;
                        // this.removeSocketListeners(this.socket);
                        this.addSocketListeners(this.secureSocket);
                        // this.overrideEmitLog(this.secureSocket, 'SECS', ['end', 'close', 'error']);
                    } else {
                        this.logError('Secure connection failed');
                    }
                    try {
                        let ftpRequest = await this.send('PBSZ 0');
                        if (!(ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 200)) {
                            error = new Error(ftpRequest.response);
                        }
                    } catch (ex) {
                        error = ex;
                    }

                    if (!error) {
                        try {
                            let ftpRequest = await this.send('PROT P');
                            if (!(ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 200)) {
                                error = new Error(ftpRequest.response);
                            }
                        } catch (ex) {
                            error = ex;
                        }
                    }

                    if (error) {
                        reject(error);
                    } else {
                        resolve(true);
                    }
                };
                this.secureSocket = tls.connect(this.secureOptions, _onSecureConnect);
            });
        } else {
            return false;
        }
    }

    /**
     * Reads and parses feature list from FTP server
     *
     * @async
     *
     * @return {undefined}
     */
    async getFeatures() {
        this.logCall('getFeatures', arguments);
        let feat = await this.executeCommand('FEAT');
        if (feat && feat.text) {
            this.features = this.parser.parseFeatures(feat.text);
        }
    }

    /**
     * Checks whether server supports given command
     *
     * @param  {String} featureCommand  Command to check support for
     *
     * @return {Boolean}                True if supported, false otherwise
     */
    hasFeature(featureCommand) {
        return this.features.indexOf(featureCommand) !== -1;
    }

    /**
     * Logs user on FTP server
     *
     * @async
     * @throws {Exception} If login error occurs
     *
     * @return {Boolean} Login result
     */
    async login() {
        this.logCall('login', arguments);
        let loggedIn = false;
        if (this.connection && this.connection.user && this.connection.password) {
            let username = this.connection.user;
            let password = this.connection.password;
            let userResponse;
            this.logDebug('Logging in...');
            try {
                userResponse = await this.executeCommand('USER ' + username);
            } catch (ex) {
                this.logError('Problem logging in - error sending USER: ' + ex.message);
                throw(ex);
            }
            if (userResponse && userResponse.responseCode && userResponse.responseCode == 331) {
                this.logDebug('Username accepted, sending password...');
                let passResponse;
                try {
                    passResponse = await this.executeCommand('PASS ' + password);
                } catch (ex) {
                    this.logError('Problem logging in - error sending PASS: ' + ex.message);
                    throw(ex);
                }
                if (passResponse && passResponse.responseCode && passResponse.responseCode == 230) {
                    this.logInfo('Password accepted, login successful.');
                    loggedIn = true;
                } else {
                    this.logError('Problem logging in: ' + passResponse.text);
                    let err = new Error('Problem logging in: ' + passResponse.text);
                    if (passResponse && passResponse.responseCode) {
                        err.code = passResponse.responseCode;
                    }
                    throw err;
                }
            } else {
                this.logError('Problem logging in');
                let err = new Error('Problem logging in: ' + userResponse.text);
                if (userResponse && userResponse.responseCode) {
                    err.code = userResponse.responseCode;
                }
                throw err;
            }
        } else {
            loggedIn = true;
        }
        return loggedIn;
    }

    /**
     * Handler for 'response' event emitted when ftp command execution finishes
     *
     * @param  {Object} result  Response data object with 'responseCode', 'text', 'rest' and 'unchangedResponse' properties
     *
     * @return {undefined}
     */
    onResponse (result) {
        if (!this.greeting) {
            this.greeting = result.text;
            this.emit('greeting', this.greeting);
        }
        this.logCall('onResponse', arguments);
        this.logResponse(result);
    }

    /**
     * Handler for socket 'timeout' event
     *
     * @return {undefined}
     */
    onTimeout () {
        this.log('Socket timeout');
    }

    /**
     * Handler for passive socket 'timeout' event
     *
     * @return {undefined}
     */
    onPassiveTimeout () {
        this.log('Passive socket timeout');
    }

    /**
     * Handler for socket 'data' event
     *
     * @param  {Buffer}  chunk  Data sent from server
     *
     * @return {undefined}
     */
    onData (chunk) {
        this.logCall('onData', arguments);
        if (this.responseHandler){
            this.responseHandler.write(chunk);
        }
    }

    /**
     * Handler for passive socket 'data' event
     *
     * @param  {Buffer}  chunk  Data sent from server
     *
     * @return {undefined}
     */
    onPassiveData (chunk) {
        this.logCall('onPassiveData', arguments);
        if (this.passiveResponseHandler){
            this.passiveResponseHandler.write(chunk);
        }
    }

    /**
     * Handler for socket 'error' event
     *
     * @param  {Error} error    Error object
     *
     * @return {undefined}
     */
    onError (error) {
        this.logCall('onError', arguments);
        this.logError(error);
        this.emit('error', error);
    }

    /**
     * Handler for socket 'close' event
     *
     * @async
     *
     * @param  {Boolean} hadErr Flag to indicate whether socket had error or not
     *
     * @return {undefined}
     */
    async onClose (hadErr) {
        this.logCall('onClose', arguments);
        if (hadErr) {
            this.logError('Connection closed with error');
        } else {
            this.logInfo('Connection closed');
        }
        this.removeSocketListeners(this.socket);
        if (this.secureConnected && this.secureSocket) {
            this.removeSocketListeners(this.secureSocket);
        }
        this.removeEventListeners();
        if (this.isPassive) {
            await this.passiveDisconnect();
        }
        this.reset();
        this.emit('close', hadErr);
    }

    /**
     * Handler for socket 'end' event
     *
     * @return {undefined}
     */
    onEnd () {
        this.logCall('onEnd', arguments);
        let text = this._currentBuffer;
        this.logDebug({
            text: text
        });
        this._currentBuffer = '';
        this.emit('end');
    }

    /**
     * Send raw command on active FTP socket
     * @param  {String}     command     Command to send
     * @param  {String}     encoding    Encoding to use
     *
     * @return {undefined}
     */
    command (command, encoding = null) {
        this.logCall('command', arguments);
        let socket = this.getSocket();
        // this.logCommand(this.sanitizeCommand(command));
        this._currentBuffer = '';
        this.statistics.totalCommands++;
        socket.write(command + '\r\n', encoding);
    }

    /**
     * Starts passive mode
     *
     * @async
     * @param {Boolean} resetCount  Flag to reset passive retry count
     *
     * @return {Socket} Passive socket
     */
    async startPassive(resetCount = true) {
        if (!this.busy) {
            let ps = this.getPassiveSocket();
            if (ps && !ps.destroyed){
                this.logDebug('Destroying previous passive socket');
                await this.passiveDisconnect();
            }
            if (resetCount) {
                this.passiveRetryCount = 0;
            }
            this.logCall('startPassive', arguments);
            this.logDebug('Starting passive mode');
            let response = await this.executeCommand('PASV');
            let passiveInfo = false;
            if (response) {
                passiveInfo = this.parser.parsePasvResponse(response);
            }

            if (!(passiveInfo && passiveInfo.ip && passiveInfo.port)) {
                this.logError('Passive command error ' + response.responseCode + ' ' + response.response);
                this.passiveRetryCount++;
                if (this.passiveRetryCount <= this.options.maxPassiveRetries) {
                    this.logWarning('Retrying passive - command error ' + response.responseCode + ' ' + response.response);
                    return await this.startPassive(false);
                } else {
                    this.logError('Giving up on passive connection after ' + this.passiveRetryCount + ' retries');
                    this.passiveRetryCount = 0;
                    return false;
                }
            }

            this.logDebug('Creating passive socket');
            let passiveSocket;
            try {
                passiveSocket = await this.passiveConnect(passiveInfo.ip, passiveInfo.port);
                if (passiveSocket) {

                    // this.overrideEmitLog(passiveSocket, 'PASS', ['end', 'close', 'error']);
                    this.isPassive = true;
                    this.logDebug('Passive mode available, ip:' + passiveInfo.ip + ', port: ' + passiveInfo.port);
                } else {
                    this.logError('Passive mode failed');
                    this.isPassive = false;
                }
            } catch (ex) {
                this.logError(ex);
                this.isPassive = false;
            }
            await this.wait(0);
            return passiveSocket;
        } else {
            console.warn('pass busyyyy 1');
            return new Promise( async (resolve, reject) => {
                this.once('free', async () => {
                    console.log('pass isfree');
                    try {
                        let result = await this.startPassive();
                        resolve(result);
                    } catch (ex) {
                        reject(ex);
                    }
                });
            });
        }
    }

    /**
     * Connects data connection on passive socket
     *
     * @async
     * @throws {Exception} If data connection can't be established
     *
     * @param  {String} ip      Server IP address
     * @param  {Number} port    Server port
     *
     * @return {Socket} Passive socket
     */
    async passiveConnect (ip, port) {
        this.logCall('passiveConnect', arguments);
        this.logInfo('Creating passive connection to ' + ip + ':' + port);
        let _passiveConnect =  (resolve, reject) => {
            let socket = new Socket();
            let sockerr;
            let timedOut = false;
            let timer = setTimeout(() => {
                timedOut = true;
                socket.destroy();
                reject(new Error('Timed out while making data connection'));
            }, this.connection.pasvTimeout);

            let _removeSocketListeners = () => {
                this.removeObjListener(socket, 'connect', _onPassiveSocketConnect);
                this.removeObjListener(socket, 'error', onerror);
                this.removeObjListener(socket, 'end', onend);
                this.removeObjListener(socket, 'close', onclose);
            };

            let _onPassiveSocketConnect = () => {
                clearTimeout(timer);
                _removeSocketListeners();
                if (this.secureConnected) {
                    this.secureOptions.socket = socket;
                    this.secureOptions.session = this.secureSocket.getSession();
                    let _passiveSecureConnected = () => {
                        // this.overrideEmitLog(socket, 'SECPASS', ['end', 'close', 'error']);
                        this.setSecurePassiveSocket(socket);
                        resolve(socket);
                    };
                    socket = tls.connect(this.secureOptions, _passiveSecureConnected);
                } else {
                    this.setPassiveSocket(socket);
                    resolve(socket);
                }
            };

            let onerror = (err) => {
                _removeSocketListeners();
                this.logError(err);
                sockerr = err;
                clearTimeout(timer);
                socket.removeListener('end', onend);
            };
            let onend = () => {
                _removeSocketListeners();
                clearTimeout(timer);
                socket.removeListener('error', onerror);
            };

            let onclose = (/*had_err*/) => {
                _removeSocketListeners();
                clearTimeout(timer);
                socket.removeAllListeners();
                if (!socket && !timedOut) {
                    var errmsg = 'Unable to make data connection';
                    if (sockerr) {
                        errmsg += '( ' + sockerr + ')';
                        sockerr = undefined;
                    }
                    reject(new Error(errmsg));
                }
            };


            socket.setTimeout(0);
            this.addOnceObjListener(socket, 'connect', _onPassiveSocketConnect);
            this.addOnceObjListener(socket, 'error', onerror);
            this.addOnceObjListener(socket, 'end', onend);
            this.addOnceObjListener(socket, 'close', onclose);

            socket.connect(port, ip);
        };
        return new Promise(_passiveConnect);
    }

    /**
     * Disconnects current data (passive) connection
     *
     * @async
     *
     * @return {Boolean} True if disconnected, false otherwise
     */
    async passiveDisconnect () {
        this.logCall('passiveDisconnect', arguments);
        let result = true;
        let passiveSocket = this.getPassiveSocket();

        let _passiveDisconnect = async (resolve, reject) => {
            if (passiveSocket && !passiveSocket.destroyed) {
                if (passiveSocket.destroy && _.isFunction(passiveSocket.destroy)) {
                    passiveSocket.removeAllListeners();
                    let _onPassiveClose = (hadErrors) => {
                        this.removeObjListener(passiveSocket, 'end', _onPassiveEnd);
                        if (hadErrors) {
                            this.logError('Passive socket had errors on closing');
                        }
                        this.isPassive = false;
                        passiveSocket = null;
                        resolve(true);
                    };
                    let _onPassiveEnd = (hadErrors) => {
                        this.removeObjListener(passiveSocket, 'close', _onPassiveClose);
                        if (hadErrors) {
                            this.logError('Passive socket had errors on closing');
                        }
                        this.isPassive = false;
                        passiveSocket = null;
                        resolve(true);
                    };
                    this.addOnceObjListener(passiveSocket, 'close', _onPassiveClose);
                    this.addOnceObjListener(passiveSocket, 'end', _onPassiveEnd);
                    passiveSocket.destroy();
                    // passiveSocket = null;
                    this.logInfo('Passive data connection closed');
                } else {
                    result = false;
                    let errorMessage = 'Passive data connection closing error - no passive socket';
                    this.logError(errorMessage);
                    reject(new Error(errorMessage));
                }
            } else {
                this.isPassive = false;
                passiveSocket = null;
                result = true;
                this.logWarning('Passive socket already closed or destroyed');
                resolve(true);
            }
        };

        if (passiveSocket && !passiveSocket.destroyed) {
            return new Promise(_passiveDisconnect);
        } else {
            this.isPassive = false;
            passiveSocket = null;
            this.logInfo('Passive socket already destroyed or deleted');
            return result;
        }
    }

    /**
     * Gets active FTP socket
     *
     * @return {Socket} Active FTP connection socket
     */
    getSocket(){
        if (this.secureSocket) {
            return this.secureSocket;
        } else {
            return this.socket;
        }
    }

    /**
     * Gets passive FTP socket
     *
     * @return {Socket} Passive FTP connection socket
     */
    getPassiveSocket(){
        let socket;
        if (this.securePassiveSocket) {
            socket = this.securePassiveSocket;
        } else if (this.passiveSocket) {
            socket = this.passiveSocket;
        }
        window.sock = socket;
        return socket;
    }

    /**
     * Sets data (passive) socket and adds listeners for it
     *
     * @param {Socket} socket   Passive socket
     *
     * @return {undefined}
     */
    setPassiveSocket(socket){
        if (socket) {
            this.passiveSocket = socket;
            this.passiveSocket.setTimeout(0);
            this.addSocketListeners(socket, true);
        } else {
            this.logError('Not setting passive socket');
        }
    }

    /**
     * Sets secure data (passive) socket and adds listeners for it
     *
     * @param {TLSSocket} socket    Secure passive socket
     *
     * @return {undefined}
     */
    setSecurePassiveSocket(socket){
        if (socket) {
            this.securePassiveSocket = socket;
            this.securePassiveSocket.setTimeout(0);
            this.securePassiveSocket.setKeepAlive(false);
            this.addSocketListeners(this.securePassiveSocket, true);
        } else {
            this.logError('Not setting passive socket');
        }
    }

    /**
     * Creates and returns ftp request instance
     *
     * @param  {String}     command         Ftp command
     * @param  {String}     encoding        Ftp command encoding
     * @param  {Boolean}    active          Active flag
     * @param  {Boolean}    pending         Pending flag
     * @param  {Boolean}    finished        Finished flag
     * @param  {Number}     responseCode    Response code
     * @param  {String}     response        FTP server response
     * @param  {String}     text            FTP server response data
     * @param  {Boolean}    error           Error flag
     * @param  {String}     errorMessage    Error message
     *
     * @return {FtpRequest} Ftp request instance
     */
    createFtpRequest(command = '', encoding = null) {
        let frClass = this.ftpRequestClass;
        let ftpRequest = new frClass(command, encoding);
        ftpRequest.setClient(this);
        ftpRequest.setParser(this.parser);
        ftpRequest.setSocket(this.getSocket());
        if (this.hasDebugLevel('commands')) {
            if (!(this.options.debug.debugCommands && this.options.debug.debugCommands.length) || _.includes(this.options.debug.debugCommands, ftpRequest.baseCommand)) {
                ftpRequest.forceLog = true;
                ftpRequest.forceInactiveLog = true;
            }
        }
        return ftpRequest;
    }

    /**
     * Gets ftp request from current (data) queue by its id
     *
     * @param  {String} id  Ftp request id
     *
     * @return {FtpRequest} Ftp request instance
     */
    getFtpRequest(id) {
        let ftpRequest = _.find(this.queue, (item) => {
            return item.id == id;
        });
        if (!ftpRequest) {
            ftpRequest = _.find(this.finishedQueue, (item) => {
                return item.id == id;
            });
        }
        return ftpRequest;
    }

    /**
     * Sends ftp request to server and returns it upon response
     *
     * @async
     * @throws {Error} If request fails
     *
     * @param  {String|FtpRequest}  command     FTP command or FtpRequest instance
     * @param  {String}             encoding    FTP command encoding
     *
     * @return {FtpRequest}                     Ftp request object populated with server response
     */
    async sendImmediate(command, encoding = null) {
        this.logCall('sendImmediate', arguments);
        return await this.send(command, encoding, true);
    }

    /**
     * Executes command immediately and returns its ftpRequest instance (no queue used)
     *
     * @async
     * @throws {Error} If request fails
     *
     * @param  {String|FtpRequest}  command     FTP command or FtpRequest instance
     * @param  {String}             encoding    FTP command encoding
     * @param  {Boolean}            ignoreBusy  Ignore busy status
     *
     * @return {FtpRequest}                     Ftp request object populated with server response
     */
    async executeCommand(command, encoding = null, ignoreBusy = false) {
        let ftpRequest;
        if (!this.busy || ignoreBusy) {
            this.setBusy(true);
            if (command instanceof FtpRequest) {
                ftpRequest = command;
            } else {
                ftpRequest = this.createFtpRequest(command, encoding);
            }
            let _executeCommand = (resolve, reject) => {
                let _onRequestFinish = () => {
                    this.setBusy(false);
                    this.removeObjListener(ftpRequest, 'error', _onRequestError);
                    if (!ftpRequest.queued) {
                        this.addToFinishedQueue(ftpRequest, true);
                    }
                    this.requestFinished(ftpRequest);
                    resolve(ftpRequest);
                };

                let _onRequestError = (error) => {
                    this.setBusy(false);
                    ftpRequest.setError(error);
                    this.removeObjListener(ftpRequest, 'finish', _onRequestFinish);
                    if (!ftpRequest.queued) {
                        this.addToFinishedQueue(ftpRequest, true);
                    }
                    this.requestFinished(ftpRequest);
                    reject(error);
                };

                this.addOnceObjListener(ftpRequest, 'finish', _onRequestFinish);
                this.addOnceObjListener(ftpRequest, 'error', _onRequestError);
                this.activateFtpRequest(ftpRequest);
                this.command(ftpRequest.command, ftpRequest.encoding);
            };
            return new Promise(_executeCommand);
        } else {
            console.warn('busyyyy 1', command);
            return new Promise( async (resolve, reject) => {
                this.once('free', async () => {
                    console.log('isfree');
                    try {
                        let result = await this.executeCommand(command, encoding, ignoreBusy);
                        resolve(result);
                    } catch (ex) {
                        reject(ex);
                    }

                });
            });
        }
    }

    /**
     * Sends command to server creating new ftp request and returns request object with server responses (uses queue)
     *
     * @async
     * @throws {Error} If request fails
     *
     * @param  {String|FtpRequest}  command     FTP command or FtpRequest instance
     * @param  {String}             encoding    FTP command encoding
     * @param  {Boolean}            prepend             Flag to indicate whether command should be queued first
     *
     * @return {FtpRequest}                     Ftp request object populated with server response
     */
    async send (command, encoding = null, prepend = false) {
        this.logCall('send', arguments);
        let ftpRequest;
        if (command instanceof FtpRequest) {
            ftpRequest = command;
        } else {
            ftpRequest = this.createFtpRequest(command, encoding);
        }
        if (ftpRequest) {
            this.queueCommand(ftpRequest, null, prepend);
            return new Promise( (resolve, reject) => {
                let _requestFinish = (err, requestObj) => {
                    this.removeObjListener(ftpRequest, 'error', _requestError);
                    // this.requestFinished(ftpRequest);
                    if (err) {
                        reject(err);
                    } else {
                        resolve(requestObj);
                    }
                };
                let _requestError = (err) => {
                    this.removeObjListener(ftpRequest, 'finish', _requestFinish);
                    reject(err);
                };
                this.addOnceObjListener(ftpRequest, 'finish', _requestFinish);
                this.addOnceObjListener(ftpRequest, 'error', _requestError);
            });
        } else {
            this.logError('no command!!! ' + command);
            return false;
        }
    }

    /**
     * Gets currently active ftp request if any
     *
     * @return {FtpRequest|Boolean} Active request or false if none
     */
    getActiveFtpRequest() {
        let ftpRequest = _.find(this.queue, (item) => {
            return !item.pending && item.active && !item.finished;
        });
        return ftpRequest;
    }

    /**
     * Pauses queue execution
     *
     * @return {undefined}
     */
    pauseQueue () {
        this.queuePaused = true;
        this.emit('queue:pause');
    }

    /**
     * Resumes queue execution
     *
     * @return {undefined}
     */
    resumeQueue () {
        this.queuePaused = false;
        this.emit('queue:resume');
    }

    /**
     * Adds ftpRequest object to queue
     *
     * @param {FtpRequest}  ftpRequest FtpRequest instance to add to queue
     * @param {Boolean}     prepend    Flag to indicate whether to put new object to beggining of queue or at the end (default)
     * @param {Boolean}     silent      Flag to indicate whether to emit 'queue:add' event or not
     *
     * @return {undefined}
     */
    addToQueue(ftpRequest, prepend = false, silent = false) {
        if (!prepend) {
            this.queue.push(ftpRequest);
        } else {
            let activeFtpRequest = this.getActiveFtpRequest();
            if (!activeFtpRequest) {
                this.queue.unshift(ftpRequest);
            } else {
                let index = _.findIndex(this.queue, (fr) => {
                    return fr.id == activeFtpRequest.id;
                });
                this.queue.splice((index + 1), 0, ftpRequest);
            }
        }
        if (!silent) {
            this.emit('queue:add', ftpRequest);
        }
    }

    /**
     * Removes ftpRequest from queue
     *
     * @param  {FtpRequest|null} ftpRequest FtpRequest instance to remove
     *
     * @return {undefined}
     */
    removeFromQueue(ftpRequest = null) {
        let requestIndex = 0;
        if (!ftpRequest) {
            ftpRequest = _.nth(this.queue, requestIndex);
        } else {
            requestIndex = _.findIndex(this.queue, (fr) => {
                return fr.id == ftpRequest.id;
            });
        }
        if (requestIndex >= 0 && requestIndex < this.queue.length) {
            _.pullAt(this.queue, requestIndex);
            this.emit('queue:remove', ftpRequest);
            this.emit('queue:complete', ftpRequest);
        }
    }

    /**
     * Adds request object to finished queue
     *
     * @param {FtpRequest}  ftpRequest  FtpRequest object to add to finished queue
     * @param {Boolean}     silent      Flag to indicate whether to emit 'finishedQueue:add' event or not
     *
     * @return {undefined}
     */
    addToFinishedQueue(ftpRequest, silent = false) {
        if (this.options.keepFinishedQueue) {
            this.finishedQueue.push(ftpRequest);
            if (!silent) {
                this.emit('finishedQueue:add', ftpRequest);
            }
        }
    }

    /**
     * Removes ftpRequest from finished queue
     *
     * @param  {FtpRequest|null} ftpRequest FtpRequest instance to remove
     *
     * @return {undefined}
     */
    removeFromFinishedQueue(ftpRequest = null) {
        let requestIndex = 0;
        if (!ftpRequest) {
            ftpRequest = _.nth(this.finishedQueue, requestIndex);
        } else {
            requestIndex = _.findIndex(this.finishedQueue, (fr) => {
                return fr.id == ftpRequest.id;
            });
        }
        if (requestIndex >= 0 && requestIndex < this.finishedQueue.length) {
            _.pullAt(this.finishedQueue, requestIndex);
            this.emit('finishedQueue:remove', ftpRequest);
        }
    }

    /**
     * Queues ftp command in data queue
     *
     * @param  {String|FtpRequest}  command             Ftp command or FtpRequest object instance
     * @param  {String}             encoding            Ftp command encoding
     * @param  {Boolean}            prepend             Flag to indicate whether command should be queued first
     *
     * @return {Boolean|FtpRequest}                     FtpRequest instance if command is immediately executed or boolean result of queueing the comand
     */
    queueCommand(command, encoding = null, prepend = false) {
        let ftpRequest;
        if (command instanceof FtpRequest) {
            ftpRequest = command;
        } else {
            ftpRequest = this.createFtpRequest(command, encoding);
        }
        if (ftpRequest) {
            this.addToQueue(ftpRequest, prepend);
            return ftpRequest;
        } else {
            return false;
        }
    }

    /**
     * Queues multiple ftpRequests at once, firing 'queue:emit' event only for last one
     *
     * @param  {FtpRequest[]}       requests            An array of FtpRequest object instances
     * @param  {Boolean}            prepend             Flag to indicate whether command should be queued first
     *
     * @return {FtpRequest[]}                           An array of FtpRequest object instances
     */
    queueRequests(requests, prepend = false) {
        let requestCount = requests.length;
        if (requestCount){
            for (let i=0; i<(requestCount-1); i++){
                this.addToQueue(requests[i], prepend, true);
            }
            this.addToQueue(requests[requestCount-1], prepend, false);
            if (this.queue.length > 1) {
                this.processQueue();
            }
        }
        return requests;
    }

    /**
     * Processes ftp data queue
     *
     * @async
     *
     * @return {Boolean|FtpRequest} FtpRequest instance if there is no active request or false otherwise
     */
    async processQueue() {
        this.logCall('processQueue', arguments);
        if (this.queuePaused) {
            this.logInfo('Queue paused, not processing');
            return false;
        }
        if (this.queue && this.queue.length) {
            let activeFtpRequest = this.getActiveFtpRequest();
            if (activeFtpRequest) {
                this.logWarning('Skipping queue due to active request');
                return false;
            }
            let ftpRequest = _.find(this.queue, (item) => {
                return item.pending && !item.active && !item.finished;
            });
            if (ftpRequest) {
                if (!this.busy) {
                    await this.processFtpRequest(ftpRequest);
                    this.removeFromQueue(ftpRequest);
                    return ftpRequest;
                } else {
                    this.logWarning('bussyyyyy ' + ftpRequest.command);
                    return new Promise( async (resolve, reject) => {
                        this.once('free', async () => {
                            console.log('pass isfreeeeee');
                            try {
                                let result = await this.processQueue();
                                resolve(result);
                            } catch (ex) {
                                reject(ex);
                            }
                        });
                    });
                }
            } else {
                this.emit('queue:finished');
                return false;
            }
        } else {
            this.logWarning('Queue is empty, nothing to process');
            this.emit('queue:finished');
            return false;
        }
    }

    onProgress (transferred, chunkSize, limiterObject = null, isFinal = false) {
        // limiterObject.ftpRequest.setTransferred(transferred);
        this.logProgress(transferred);
    }

    /**
     * Resets currentSpeed statistic value to zero
     *
     * @param  {FtpRequest}       ftpRequest            Ftp request info
     *
     * @return {undefined}
     */
    resetCurrentSpeed (ftpRequest) {
        this.statistics.currentSpeed = 0;
        if (ftpRequest) {
            if (ftpRequest.isUpload) {
                this.statistics.currentUploadSpeed = 0;
            } else {
                this.statistics.currentDownloadSpeed = 0;
            }
        }
    }

    /**
     * Sets currentSpeed statistic value
     *
     * @param  {FtpRequest}     ftpRequest      Ftp request info
     * @param  {Number}         speed           Numeric speed value
     *
     * @return {undefined}
     */
    setCurrentSpeed (ftpRequest, speed) {
        this.statistics.currentSpeed = speed;
        if (ftpRequest) {
            if (ftpRequest.isUpload) {
                this.statistics.currentUploadSpeed = speed;
            } else {
                this.statistics.currentDownloadSpeed = speed;
            }
        }
        this.calculateAverageSpeed(Date.now());
    }

    /**
     * Updates data transfer statistics
     * 
     * @param  {Number} transferred     Transferred bytes for current request so far
     * @param  {Number} chunkSize       Last chunk size for current request
     * 
     * @return {undefined}
     */
    updateDataStats(transferred, chunkSize) {
        this.statistics.totalTransferred += chunkSize;
        this.currentProgress = transferred;
    }


    calculateAverageSpeed (now) {
        this.intermediateStatistics.speedSum += this.statistics.currentSpeed;
        this.intermediateStatistics.measureCount++;
        let averageSpeed = this.intermediateStatistics.speedSum / this.intermediateStatistics.measureCount;
        if ((averageSpeed || averageSpeed === 0) && !isNaN(averageSpeed)){
            this.statistics.averageSpeed = averageSpeed;
            if (this.options.keepStatisticsHistory) {
                let historyEntry = this.getHistoryEntry(this.statistics.averageSpeed, new Date(now));
                this.addAverageHistoryEntry(historyEntry);
            }
        }
    }

    onQueueComplete (ftpRequest) {
        this.logCall('onQueueComplete', arguments);
        this.logQueue('Completed command "' + this.sanitizeCommand(ftpRequest.command) + '" in queue');
        if (!ftpRequest.isPassive) {
            this.statistics.totalTransferred += ftpRequest.size;
        }
    }

    onQueueFinished () {
        this.logCall('onQueueFinished', arguments);
        this.logQueue('Queue finished');
    }

    onQueueAdd (ftpRequest) {
        this.logCall('onQueueAdd', arguments);
        ftpRequest.queued = true;
        this.logQueue('Add command "' + this.sanitizeCommand(ftpRequest.command) + '" to queue');
        if (this.queue.length == 1) {
            this.processQueue();
        }
    }

    onQueuePause () {
        this.logCall('onQueuePause', arguments);
        this.logQueue('Pause queue');
    }

    onQueueResume () {
        this.logCall('onQueueResume', arguments);
        this.logQueue('Resume queue');
        this.processQueue();
    }

    onQueueRemove (ftpRequest) {
        this.logCall('onQueueRemove', arguments);
        this.logQueue('Removed command "' + this.sanitizeCommand(ftpRequest.command) + '" from queue');
        ftpRequest.pending = false;
        if (ftpRequest.active) {
            this.deactivateFtpRequest(ftpRequest);
        }
        if (!ftpRequest.finished) {
            ftpRequest.finished = true;
        }
        this.addToFinishedQueue(ftpRequest);
        ftpRequest.emit('unqueue');
        if (this.queue && this.queue.length) {
            this.processQueue();
        } else {
            this.emit('queue:finished');
        }
    }

    /**
     * Processes single ftp request (send command to server and handle returned data)
     *
     * @async
     * @throws {Error|Exception} If request fails
     *
     * @param  {FtpRequest}         ftpRequest  Ftp request to process
     *
     * @return {Boolean|FtpRequest}             FtpRequest instance with data from server
     */
    async processFtpRequest(ftpRequest) {
        this.logCall('processFtpRequest', arguments);
        let usePassive = this.isRequestPassive(ftpRequest);
        let isUpload = this.isRequestUpload(ftpRequest);
        await this.wait(10);
        if (!usePassive) {
            this.activateFtpRequest(ftpRequest);
            await this.executeCommand(ftpRequest);
            return ftpRequest;
        } else {
            let returnPromise;
            this.currentProgress = 0;
            if (!isUpload) {
                let _processFtpRequest = async (resolve, reject) => {
                    let source;
                    let passiveSocket;
                    let canCompress = false;
                    if (this.canUseCompression()) {
                        try {
                            let modeZResponse = await this.executeCommand('MODE Z', null, true);
                            if (modeZResponse && modeZResponse.responseCode && modeZResponse.responseCode == 200) {
                                canCompress = true;
                            } else {
                                await this.executeCommand('MODE S', null, true);
                                canCompress = false;
                            }
                        } catch (ex) {
                            await this.executeCommand('MODE S', null, true);
                            canCompress = false;
                            this.logError('MODE Z error: ' + ex.message);
                        }
                    }


                    await this.startPassive();
                    passiveSocket = this.getPassiveSocket();
                    if (passiveSocket) {
                        let _onRequestFinish = async () => {
                            this.removeObjListener(ftpRequest, 'error', _onRequestError);
                            this.setBusy(false);
                            await this.passiveDisconnect();
                            if (canCompress) {
                                await this.executeCommand('MODE S', null, true);
                            }
                            this.requestFinished(ftpRequest);
                            resolve(ftpRequest);
                        };

                        let _onRequestError = async (err) => {
                            this.removeObjListener(ftpRequest, 'finish', _onRequestFinish);
                            this.setBusy(false);
                            await this.passiveDisconnect();
                            if (canCompress) {
                                await this.executeCommand('MODE S', null, true);
                            }
                            ftpRequest.setError(err);
                            this.requestFinished(ftpRequest);
                            reject(err);
                        };

                        this.addOnceObjListener(ftpRequest, 'finish', _onRequestFinish);
                        this.addOnceObjListener(ftpRequest, 'error', _onRequestError);

                        try {
                            source = this.limitTransferSpeed(passiveSocket, ftpRequest, this.options.limitDownload);
                            if (canCompress) {
                                this.logInfo('Using compression');
                                source = source.pipe(zlib.createInflate());
                            } else {
                                this.logInfo('Not using compression');
                            }
                            ftpRequest.setPassiveSocket(source);
                            this.activateFtpRequest(ftpRequest);
                            this.setBusy(true);
                            this.command(ftpRequest.command, ftpRequest.encoding);
                        } catch (ex) {
                            this.removeObjListener(ftpRequest, 'finish', _onRequestFinish);
                            await this.passiveDisconnect();
                            ftpRequest.setError(ex.message);
                            this.setBusy(false);
                            this.requestFinished(ftpRequest);
                            reject(ex);
                        }
                    } else {
                        let errorMessage = 'Can not open data connection';
                        ftpRequest.setError(errorMessage);
                        // this.requestFinished(ftpRequest);
                        reject(new Error('Can not open data connection for "' + ftpRequest.command + '"'));
                    }
                };
                returnPromise = new Promise(_processFtpRequest);
                return returnPromise;
            } else {
                let _processUploadFtpRequest = async (resolve, reject) => {
                    let input = ftpRequest.input;
                    let isBuffer = Buffer.isBuffer(input);
                    let source;

                    ftpRequest.finishCodes.push(226);

                    let error = false;

                    if (isBuffer) {
                        try {
                            source = fs.createReadStream(input);
                        } catch (ex) {
                            error = true;
                            reject(ex);
                        }
                    } else if (_.isString(input)) {
                        try {
                            let stats = fs.statSync(input);
                            if (stats && stats.isFile()) {
                                try {
                                    source = fs.createReadStream(input);
                                } catch (streamEx) {
                                    error = true;
                                    reject(streamEx);
                                }
                            } else {
                                error = true;
                                reject(new Error('Input file "' + input + '" is invalid'));
                            }
                        } catch (ex) {
                            error = true;
                            reject(ex);
                        }
                    } else if (input instanceof stream.Stream) {
                        source = input;
                    } else {
                        error = true;
                        reject(new Error('Unrecognized input'));
                    }

                    if (error) {
                        return false;
                    }
                    source.pause();

                    let canCompress = false;
                    if (this.canUseCompression()) {
                        try {
                            let modeZResponse = await this.executeCommand('MODE Z', null, true);
                            if (modeZResponse && modeZResponse.responseCode && modeZResponse.responseCode == 200) {
                                canCompress = true;
                            } else {
                                canCompress = false;
                                await this.executeCommand('MODE S', null, true);
                            }
                        } catch (ex) {
                            canCompress = false;
                            this.logError('MODE Z error: ' + ex.message);
                            await this.executeCommand('MODE S', null, true);
                        }
                    }




                    await this.startPassive();
                    let passiveSocket  = this.getPassiveSocket();
                    if (passiveSocket) {
                        source = this.limitTransferSpeed(source, ftpRequest, this.options.limitUpload);
                        let destination = passiveSocket;

                        if (canCompress) {
                            destination = zlib.createDeflate({ level: this.options.compressionLevel });
                            destination.pipe(passiveSocket);
                        }

                        ftpRequest.setPassiveSocket(destination);
                        ftpRequest.setSource(source);

                        let _onRequestFinish = async () => {
                            this.removeObjListener(ftpRequest, 'error', _onRequestError);
                            this.setBusy(false);
                            this.requestFinished(ftpRequest);
                            if (canCompress) {
                                await this.executeCommand('MODE S', null, true);
                            }
                            resolve(ftpRequest);
                        };

                        let _onRequestError = async (err) => {
                            this.removeObjListener(ftpRequest, 'finish', _onRequestFinish);
                            this.setBusy(false);
                            this.requestFinished(ftpRequest);
                            if (canCompress) {
                                await this.executeCommand('MODE S', null, true);
                            }
                            ftpRequest.setError(err);
                            reject(err);
                        };

                        this.addOnceObjListener(ftpRequest, 'finish', _onRequestFinish);
                        this.addOnceObjListener(ftpRequest, 'error', _onRequestError);
                        await this.executeCommand(ftpRequest);
                    }
                };
                returnPromise = new Promise(_processUploadFtpRequest);
                return returnPromise;
            }
        }
    }

    /**
     * Sends commmand to server and returns boolean result based on success and failure codes from params
     *
     * @async
     * @param  {String}     command         Command to send
     * @param  {Number[]}   successCodes    Array of response codes for which request can be considered as successful
     * @param  {Number[]}   failureCodes    Array of response codes for which request can be considered as failed
     * @param  {Boolean}    immediate       Force immediate execution
     *
     * @return {Boolean}                    Result of the request
     */
    async getResponseBool(command, successCodes = [], failureCodes = [], immediate = false) {
        this.logCall('getResponseBool', arguments);
        let result;
        let ftpRequest;
        if (_.isString(command)) {
            ftpRequest = this.createFtpRequest(command);
        } else {
            ftpRequest = command;
        }
        ftpRequest.setFinishCodes(successCodes);
        ftpRequest.setErrorCodes(failureCodes);
        this.queueCommand(ftpRequest, null, immediate);
        let _getResponseBool = (resolve, reject) => {
            let _requestFinish = (err) => {
                this.removeObjListener(ftpRequest, 'error', _requestError);
                // this.requestFinished(ftpRequest);
                if (err) {
                    reject(err);
                } else {
                    if (ftpRequest && ftpRequest.responseCode) {
                        if (successCodes && successCodes.length && _.includes(successCodes, ftpRequest.responseCode)) {
                            result = true;
                        } else if (failureCodes && failureCodes.length && _.includes(failureCodes, ftpRequest.responseCode)) {
                            result = false;
                        }
                        resolve(result);
                    } else {
                        this.logError(ftpRequest.response);
                        let error = new Error(ftpRequest.response);
                        error.code = ftpRequest.responseCode;
                        reject(error);
                    }
                }
            };
            let _requestError = (err) => {
                this.removeObjListener(ftpRequest, 'finish', _requestFinish);
                reject(err);
            };
            this.addOnceObjListener(ftpRequest, 'finish', _requestFinish);
            this.addOnceObjListener(ftpRequest, 'error', _requestError);
        };

        return new Promise(_getResponseBool);
    }

    /**
     * Sends commmand to server and returns request text or false based on success and failure codes from params
     *
     * @async
     * @param  {String}     command         Command to send
     * @param  {Number[]}   successCodes    Array of response codes for which request can be considered as successful
     * @param  {Number[]}   failureCodes    Array of response codes for which request can be considered as failed
     * @param  {Boolean}    immediate       Force immediate execution
     *
     * @return {String|Boolean}             Response text or false on failure
     */
    async getResponseText(command, successCodes = [], failureCodes = [], immediate = false) {
        this.logCall('getResponseText', arguments);
        let result;
        let ftpRequest;
        if (_.isString(command)) {
            ftpRequest = this.createFtpRequest(command);
        } else {
            ftpRequest = command;
        }
        ftpRequest.setFinishCodes(successCodes);
        ftpRequest.setErrorCodes(failureCodes);
        this.queueCommand(ftpRequest, null, immediate);
        let _getResponseText = (resolve, reject) => {
            let _requestFinish = (err) => {
                this.removeObjListener(ftpRequest, 'error', _requestError);
                // this.requestFinished(ftpRequest);
                if (err) {
                    reject(err);
                } else {
                    if (ftpRequest && ftpRequest.responseCode) {
                        if (successCodes && successCodes.length && _.includes(successCodes, ftpRequest.responseCode)) {
                            result = ftpRequest.response;
                        } else if (failureCodes && failureCodes.length && _.includes(failureCodes, ftpRequest.responseCode)) {
                            result = false;
                        }
                        resolve(result);
                    } else {
                        this.logError(ftpRequest.response);
                        let error = new Error(ftpRequest.response);
                        error.code = ftpRequest.responseCode;
                        reject(error);
                    }
                }
            };
            let _requestError = (err) => {
                this.removeObjListener(ftpRequest, 'finish', _requestFinish);
                reject(err);
            };
            this.addOnceObjListener(ftpRequest, 'finish', _requestFinish);
            this.addOnceObjListener(ftpRequest, 'error', _requestError);
        };

        return new Promise(_getResponseText);
    }

    /**
     * Aborts current ftp operation
     *
     * @async
     * @param {Boolean} force Force abort
     *
     * @return {Boolean} Operation result
     */
    async abort(force = false) {
        if (!force) {
            return await this.getResponseBool('ABOR', [226], [], true);
        } else {
            return await this.command('ABOR', null);
        }
    }

    /**
     * Gets ftp server system information
     *
     * @async
     *
     * @return {String} System information
     */
    async system() {
        return await this.getResponseText('SYST', [215]);
    }

    /**
     * Gets ftp server status information
     *
     * @async
     *
     * @return {String} Status information
     */
    async status() {
        return await this.getResponseText('STAT', [211]);
    }

    /**
     * Sends SITE command to server and returns response text
     *
     * @async
     * @param  {String} command     SITE command to send (without 'SITE')
     *
     * @return {String}             Response text
     */
    async site(command) {
        return await this.getResponseText('SITE ' + command, [200]);
    }

    /**
     * Sets ftp connection mode to 'ASCII'
     *
     * @async
     *
     * @return {Boolean}    Operation result
     */
    async ascii() {
        return await this.getResponseBool('TYPE A', [200]);
    }

    /**
     * Sets ftp connection mode to 'binary'
     *
     * @async
     *
     * @return {Boolean}    Operation result
     */
    async binary() {
        return await this.getResponseBool('TYPE I', [200]);
    }

    /**
     * Logs current user out of the server
     *
     * @async
     *
     * @return {Boolean} Logout result
     */
    async logout() {
        return await this.getResponseBool('QUIT', [221]);
    }

    /**
     * Reads file list for given path and returns items array
     *
     * @async
     * @param  {String}         ftpPath     Path to read file list for
     * @param  {Boolean}        listAll     Flag to include hidden files (if supported/allowed by server)
     *
     * @return {FtpFileItem[]}              An array of FtpFileItem instances with file/dir data populated
     */
    async list(ftpPath, listAll = false) {
        let command = 'LIST ';
        if (listAll) {
            command += '-A ';
        }
        command += ftpPath;
        let ftpRequest = this.createFtpRequest(command, null);
        this.queueCommand(ftpRequest);
        let _list = (resolve, reject) => {
            let _requestFinish = (err, requestObj) => {
                this.removeObjListener(ftpRequest, 'error', _requestError);
                // this.requestFinished(ftpRequest);
                if (err) {
                    reject(err);
                } else {
                    let items = this.parser.parseListResponse(requestObj.text, ftpPath);
                    resolve(items);
                }
            };
            let _requestError = (err) => {
                this.removeObjListener(ftpRequest, 'finish', _requestFinish);
                // this.requestFinished(ftpRequest);
                reject(err);
            };
            this.addOnceObjListener(ftpRequest, 'finish', _requestFinish);
            this.addOnceObjListener(ftpRequest, 'error', _requestError);
        };

        return new Promise(_list);
    }

    /**
     * Reads file from FTP server
     *
     * @async
     * @param  {String}     ftpPath     Path of file to read
     *
     * @return {FtpRequest}             Ftp request instance with populated response data
     */
    async get(ftpPath) {
        let command = 'RETR ';
        command += ftpPath;
        let ftpRequest = this.queueCommand(this.createFtpRequest(command));
        ftpRequest.addErrorCode(550);
        return new Promise( (resolve, reject) => {
            let _requestFinish = (err, requestObj) => {
                this.removeObjListener(ftpRequest, 'error', _requestError);
                // this.requestFinished(ftpRequest);
                if (err) {
                    reject(err);
                } else {
                    resolve(requestObj);
                }
            };
            let _requestError = (err) => {
                this.removeObjListener(ftpRequest, 'finish', _requestFinish);
                reject(err);
            };
            this.addOnceObjListener(ftpRequest, 'finish', _requestFinish);
            this.addOnceObjListener(ftpRequest, 'error', _requestError);
        });
    }

    /**
     * Renames/moves file/dir on ftp server
     *
     * @async
     * @param  {String}     sourcePath          Source ftp path
     * @param  {String}     destinationPath    Destination ftp path
     *
     * @return {Boolean}                        Rename operation result
     */
    async rename (sourcePath, destinationPath) {
        let renFromCommand = this.createFtpRequest('RNFR ' + sourcePath);
        let renToCommand = this.createFtpRequest('RNTO ' + destinationPath);
        if (renFromCommand && renToCommand) {
            let _rename = (resolve, reject) => {
                let _onRequestFinish = (err) => {
                    this.removeObjListener(renToCommand, 'error', _onRequestError);
                    this.requestFinished(renToCommand);
                    if (err) {
                        reject(err);
                    } else {
                        resolve(true);
                    }
                };
                let _onRequestError = (err) => {
                    this.removeObjListener(renToCommand, 'finish', _onRequestFinish);
                    reject(err);
                };
                this.addOnceObjListener(renToCommand, 'finish', _onRequestFinish);
                this.addOnceObjListener(renToCommand, 'error', _onRequestError);
            };
            // this.queueCommand(renFromCommand);
            // this.queueCommand(renToCommand);
            this.queueRequests([renFromCommand, renToCommand]);
            return new Promise(_rename);
        } else {
            return false;
        }
    }





    /**
     * Renames/moves file/dir on ftp server
     *
     * @async
     * @param  {String}     sourcePath          Source ftp path
     * @param  {String}     destinationPath    Destination ftp path
     *
     * @return {Boolean}                        Rename operation result
     */
    async _rename (sourcePath, destinationPath) {
        let result = false;
        let renFromCommand = await this.send('RNFR ' + sourcePath);
        if (renFromCommand && renFromCommand.responseCode && renFromCommand.responseCode == 350) {
            let renToCommand = await this.send('RNTO ' + destinationPath);
            if (renToCommand && renToCommand.responseCode && renToCommand.responseCode == 250) {
                result = true;
            } else {
                this.logError(renToCommand.response);
            }
        } else {
            this.logError(renFromCommand.response);
        }
        return result;
    }






    /**
     * Restart file transfer at given offset
     *
     * @async
     * @param  {Number} offset  Offset to restart transfer from
     *
     * @return {Boolean}        Operation result
     */
    async restart(offset) {
        return await this.getResponseBool('REST ' + offset, [350]);
    }

    /**
     * Gets file size for given file
     *
     * @async
     * @param  {String}  ftpPath        Path of file to get size for
     *
     * @return {Number}             Size of file on server
     */
    async size(ftpPath) {
        let result = false;
        let response = await this.getResponseText('SIZE ' + ftpPath, [213]);
        if (response) {
            result = parseInt(response, 10);
        }
        if (isNaN(result)){
            result = 0;
        }
        return result;
    }

    /**
     * Checks whether given file exists on server
     *
     * @async
     * @param  {String} ftpPath     Path of file on server
     *
     * @return {Boolean}            True if file exists, false otherwise
     */
    async fileExists(ftpPath) {
        // let result = false;
        // let dir = path.dirname(ftpPath);
        // let files = await this.list(dir);
        // let found = _.find(files, (file) => {
        //     return file.fullPath == ftpPath;
        // });
        // if (found) {
        //     result = true;
        // }
        // return result;

        let result = await this.lastMod(ftpPath, true, [213, 550]);
        if (result) {
            result = true;
        }
        return result;
    }

    /**
     * Checks whether given dir exists on server
     *
     * @async
     * @param  {String} ftpPath     Path of dir on server
     *
     * @return {Boolean}            True if dir exists, false otherwise
     */
    async dirExists(ftpPath) {
        let result = false;
        let pwd = await this.pwd();
        let cwd = await this.cwd(ftpPath);
        if (cwd) {
            result = true;
            await this.cwd(pwd);
        }
        return result;
    }

    /**
     * Checks whether given file or dir exists on server
     *
     * @async
     * @param  {String} ftpPath     Path of file or dir on server
     *
     * @return {Boolean}            True if file or dir exists, false otherwise
     */
    async exists(ftpPath) {
        let result = false;
        let exists = await this.fileExists(ftpPath);
        if (!exists) {
            exists = await this.dirExists(ftpPath);
        }
        if (exists) {
            result = true;
        }
        return result;
    }

    /**
     * Gets last modification time for given ftp file
     *
     * @async
     *
     * @param  {String}  ftpPath        Ftp file path
     * @param  {Boolean} returnRaw      Flag to indicate whether to return
     * @param  {Array}   successCodes   Success codes
     *
     * @return {Date|Number|Boolean} File last modification date, its numeric representation or false if none
     */
    async lastMod(ftpPath, returnRaw = false, successCodes = [213]) {
        let result = false;
        let ftpRequest = this.createFtpRequest('MDTM ' + ftpPath);
        ftpRequest.addErrorCode(550);
        let response = await this.getResponseText(ftpRequest, successCodes);
        if (response) {
            result = parseInt(response, 10);
        }
        if (isNaN(result)){
            result = false;
        } else if (result && !returnRaw) {
            let resultText = result + '';
            if (resultText && resultText.length == 14) {
                let year = resultText.substr(0, 4);
                let month = resultText.substr(4, 2);
                let day = resultText.substr(6, 2);
                let hour = resultText.substr(8, 2);
                let minute = resultText.substr(10, 2);
                let second = resultText.substr(12, 2);
                result = new Date(year, month, day, hour, minute, second);
            }
        }
        return result;
    }

    /**
     * Gets current working directory on FTP server
     *
     * @async
     *
     * @return {String|Boolean} Current working directory or false if unsuccessful
     */
    async pwd () {
        let result = false;
        let ftpRequest = await this.send('PWD');
        if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 257) {
            let matches = ftpRequest.response.match(/"(.+)"(?:\s|$)/);
            if (matches && matches.length >= 2) {
                result = matches[1];
            }
        } else {
            this.logError(ftpRequest.response);
        }
        return result;
    }

    /**
     * Changes current working directory on ftp server
     *
     * @async
     * @param  {String} ftpPath     Directory path
     *
     * @return {Boolean}            Operation result
     */
    async cwd (ftpPath) {
        return await this.getResponseBool('CWD ' + ftpPath, [250]);
    }

    /**
     * Moves current working directory to parent dir
     *
     * @async
     *
     * @return {Boolean}            Operation result
     */
    async cdup () {
        return await this.getResponseBool('CDUP', [250]);
    }

    /**
     * Creates new directory on ftp server
     *
     * @async
     *
     * @param  {String}  ftpPath    Path of new dir
     * @param  {Boolean} recursive  Recursive create (if supported by server)
     *
     * @return {Boolean}            Operation result
     */
    async mkdir (ftpPath, recursive = false) {
        let result = false;
        if (!recursive) {
            let ftpRequest = await this.send('MKD ' + ftpPath);
            if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 257) {
                result = true;
            } else {
                this.logError(ftpRequest.response);
            }
        } else {
            if (this.hasFeature('SITE MKDIR')) {
                let ftpRequest = await this.send('SITE MKDIR ' + ftpPath);
                if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 200) {
                    result = true;
                } else {
                    this.logError(ftpRequest.response);
                }
            } else {
                this.logError('Can not create directories recursively, no server support');
            }
        }
        return result;
    }

    /**
     * Deletes directory on ftp server
     *
     * @async
     *
     * @param  {String}  ftpPath    Path of directory to delete
     * @param  {Boolean} recursive  Recursive delete (if supported by server)
     *
     * @return {Boolean}            Operation result
     */
    async rmdir (ftpPath, recursive = false) {
        let result = false;
        if (!recursive) {
            let ftpRequest = await this.send('RMD ' + ftpPath);
            if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 250) {
                result = true;
            } else {
                this.logError(ftpRequest.response);
            }
        } else {
            if (this.hasFeature('SITE RMDIR')) {
                let ftpRequest = await this.send('SITE RMDIR ' + ftpPath);
                if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 200) {
                    result = true;
                } else {
                    this.logError(ftpRequest.response);
                }
            } else {
                this.logInfo('No server support for recursive RMD, deleting one by one');
                result = true;
                let allItems = await this.getItemStructure(ftpPath, true, true);
                let files = _.filter(allItems, (item) => {
                    return item.type != 'd';
                });
                let dirs = _.filter(allItems, (item) => {
                    return item.type == 'd';
                });
                let sortedDirs = _.sortBy(dirs, (item) => {
                    return '1-' + (100000 - item.fullPath.length) + '-' + item.name;
                });
                let requests = [];
                for (let i=0; i<files.length; i++) {
                    let delFileRequest = this.createFtpRequest('DELE ' + files[i].fullPath);
                    delFileRequest.addFinishCode(250);
                    requests.push(delFileRequest);
                    // result = result && await this.delete(files[i].fullPath);
                }
                for (let i=0; i<sortedDirs.length; i++) {
                    // result = result && await this.rmdir(sortedDirs[i].fullPath);
                    let delDirRequest = this.createFtpRequest('RMD ' + sortedDirs[i].fullPath);
                    delDirRequest.addFinishCode(250);
                    requests.push(delDirRequest);
                    // this.queueCommand(delDirRequest);
                }
                // result = result && await this.rmdir(ftpPath);
                let delRootRequest = this.createFtpRequest('RMD ' + ftpPath);
                delRootRequest.addFinishCode(250);
                requests.push(delRootRequest);
                for (let i=0; i<requests.length - 1; i++) {
                    this.queueCommand(requests[i]);
                }
                let final = await this.queueCommand(requests[requests.length - 1]);
                if (!final.error) {
                    result = true;
                } else {
                    result = false;
                }
            }
        }
        return result;
    }

    /**
     * Deletes file on ftp server
     *
     * @async
     * @param  {String} ftpPath     Path of file to delete
     *
     * @return {Boolean}            Operation result
     */
    async delete (ftpPath) {
        return await this.getResponseBool('DELE ' + ftpPath, [250]);
    }

    /**
     * Uploads file to ftp server
     *
     * @param  {String|Stream|Buffer} input     Input (file path, readable stream or buffer)
     * @param  {String}               ftpPath   Path of file to save on server
     *
     * @return {Boolean}                        Operation result
     */
    async put(input, ftpPath) {
        return await this.store('STOR', input, ftpPath);
    }

    /**
     * Appends data to file on ftp server
     *
     * @param  {String|Stream|Buffer} input     Input (file path, readable stream or buffer)
     * @param  {String}               ftpPath   Path of file to append to on server
     *
     * @return {Boolean}                        Operation result
     */
    async append(input, ftpPath) {
        return await this.store('APPE', input, ftpPath);
    }

    /**
     * Saves file to ftp server
     *
     * @param  {String}                 command     Command to use (STOR, STOU or APPE)
     * @param  {String|Stream|Buffer}   input       Input (file path, readable stream or buffer)
     * @param  {String}                 ftpPath     Path of file to append to on server
     *
     * @return {Boolean}                            Operation result
     */
    async store(command, input, ftpPath) {
        command += ' ' + ftpPath;
        let ftpRequest = this.createFtpRequest(command, null);
        ftpRequest.input = input;
        ftpRequest.addErrorCode(553);
        ftpRequest.addErrorCode(451);

        let _store = (resolve, reject) => {
            let _onRequestFinish = async (err) => {
                this.removeObjListener(ftpRequest, 'error', _onRequestError);
                await this.passiveDisconnect();
                // this.requestFinished(ftpRequest);
                if (err) {
                    reject(err);
                } else if (ftpRequest.error) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            };
            let _onRequestError = async (err) => {
                this.removeObjListener(ftpRequest, 'finish', _onRequestFinish);
                await this.passiveDisconnect();
                reject(err);
            };
            this.addOnceObjListener(ftpRequest, 'finish', _onRequestFinish);
            this.addOnceObjListener(ftpRequest, 'error', _onRequestError);
        };

        this.queueCommand(ftpRequest);
        return new Promise(_store);
    }

    /**
     * Sets ftpRequest from parameter as active
     *
     * @param  {FtpRequest} ftpRequest      FtpRequest instance that should be set as active
     * @param  {Boolean}    modifyRequest   Flag to indicate whether to modify ftpRequest flag or not
     *
     * @return {undefined}
     */
    activateFtpRequest(ftpRequest, modifyRequest = true) {
        if (modifyRequest) {
            ftpRequest.setActive();
        }
        if (!this.options.limitSpeed) {
            ftpRequest.dataStarted = true;
        }
        this.metaData.activeFtpRequest = ftpRequest;
    }

    /**
     * Sets ftpRequest from parameter as inactive
     *
     * @param  {FtpRequest} ftpRequest FtpRequest instance that should be set as inactive
     * @param  {Boolean}    modifyRequest   Flag to indicate whether to modify ftpRequest flag or not
     *
     * @return {undefined}
     */
    deactivateFtpRequest(ftpRequest, modifyRequest = true) {
        if (modifyRequest) {
            ftpRequest.unsetActive();
        }
        if (this.metaData.activeFtpRequest && this.metaData.activeFtpRequest.id == ftpRequest.id) {
            this.metaData.activeFtpRequest = null;
        }
    }

    /**
     * Helper method called whenever ftpRequest instance is finished
     *
     * @async
     * @param  {FtpRequest} ftpRequest FtpRequest instance that has finished
     *
     * @return {undefined}
     */
    async requestFinished(ftpRequest) {
        if (ftpRequest && !ftpRequest.historyDone) {
            this.logDebug('Finished ftp request ' + ftpRequest.id + ' ' + this.sanitizeCommand(ftpRequest.command));
            ftpRequest.historyDone = true;
            this.deactivateFtpRequest(ftpRequest, false);
            this.resetCurrentSpeed(ftpRequest);
            this.statistics.currentSpeed = 0;
            if (ftpRequest.isUpload) {
                this.statistics.currentUploadSpeed = 0;
            } else {
                this.statistics.currentDownloadSpeed = 0;
            }
            if (this.options.keepStatisticsHistory) {
                if (!ftpRequest.isPassive) {
                    this.addZeroHistoryEntry(ftpRequest, { isEnd: true });
                } else {
                    if (ftpRequest.progressHistory.length) {
                        this.addZeroHistoryEntry(ftpRequest, { isEnd: true });
                    } else {
                        this.addHistoryEntry(ftpRequest, ftpRequest.speed, new Date(ftpRequest.startTime));
                        this.addHistoryEntry(ftpRequest, ftpRequest.speed, new Date(ftpRequest.endTime));
                        this.addZeroHistoryEntry(ftpRequest, { isEnd: true });
                    }
                }
            }
        }
    }

    /**
     * Turn speed throttling on or off
     *
     * @param {Boolean} limiting Flag to turn speed limiting on or off
     *
     * @return {undefined}
     */
    setLimiting(limiting) {
        this.setOption('limitSpeed', limiting);
        if (this.currentLimiter) {
            this.currentLimiter.setLimiting(limiting);
        }
    }

    /**
     * Update speed limits for current limiter (using values from options)
     *
     * @return {undefined}
     */
    updateSpeedLimits() {
        if (this.currentLimiter) {
            if (this.currentLimiter.isUpload) {
                this.currentLimiter.setRate(this.options.limitUpload);
            } else {
                this.currentLimiter.setRate(this.options.limitDownload);
            }
        }
    }

    /**
     * Helper method that overrides 'emit' methods by adding logging for debugging purposes
     *
     * @param  {Mixed}  obj         Object that should have its 'emit' overriden
     * @param  {String} name        Name to show when logging (helps with identification when multiple objects have their 'emit' methods overriden)
     * @param  {Array}  eventNames  Names of events to log, if empty all events are logged
     *
     * @return {undefined}
     */
    overrideEmitLog(obj, name = '', eventNames = []) {
        if (!obj.__emitOverriden) {
            obj.__emitOverriden = true;
            obj._emit = obj.emit;
            obj.emit = (...args) => {
                let returnValue;
                let emitArguments = Array.prototype.slice.call(args);
                let eventName = _.head(emitArguments);
                let eventArgs = _.tail(emitArguments);
                let shouldLog = true;
                if (eventNames && eventNames.length) {
                    if (!_.includes(eventNames, eventName)) {
                        shouldLog = false;
                    }
                }
                if (shouldLog) {
                    console.log(name, eventName, eventArgs, obj);
                }
                if (obj && obj._emit && _.isFunction(obj._emit)) {
                    returnValue = obj._emit.apply(obj, emitArguments);
                }

                return returnValue;
            };
        }
    }

    /**
     * Clears finished queue
     *
     * @return {undefined}
     */
    clearFinishedQueue(){
        this.finishedQueue = [];
    }

    async getItemStructure(ftpPath, recursive = true, flat = false){
        let itemList = [];
        let childList = [];
        try {
            itemList = await this.list(ftpPath, true);
        } catch (ex) {
            this.logError('Problem getting item structure for "' + ftpPath + '" - "' + ex.message + '"');
            return [];
        }
        itemList = _.filter(itemList, (item) => {
            let result = true;
            result = result && item.name !== '..';
            return result;
        });
        if (recursive){
            for (let i = 0; i < itemList.length; i++){
                if (itemList[i].type == 'd' && itemList[i].name != '..' && itemList[i].name != '.'){
                    let itemChildren = await this.getItemStructure(itemList[i].fullPath, recursive, flat);
                    if (flat) {
                        childList = _.concat(childList, itemChildren);

                    } else {
                        if (itemChildren && itemChildren.length){
                            itemList[i].children = itemChildren;
                        }
                    }
                }
            }
            if (flat) {
                itemList = _.concat(itemList, childList);
            }
        }
        this.logInfo('Loaded item structure for "' + ftpPath + '"');
        return itemList;
    }

    /**
     * Returns bool value indicating whether compression can be used
     *
     * @return {Boolean} Compression availability
     */
    canUseCompression () {
        this.statistics.compressionEnabled = this.options.compression && this.hasFeature('MODE Z');
        return this.statistics.compressionEnabled;
    }

    addHistoryEntry(ftpRequest, speed, time, additionalData) {
        this.setCurrentSpeed(ftpRequest, speed);
        ftpRequest.historyStarted = true;
        let protoAdditionalData = {
            command: ftpRequest.id + ' ' + this.sanitizeCommand(ftpRequest.command),
            isUpload: ftpRequest.isUpload,
            duration: null,
            transferred: null,
            chunkSize: null,
            isEnd: false,
            isFirst: false,
            isZero: false
        };
        if (!additionalData) {
            additionalData = _.cloneDeep(protoAdditionalData);
        } else {
            additionalData = _.defaultsDeep({}, additionalData, protoAdditionalData);
        }
        let historyEntry = this.getHistoryEntry(speed, new Date(time), additionalData);
        if (ftpRequest.isUpload) {
            this.addCurrentUploadHistoryEntry(historyEntry);
        } else {
            this.addCurrentDownloadHistoryEntry(historyEntry);
        }
    }

    getHistoryEntry(speed, time = null, additionalData = null) {
        if (!time) {
            time = new Date();
        }
        let protoAdditionalData = {
            command: '',
            isUpload: false,
            duration: null,
            transferred: null,
            chunkSize: null,
            isEnd: false,
            isFirst: false,
            isZero: false
        };
        if (!additionalData) {
            additionalData = _.cloneDeep(protoAdditionalData);
        } else {
            additionalData = _.defaultsDeep({}, additionalData, protoAdditionalData);
        }

        let historyEntry = {
            time: time,
            speed: speed,
            additionalData: additionalData
        };
        return historyEntry;
    }

    addCurrentUploadHistoryEntry(historyEntry) {
        if (this.options.keepStatisticsHistory) {
            this.statistics.currentUploadSpeedHistory.push(historyEntry);
        }
    }

    addCurrentDownloadHistoryEntry(historyEntry) {
        if (this.options.keepStatisticsHistory) {
            this.statistics.currentDownloadSpeedHistory.push(historyEntry);
        }
    }

    addZeroHistoryEntry(ftpRequest, additionalData = null, now = null) {
        if (!now) {
            now = Date.now() + 1;
        }
        let protoAdditionalData = {
            command: ftpRequest.id + ' ' + this.sanitizeCommand(ftpRequest.command),
            isUpload: ftpRequest.isUpload,
            duration: null,
            transferred: null,
            chunkSize: null,
            isEnd: false,
            isFirst: false,
            isZero: true
        };
        if (!additionalData) {
            additionalData = _.cloneDeep(protoAdditionalData);
        } else {
            additionalData = _.defaultsDeep({}, additionalData, protoAdditionalData);
        }
        let zeroEntry = this.getHistoryEntry(0, new Date(now), additionalData);
        if (ftpRequest.isUpload) {
            this.addCurrentUploadHistoryEntry(zeroEntry);
        } else {
            this.addCurrentDownloadHistoryEntry(zeroEntry);
        }
    }

    addAverageHistoryEntry(historyEntry) {
        if (this.options.keepStatisticsHistory) {
            this.statistics.averageSpeedHistory.push(historyEntry);
        }
    }

    formatTimeNormalize (date, omitSeconds = false){

        if (_.isString(date)){
            date = new Date(date);
        }
        let includeDate = true;
        let now = new Date().getTime();
        let timestamp = date.getTime();
        if (now - timestamp < 86400000) {
            includeDate = false;
        }

        let year = date.getFullYear();
        let month = date.getMonth() + 1;
        let day = date.getDate();

        let hours = date.getHours();
        let minutes = date.getMinutes();
        let seconds = date.getSeconds();


        if (month < 10){
            month = '0' + month;
        }

        if (day < 10){
            day = '0' + day;
        }

        if (hours < 10){
            hours = '0' + hours;
        }

        if (minutes < 10){
            minutes = '0' + minutes;
        }
        if (seconds < 10){
            seconds = '0' + seconds;
        }

        let formattedTime = '';
        if (includeDate){
            formattedTime += year + '-' + month + '-' + day;
        }

        formattedTime += ' ';
        formattedTime += hours;
        formattedTime += ':' + minutes;
        if (!omitSeconds) {
            formattedTime += ':' + seconds;
        }

        return formattedTime;

    }
}

module.exports = FtpClient;