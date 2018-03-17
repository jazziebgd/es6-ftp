const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const tls = require('tls');
const ftpClientData = require('./ftpClientData');
const FtpFileItem = require('./ftpFileItem');
const FtpRequest = require('./ftpRequest');
const FtpResponseParser = require('./ftpResponseParser');
const FtpLimiter = require('./ftpLimiter');
const FtpBase = require('./ftpBase');
const Socket = require('net').Socket;
const EventEmitter = require('events').EventEmitter;
const Writable = require('stream').Writable;

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
     * @param  {Object}     options     Ftp client options object
     * @return {undefined}
     */
    constructor(options = null) {
        super(options);

        this.defaultOptions = {
            compression: false,
            ftpClientData: null,
            fileItemClass: null,
            ftpResponseParserClass: null,
            ftpRequestClass: null,
            compressionLevel: 8,
            limitSpeed: true,
            limitRate: 50 * 1024,
            limitUpload: 10000,
            limitDownload: 10000,

            debug: {
                enabled: true,
                debugLevels: [
                    // 'debug',
                    // 'info',
                    'warning',
                    'error',

                    // 'commands',
                    // 'responses',
                    // 'functionCalls',
                ],
                debugFunctions: {
                    // handleData: true,
                },
            },
        };

        if (options && _.isObject(options)) {
            this.options = _.defaultsDeep(options, this.defaultOptions);
        } else {
            this.options = _.cloneDeep(this.defaultOptions);
        }

        this.greeting ='';

        this.securityState = null;
        this.secureOptions = {
            host: null,
            socket: null,
            session: null,
            rejectUnauthorized: false,
        };

        this.defaultConnection = {
            host: undefined,
            port: undefined,
            user: undefined,
            password: undefined,
            secure: false,
            secureOptions: undefined,
            connTimeout: 10000,
            pasvTimeout: 10000,
            aliveTimeout: 10000
        };

        if (this.options.connection && _.isObject(this.options.connection)) {
            this.connection = _.defaultsDeep(this.options.connection, this.defaultConnection);
        }

        this.queue = [];
        this.commandQueue = [];

        this.features = [];

        this._currentBuffer = '';
        this._currentPassiveBuffer = '';

        this.connected = false;
        this.secureConnected = false;
        this.isPassive = false;

        this.regexes = {
            responseEnd: /(?:^|\r?\n)(\d{3}) [^\r\n]*\r?\n/,
            passiveResponse: /([\d]+),([\d]+),([\d]+),([\d]+),([-\d]+),([-\d]+)/
        };

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
            onPassiveEnd: this.onPassiveEnd.bind(this),
            onPassiveError: this.onPassiveError.bind(this),
            onResponse: this.onResponse.bind(this),
        };


        this.socket = null;
        this.secureSocket = null;

        this.passiveSocket = null;
        this.securePassiveSocket = null;

        this.responseHandler = new Writable({
            write: this.boundMethods.handleData
        });
        this.passiveResponseHandler = new Writable({
            write: this.boundMethods.handlePassiveData
        });

        this.initializeClasses();

        // TESTING PURPOSES ONLY - REMOVE THIS
        this.conns = {
            'maclocal': {host: 'localhost', port: 2121, username: 'maclocal', password: 'maclocal'},
            'localftp': {host: '192.168.1.104', port: 2121, username: 'localftp', password: 'local4#FTP', secure: true},
        };
    }


    // TESTING PURPOSES ONLY - REMOVE THIS
    async testConn(identifier){
        let _testConn = async (resolve) => {
            let connection = _.defaultsDeep(this.conns[identifier], this.defaultConnection);
            let connected = await this.connect(connection);
            if (connected) {
                resolve(true);
            } else {
                resolve(false);
            }
        };
        return new Promise(_testConn);
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
        this.setParser(new this.parserClass(this.fileItemClass, this.ftpClientData));
    }

    /**
     * Sets ftpClientData object for this instance
     *
     * @param {Object}  clientData  Client data object
     */
    setFtpClientData(clientData) {
        this.ftpClientData = clientData;
    }

    /**
     * Sets class that is to be used as ftp response parser for this instance
     *
     * @param {Class} parserClass    ftp response parser class
     */
    setParserClass(parserClass) {
        this.parserClass = parserClass;
    }

    /**
     * Sets class that is to be used as ftp request for this instance
     *
     * @param {Class} ftpRequestClass   Ftp request class
     */
    setFtpRequestClass(ftpRequestClass) {
        this.ftpRequestClass = ftpRequestClass;
    }

    /**
     * Sets parser for this instance
     *
     * @param {Object} parser Ftp response parser object
     */
    setParser(parser) {
        this.parser = parser;
    }

    /**
     * Sets class that is to be used as file item for this instance
     *
     * @param {Class} fileItemClass   file item class
     */
    setFileItemClass(fileItemClass) {
        this.fileItemClass = fileItemClass;
    }

    /**
     * Sets connection data for client
     *
     * @param {Object} connection  Connection data
     */
    setConnection(connection) {
        if (connection && _.isObject(connection)) {
            if (!this.connected) {
                this.connection = _.defaultsDeep(connection, this.defaultConnection);
            } else {
                this.logWarning('Can not set connection while connected');
            }
        }
    }

    /**
     * Adds base socket listeners for client functionality
     *
     * @param {Socket|TLSSocket}  socket    Socket for adding listeners
     * @param {Boolean} passive   Flag to indicate whether socket is passive or active
     */
    addSocketListeners(socket, passive = false) {
        if (!passive) {
            socket.on('data', this.boundMethods.onData);
            socket.on('end', this.boundMethods.onEnd);
            socket.on('close', this.boundMethods.onClose);
            socket.on('error', this.boundMethods.onError);
        } else {
            socket.on('data', this.boundMethods.onPassiveData);
            socket.on('end', this.boundMethods.onPassiveEnd);
            socket.on('error', this.boundMethods.onPassiveError);
        }
    }

    /**
     * Removes base socket listeners added with addSocketListeners method
     *
     * @param {Socket|TLSSocket}  socket    Socket for removing listeners
     * @param {Boolean} passive   Flag to indicate whether socket is passive or active
     */
    removeSocketListeners(socket, passive = false) {
        if (!passive) {
            socket.removeListener('data', this.boundMethods.onData);
            socket.removeListener('end', this.boundMethods.onEnd);
            socket.removeListener('close', this.boundMethods.onClose);
            socket.removeListener('error', this.boundMethods.onError);
        } else {
            socket.removeListener('data', this.boundMethods.onPassiveData);
            socket.removeListener('end', this.boundMethods.onPassiveEnd);
            socket.removeListener('error', this.boundMethods.onPassiveError);
        }
    }

    /**
     * Adds event listeners for client
     */
    addEventListeners() {
        this.on('response', this.boundMethods.onResponse);
    }

    /**
     * Removes event listeners added with addEventListeners method
     */
    removeEventListeners() {
        this.removeListener('response', this.boundMethods.onResponse);
    }

    /**
     * Helper method for adding event listener to an object
     *
     * @param {Object}   object     Object that listener will be added to
     * @param {String}   eventName  Name of the event to observe
     * @param {Function} handler    Handler method that event will trigger
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
     */
    removeObjListener(object, eventName, handler) {
        this.logDebug('Remove listener for ' + eventName);
        if (object && object.removeListener && _.isFunction(object.removeListener)){
            object.removeListener(eventName, handler);
        }
    }

    /**
     * Adds speed limiter (throttling) to socket or stream (if limiting is enabled in options)
     *
     * @param  {Socket|TLSSocket}           Socket or stream on which speed limit will be applied
     * @return {Socket|TLSSocket|Stream}    Socket or stream with applied speed limiter
     */
    limitSocketSpeed(socket) {
        let limited = socket;
        if (this.options.limitSpeed) {
            let limiter = new FtpLimiter();
            limiter.setLimiting(this.options.limitSpeed);
            limiter.setRate(this.options.limitRate);
            limited = socket.pipe(limiter);
        }
        return limited;
    }

    /**
     * Method that handles 'data' event on command sockets
     *
     * @param  {Buffer}   Buffer with data
     * @param  {String}   Encoding (default = null)
     * @param  {Function} Callback function
     */
    handleData (chunk, encoding = null, callback = null) {
        this.logCall('handleData', arguments);
        this._currentBuffer += chunk.toString('binary');

        let match;
        let responseCode;
        let reRmLead;
        let rest = '';
        while ((match = this.regexes.responseEnd.exec(this._currentBuffer))) {
            // support multiple terminating responses in the buffer
            rest = this._currentBuffer.substring(match.index + match[0].length);
            if (rest.length) {
                this._currentBuffer = this._currentBuffer.substring(0, match.index + match[0].length);
            }

            // we have a terminating response line
            responseCode = parseInt(match[1], 10);

            // RFC 959 does not require each line in a multi-line response to begin
            // with '<code>-', but many servers will do this.
            //
            // remove this leading '<code>-' (or '<code> ' from last line) from each
            // line in the response ...
            reRmLead = '(^|\\r?\\n)';
            reRmLead += match[1];
            reRmLead += '(?: |\\-)';
            reRmLead = new RegExp(reRmLead, 'g');
            let text = this._currentBuffer.replace(reRmLead, '$1').trim();
            this._currentBuffer = rest;
            // this._currentBuffer = '';
            this.emit('response', responseCode, text);
        }
        if (callback && _.isFunction(callback)) {
            callback();
        }
    }

    /**
     * Method that handles 'data' event on passive sockets
     *
     * @param  {Buffer}   Buffer with data
     * @param  {String}   Encoding (default = null)
     * @param  {Function} Callback function
     */
    handlePassiveData (chunk, encoding, callback = null) {
        this.logCall('handlePassiveData', arguments);
        this._currentPassiveBuffer += chunk.toString('binary');

        let match;
        let responseCode;
        let reRmLead;
        let rest = '';

        while (match = this.regexes.responseEnd.exec(this._currentPassiveBuffer)) {
            // support multiple terminating responses in the buffer
            rest = this._currentPassiveBuffer.substring(match.index + match[0].length);
            if (rest.length) {
                this._currentPassiveBuffer = this._currentPassiveBuffer.substring(0, match.index + match[0].length);
            }

            // we have a terminating response line
            responseCode = parseInt(match[1], 10);

            // RFC 959 does not require each line in a multi-line response to begin
            // with '<code>-', but many servers will do this.
            //
            // remove this leading '<code>-' (or '<code> ' from last line) from each
            // line in the response ...
            reRmLead = '(^|\\r?\\n)';
            reRmLead += match[1];
            reRmLead += '(?: |\\-)';
            reRmLead = new RegExp(reRmLead, 'g');
            let text = this._currentPassiveBuffer.replace(reRmLead, '$1').trim();
            this._currentPassiveBuffer = rest;
            // this._currentPassiveBuffer = '';
            // this.emit('passive-response', code, text);
        }
        if (callback && _.isFunction(callback)) {
            callback();
        }
    }

    /**
     * Handler for 'end' event on passive sockets
     *
     * @return {undefined}
     */
    onPassiveEnd () {
        this.logCall('onPassiveEnd', arguments);
        let passiveSocket = this.getPassiveSocket();
        let text = this._currentPassiveBuffer;
        this._currentPassiveBuffer = '';
        this.emit('passive-response', text);
    }

    /**
     * Handler for 'error' event on passive sockets
     *
     * @param  {Error|String}  Error object or error message
     * @return {undefined}
     */
    onPassiveError (error) {
        this.logCall('onPassiveError', arguments);
        this.logError(error);
    }

    /**
     * Connects to ftp server using either connection data from argument or this.connection (if no argument passed)
     * Reads feature list from ftp server and sets up secure transfer if enabled in connection data and supported by server
     * Sets transfer mode to 'binary' by default
     *
     * @async
     * @throws {Error} If connection can't be established
     * @param  {Object} connection  Connection options
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

                // TESTING PURPOSES ONLY, REMEMBER TO REMOVE
                window.addEventListener('beforeunload', () => {
                    this.disconnect();
                });


                this.addSocketListeners(this.socket);
                this.addEventListeners();
                setTimeout(async () => {
                    await this.getFeatures();
                    await this.setSecurity();
                    if (this.connection.username && this.connection.password) {
                        await this.login();
                    }
                    await this.binary();
                    resolve(true);
                }, 1000);
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
     * @return {Boolean}            Connecting result
     */
    async establishConnection (connection = null) {
        if (!connection) {
            connection = this.connection;
        } else {
            this.connection = connection;
        }
        this.connection = _.defaultsDeep(this.connection, this.defaultConnection);
        let host = this.connection.host;
        let port = this.connection.port;

        this.socket = new Socket();
        this.socket.setTimeout(0);
        this.socket.setKeepAlive(true);

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
     * @return {undefined}
     */
    async disconnect() {
        this.logCall('disconnect', arguments);
        if (this.isPassive) {
            this.passiveDisconnect();
        }
        if (this.socket && this.socket.writable) {
            this.connected = false;
            if (!this.socket.destroyed) {
                this.socket.removeAllListeners();
                this.socket.destroy();
                this.socket = null;
            } else {
                this.logWarning('Already disconnected');
            }
        } else {
            this.logWarning('Socket unavailable or already disconnected');
        }
        if (this.secureSocket && this.secureSocket.writable) {
            this.secureConnected = false;
            this.securityState = null;
            if (!this.secureSocket.destroyed) {
                this.secureSocket.removeAllListeners();
                this.secureSocket.destroy();
                this.secureSocket = null;
            }
        }
    }

    /**
     * Sets security level if specified by connection options
     *
     * @async
     * @return {Boolean} Security setting result
     */
    async setSecurity () {
        this.logCall('setSecurity', arguments);
        let error = false;
        if (this.connection.secure) {
            try {
                let ftpRequest = await this.sendCommand('AUTH TLS');
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
                        this.secureConnected = true;
                        this.addSocketListeners(this.secureSocket);
                    } else {
                        this.logError('Secure connection failed');
                    }
                    try {
                        let ftpRequest = await this.sendCommand('PBSZ 0');
                        if (!(ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 200)) {
                            error = new Error(ftpRequest.response);
                        }
                    } catch (ex) {
                        error = ex;
                    }

                    if (!error) {
                        try {
                            let ftpRequest = await this.sendCommand('PROT P');
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
     * @return {undefined}
     */
    async getFeatures() {
        this.logCall('getFeatures', arguments);
        let feat = await this.sendCommand('FEAT');
        if (feat && feat.text) {
            let featLines = feat.text.split(/\r?\n/g);
            for (let i=1; i<(featLines.length - 1); i++){
                this.features.push(_.trim(featLines[i]));
            }
        }
    }

    /**
     * Checks whether server supports given command
     *
     * @param  {String} featureCommand  Command to check support for
     * @return {Boolean}                True if supported, false otherwise
     */
    hasFeature(featureCommand) {
        return this.features.indexOf(featureCommand) !== -1;
    }

    /**
     * Logs user on FTP server
     *
     * @async
     * @return {Boolean} Login result
     */
    async login() {
        this.logCall('login', arguments);
        let loggedIn = false;
        if (this.connection && this.connection.username && this.connection.password) {
            let username = this.connection.username;
            let password = this.connection.password;
            let userResponse;
            this.logDebug('Logging in...');
            try {
                userResponse = await this.sendCommand('USER ' + username);
            } catch (ex) {
                this.logError('Problem logging in - error sending USER: ' + ex.message);
            }
            if (userResponse && userResponse.responseCode && userResponse.responseCode == 331) {
                this.logDebug('Username accepted, sending password...');
                let passResponse;
                try {
                    passResponse = await this.sendCommand('PASS ' + password);
                } catch (ex) {
                    this.logError('Problem logging in - error sending PASS: ' + ex.message);
                }
                if (passResponse && passResponse.responseCode && passResponse.responseCode == 230) {
                    this.log('Password accepted, login successful.');
                    loggedIn = true;
                } else {
                    this.logError('Problem logging in: ' + passResponse.text);
                }
            } else {
                this.logError('Problem logging in');
            }
            return loggedIn;
        } else {
            return false;
        }
    }

    /**
     * Handler for 'response' event emitted when ftp command execution finishes
     *
     * @param  {Number} responseCode    Response code from FTP server
     * @param  {String} text            Response text from FTP server
     * @return {undefined}
     */
    onResponse (responseCode, text) {
        if (!this.greeting) {
            this.greeting = text;
        }
        this.logCall('onResponse', arguments);
        this.logResponse({
            responseCode: responseCode,
            text:text
        });
    }

    /**
     * Handler for socket 'timeout' event
     *
     * @return {undefined}
     */
    onTimeout () {
        console.log('Socket timeout', arguments);
    }

    /**
     * Handler for passive socket 'timeout' event
     *
     * @return {undefined}
     */
    onPassiveTimeout () {
        console.log('Passive socket timeout', arguments);
    }

    /**
     * Handler for socket 'data' event
     *
     * @param  {Buffer} Data sent from server
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
     * @param  {Buffer} Data sent from server
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
     * @param  {Error} Error object
     * @return {undefined}
     */
    onError (error) {
        this.logCall('onError', arguments);
        this.logError(error);
    }

    /**
     * Handler for socket 'close' event
     *
     * @param  {Boolean} hadErr Flag to indicate whether socket had error or not
     * @return {undefined}
     */
    onClose (hadErr) {
        this.logCall('onClose', arguments);
        this.removeSocketListeners(this.socket);
        if (hadErr) {
            this.logError('Connection closed with error');
        } else {
            this.log('Connection closed');
        }
        this.disconnect();
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
    }

    /**
     * Send raw command on active FTP socket
     * @param  {String}     command     Command to send
     * @param  {String}     encoding    Encoding to use
     * @return {undefined}
     */
    command (command, encoding = null) {
        this.logCall('command', arguments);
        let socket = this.getSocket();
        if (!command.match(/^PASS/i)) {
            this.logCommand(command);
        } else {
            this.logCommand('PASS ******');
        }
        this._currentBuffer = '';
        socket.write(command + '\r\n', encoding);
    }

    /**
     * Starts passive mode
     *
     * @async
     * @return {Socket} Passive socket
     */
    async startPassive() {
        this.logCall('startPassive', arguments);
        this.logDebug('Starting passive mode');
        let first = true;
        let ip = '';
        let port = null;
        let response = await this.sendCommand('PASV');
        let matches = this.regexes.passiveResponse.exec(response.text);
        if (!matches) {
            this.logError('Passive command error');
            this.logError(matches);
            this.logError(response.text);
            return false;
        }
        if (first) {
            ip = _.slice(matches, 1, 5).join('.');
            port = (parseInt(matches[5], 10) * 256) + parseInt(matches[6], 10);
            first = false;
        }
        if (this.passiveSocket || this.securePassiveSocket){
            this.logDebug('Destroying previous passive socket');
            this.passiveDisconnect();
        }
        this.logDebug('Creating passive socket');
        let passiveSocket;
        try {
            passiveSocket = await this.passiveConnect(ip, port);
            if (passiveSocket) {
                this.isPassive = true;
                this.logDebug('Passive mode established, ip:' + ip + ', port: ' + port);
            } else {
                this.logError('Passive mode failed');
                this.isPassive = false;
            }
        } catch (ex) {
            this.logError(ex);
            this.isPassive = false;
        }

        return passiveSocket;
    }

    /**
     * Connects data connection on passive socket
     *
     * @async
     * @throws {Exception} If data connection can't be established
     *
     * @param  {String} Server IP address
     * @param  {Number} Server port
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
                        this.setSecurePassiveSocket(socket);
                        resolve(socket);
                    }
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
     * @return {Boolean} True if disconnected, false otherwise
     */
    passiveDisconnect () {
        this.logCall('passiveDisconnect', arguments);
        let result = true;
        if (this.passiveSocket) {
            if (this.passiveSocket.destroy && _.isFunction(this.passiveSocket.destroy)) {
                this.passiveSocket.removeAllListeners();
                this.passiveSocket.destroy();
                this.passiveSocket = null;
                this.logInfo('Passive data connection closed');
                // result = result && true;
            } else {
                this.logError('Passive data connection closing error - no passive socket');
                result = false;
            }
        }
        if (this.secureConnected && this.securePassiveSocket) {
            if (this.securePassiveSocket.destroy && _.isFunction(this.securePassiveSocket.destroy)) {
                this.securePassiveSocket.removeAllListeners();
                this.securePassiveSocket.destroy();
                this.securePassiveSocket = null;
                this.logInfo('Secure passive data connection closed');
                // result = result && true;
            } else {
                this.logError('Secure passive data connection closing error - no passive socket');
                result = false;
            }
        }

        if (result) {
            this.isPassive = false;
        }

        return result;
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
        return socket;
    }

    /**
     * Sets data (passive) socket and adds listeners for it
     *
     * @param {Socket} Passive socket
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
     * @param {TLSSocket} Secure passive socket
     */
    setSecurePassiveSocket(socket){
        if (socket) {
            this.securePassiveSocket = socket;
            this.securePassiveSocket.setTimeout(0);
            this.addSocketListeners(socket, true);
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
    createFtpRequest(command = '', encoding = null, active = false, pending = true, finished = false, responseCode = null, response = null, text = null, error = false, errorMessage = '') {
        let frClass = this.ftpRequestClass;
        return new frClass(command, encoding, active, pending, finished, responseCode, response, text, error, errorMessage);
    }

    /**
     * Gets ftp request from current (data) queue by its id
     *
     * @param  {String} id  Ftp request id
     * @return {FtpRequest} Ftp request instance
     */
    getFtpRequest(id) {
        let ftpRequest = _.find(this.queue, (item) => {
            return item.id == id;
        });
        return ftpRequest;
    }

    /**
     * Gets ftp request from current (command) queue by its id
     *
     * @param  {String} id  Ftp request id
     * @return {FtpRequest} Ftp request instance
     */
    getCommandFtpRequest(id) {
        let ftpRequest = _.find(this.commandQueue, (item) => {
            return item.id == id;
        });
        return ftpRequest;
    }

    /**
     * Sends ftp request to server and returns it upon response
     *
     * @async
     * @throws {Error} If request fails
     *
     * @param  {FtpRequest} Ftp request to send
     * @return {FtpRequest} Ftp request with server responses populated
     */
    async sendDataSync(ftpRequest) {
        this.logCall('sendDataSync', arguments);
        let _sendDataSync = (resolve, reject) => {
            let socket = this.getSocket();
            let onSendResponse = (responseCode, text) => {
                ftpRequest.responseCode = responseCode;
                ftpRequest.response = text;
                ftpRequest.text = text;
                ftpRequest.setFinished(true);
                this._currentBuffer = '';
                this.removeObjListener(socket, 'error', onSendError);
                resolve(ftpRequest);
            };
            let onSendError = (error) => {
                // this.logError(error);
                ftpRequest.setError(error + '');
                this._currentBuffer = '';
                this.removeObjListener(this, 'response', onSendResponse);
                reject(error);
            };

            // this.once('response', onSendResponse);
            this.addOnceObjListener(this, 'response', onSendResponse);
            this.addOnceObjListener(socket, 'error', onSendError);
            // this.socket.once('error', onSendError);
            this.command(ftpRequest.command, ftpRequest.encoding);
        };
        return new Promise(_sendDataSync);
    }

    /**
     * Sends command to server creating new ftp request and returns request object with server responses
     *
     * @async
     * @throws {Error} If request fails
     *
     * @param  {String}     FTP command
     * @param  {String}     FTP command encodinf
     * @return {FtpRequest} Ftp request object populated with server response
     */
    async sendCommand(command, encoding) {
        this.logCall('sendCommand', arguments);
        let commandObject = this.createFtpRequest(command, encoding);
        let socket = this.getSocket();
        let _sendCommand = (resolve, reject) => {
            let onSendResponse = (responseCode, text) => {
                commandObject.responseCode = responseCode;
                commandObject.response = text;
                commandObject.text = text;
                // commandObject.active = false;
                this._currentBuffer = '';
                this.removeObjListener(socket, 'error', onSendError);
                resolve(commandObject);
            };
            let onSendError = (error) => {
                this._currentBuffer = '';
                // commandObject.active = false;
                this.removeObjListener(this, 'response', onSendResponse);
                reject(error);
            };

            this.addOnceObjListener(this, 'response', onSendResponse);
            this.addOnceObjListener(socket, 'error', onSendError);
            // commandObject.active = true;
            this.commandQueue.push(commandObject);
            this.command(command, encoding);
        };
        return new Promise(_sendCommand);
    }

    /**
     * Sends ftp request to server and returns request object with server responses
     *
     * @async
     * @throws {Error} If request fails
     *
     * @param  {FtpRequest} Ftp request
     * @return {FtpRequest} Ftp request object populated with server response
     */
    async sendFtpRequest(ftpRequest) {
        this.logCall('sendFtpRequest', arguments);
        let coId = ftpRequest.id;
        let _sendFtpRequest = async (resolve, reject) => {
            let socket = this.getSocket();
            let onSendResponse = (responseCode, text) => {
                ftpRequest.responseCode = responseCode;
                ftpRequest.response = text;
                ftpRequest.text = text;
                // ftpRequest.active = false;
                if (responseCode && responseCode >= 500) {
                    ftpRequest.setError(text);
                    // ftpRequest.error = true;
                    // ftpRequest.errorMessage = text;
                    reject(new Error(text));
                }
                this.removeObjListener(socket, 'error', onSendError);
                resolve(ftpRequest);
            };
            let onSendError = async (error) => {
                // ftpRequest.active = false;
                this.removeObjListener(this, 'response', onSendResponse);
                await this.sendCommand('MODE S');
                reject(error);
            };

            let passiveSocket = this.getPassiveSocket();
            passiveSocket = this.limitSocketSpeed(passiveSocket);
            let source = passiveSocket;
            let canCompress = false;
            if (this.options.compression && this.hasFeature('MODE Z')) {
                try {
                    let modeZResponse = await this.sendCommand('MODE Z');
                    if (modeZResponse && modeZResponse.responseCode && modeZResponse.responseCode == 200) {
                        canCompress = true;
                        source.pause();
                    } else {
                        canCompress = false;
                        await this.sendCommand('MODE S');
                    }
                } catch (ex) {
                    canCompress = false;
                    this.logError('MODE Z error: ' + ex.message);
                    await this.sendCommand('MODE S');
                }
            }
            if (canCompress) {
                source = zlib.createInflate();
                passiveSocket.pipe(source);
                passiveSocket._emit = passiveSocket.emit;
                passiveSocket.emit = async (ev, arg1) => {
                    if (ev === 'error') {
                        this.onPassiveError(arg1);
                        reject(arg1);
                        return;
                    } else if (ev == 'data') {
                        this.onPassiveData(arg1);
                    } else if (ev == 'end') {
                        await this.sendCommand('MODE S');
                        this.onPassiveEnd();
                    }
                    if (passiveSocket && passiveSocket._emit && _.isFunction(passiveSocket._emit)) {
                        passiveSocket._emit.apply(passiveSocket, Array.prototype.slice.call(arguments));
                    }
                };
            }

            this.addOnceObjListener(this, 'response', onSendResponse);
            this.addOnceObjListener(socket, 'error', onSendError);
            this.command(ftpRequest.command, ftpRequest.encoding);
        };
        return new Promise(_sendFtpRequest);
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
     * Queues ftp command in data queue
     *
     * @async
     * @param  {String}             command             Ftp command
     * @param  {String}             encoding            Ftp command encoding
     * @param  {Boolean}            executeImmediately  Flag to set immediate execution if queue is empty
     * @return {Boolean|FtpRequest}                     FtpRequest instance if command is immediately executed or boolean result of queueing the comand
     */
    async queueCommand(command, encoding = null, executeImmediately = false) {
        let ftpRequest = this.createFtpRequest(command, encoding);
        let queueSize = this.queue.length;
        if (ftpRequest) {
            this.queue.push(ftpRequest);
            if (!queueSize && executeImmediately) {
                return await this.processQueue();
            } else {
                return true;
            }
        } else {
            return false;
        }
    }

    /**
     * Processes ftp data queue
     *
     * @async
     * @return {Boolean|FtpRequest} FtpRequest instance if there is no active request or false otherwise
     */
    async processQueue() {
        this.logCall('processQueue', arguments);
        if (this.queue && this.queue.length) {
            let activeFtpRequest = this.getActiveFtpRequest();
            if (!activeFtpRequest) {
                let ftpRequest = _.find(this.queue, (item) => {
                    return item.pending && !item.active && !item.finished;
                });
                if (ftpRequest) {
                    await this.processFtpRequest(ftpRequest);
                    _.pullAt(this.queue, 0);
                    return ftpRequest;
                } else {
                    return false;
                }
            } else {
                this.logWarning('There already is an active request, not processing queue')
                return false;
            }
        } else {
            this.logWarning('Queue is empty, nothing to process');
            return false;
        }
    }

    /**
     * Processes single ftp request (send to server and handle data)
     *
     * @async
     * @throws {Error|Exception} If request fails
     *
     * @param  {FtpRequest}         Ftp request to process
     * @return {Boolean|FtpRequest} FtpRequest instance with data from server
     */
    async processFtpRequest(ftpRequest) {
        this.logCall('processFtpRequest', arguments);
        let usePassive = this.isRequestPassive(ftpRequest);
        ftpRequest.setActive();

        if (!usePassive) {
            await this.sendDataSync(ftpRequest);
            return ftpRequest;
        } else {
            let _processFtpRequest = async (resolve, reject) => {
                await this.startPassive();
                let passiveSocket = this.getPassiveSocket();
                if (passiveSocket) {
                    let onPassiveResponse = (text) => {
                        this.logResponse({
                            request: ftpRequest,
                            text: text
                        });
                        ftpRequest.text = text;
                        ftpRequest.setFinished(true);
                        this.removeObjListener(passiveSocket, 'error', onPassiveError);
                        this.passiveDisconnect();
                        resolve(ftpRequest);
                    };

                    let onPassiveError = (error) => {
                        ftpRequest.setError(error + '');
                        this.removeObjListener(this, 'passive-response', onPassiveResponse);
                        this.passiveDisconnect();
                        reject(error);
                    };

                    this.addOnceObjListener(passiveSocket, 'error', onPassiveError);
                    this.addOnceObjListener(this, 'passive-response', onPassiveResponse);
                    try {
                        await this.sendFtpRequest(ftpRequest);
                    } catch (ex) {
                        ftpRequest.setError(ex.message);
                        this.removeObjListener(passiveSocket, 'error', onPassiveError);
                        this.removeObjListener(this, 'passive-response', onPassiveResponse);
                        this.passiveDisconnect();
                        reject(ex);
                    }
                } else {
                    ftpRequest.setError('Can not open data connection');
                    this.passiveDisconnect();
                    reject(new Error('Can not open data connection for "' + ftpRequest.command + '"'));
                }
            };
            return new Promise(_processFtpRequest);
        }
    }

    /**
     * Sends commmand to server and returns boolean result based on success and failure codes from params
     *
     * @async
     * @param  {String}     command         Command to send
     * @param  {Number[]}   successCodes    Array of response codes for which request can be considered as successful
     * @param  {Number[]}   failureCodes    Array of response codes for which request can be considered as failed
     * @return {Boolean}                    Result of the request
     */
    async getResponseBool(command, successCodes = [], failureCodes = []) {
        this.logCall('getResponseBool', arguments);
        let result = false;
        let ftpRequest = await this.sendCommand(command);
        if (ftpRequest && ftpRequest.responseCode) {
            if (successCodes && successCodes.length && _.includes(successCodes, ftpRequest.responseCode)) {
                result = true;
            } else if (failureCodes && failureCodes.length && _.includes(failureCodes, ftpRequest.responseCode)) {
                result = false;
            }
        } else {
            this.logError(ftpRequest.response);
        }
        return result;
    }

    /**
     * Sends commmand to server and returns request text or false based on success and failure codes from params
     *
     * @async
     * @param  {String}     command         Command to send
     * @param  {Number[]}   successCodes    Array of response codes for which request can be considered as successful
     * @param  {Number[]}   failureCodes    Array of response codes for which request can be considered as failed
     * @return {String|Boolean}             Response text or false on failure
     */
    async getResponseText(command, successCodes = [], failureCodes = []) {
        this.logCall('getResponseText', arguments);
        let result = false;
        let ftpRequest = await this.sendCommand(command);
        if (ftpRequest && ftpRequest.responseCode) {
            if (successCodes && successCodes.length && _.includes(successCodes, ftpRequest.responseCode)) {
                result = ftpRequest.response;
            } else if (failureCodes && failureCodes.length && _.includes(failureCodes, ftpRequest.responseCode)) {
                result = false;
            }
        } else {
            this.logError(ftpRequest.response);
        }
        return result;
    }

    /**
     * Aborts current ftp operation
     *
     * @async
     * @return {Boolean}
     */
    async abort() {
        return await this.getResponseBool('ABOR', [226]);
    }

    /**
     * Gets ftp server system information
     *
     * @async
     * @return {String} System information
     */
    async system() {
        return await this.getResponseText('SYST', [215]);
    }

    /**
     * Gets ftp server status information
     *
     * @async
     * @return {String} Status information
     */
    async status() {
        return await this.getResponseText('SYST', [211]);
    }

    /**
     * Sends SITE command to server and returns response text
     *
     * @async
     * @param  {String} command     SITE command to send (without 'SITE')
     * @return {String}             Response text
     */
    async site(command) {
        return await this.getResponseText('SITE ' + command, [200]);
    }

    /**
     * Sets ftp connection mode to 'ASCII'
     *
     * @async
     * @return {Boolean}    Operation result
     */
    async ascii() {
        return await this.getResponseBool('TYPE A', [200]);
    }

    /**
     * Sets ftp connection mode to 'binary'
     *
     * @async
     * @return {Boolean}    Operation result
     */
    async binary() {
        return await this.getResponseBool('TYPE I', [200]);
    }

    /**
     * Logs current user out of the server
     *
     * @async
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
     * @return {FtpFileItem[]}              An array of FtpFileItem instances with file/dir data populated
     */
    async list(ftpPath, listAll = false) {
        let command = 'LIST ';
        if (listAll) {
            command += '-A ';
        }
        command += ftpPath;
        this.queueCommand(command);
        let ftpRequest = await this.processQueue();
        let items = this.parser.parseListResponse(ftpRequest.text, ftpPath);
        return items;
    }

    /**
     * Reads file from FTP server
     *
     * @async
     * @param  {String}     ftpPath     Path of file to read
     * @return {FtpRequest}             Ftp request instance with populated response data
     */
    async get(ftpPath) {
        let command = 'RETR ';
        command += ftpPath;
        this.queueCommand(command);
        let ftpRequest;
        try {
            ftpRequest = await this.processQueue();
        } catch (ex) {
            this.logError(ex.message);
        }
        return ftpRequest;
    }

    /**
     * Renames/moves file/dir on ftp server
     *
     * @async
     * @param  {String}     sourcePath          Source ftp path
     * @param  {String}     destionationPath    Destionation ftp path
     * @return {Boolean}                        Rename operation result
     */
    async rename (sourcePath, destinationPath) {
        let result = false;
        let renFromCommand = await this.sendCommand('RNFR ' + sourcePath);
        if (renFromCommand && renFromCommand.responseCode && renFromCommand.responseCode == 350) {
            let renToCommand = await this.sendCommand('RNTO ' + destinationPath);
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
     * @return {Boolean}        Operation result
     */
    async restart(offset) {
        return await this.getResponseBool('REST ' + offset, [350]);
    }

    /**
     * Gets file size for given file
     *
     * @async
     * @param  {String} ftpPath     Path of file to get size for
     * @return {Number}             Size of file on server
     */
    async size(ftpPath) {
        return parseInt(await this.getResponseText('SIZE ' + ftpPath, [213]), 10);
    }

    /**
     * Checks whether given file exists on server
     *
     * @async
     * @param  {String} ftpPath     Path of file on server
     * @return {Boolean}            True if file exists, false otherwise
     */
    async fileExists(ftpPath) {
        let result = await this.lastMod(ftpPath);
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
     * @param  {String} ftpPath     Ftp file path
     * @return {Number}             Last modification (unix) time for the file
     */
    async lastMod(ftpPath) {
        return parseInt(await this.getResponseText('MDTM ' + ftpPath, [213]), 10);
    }

    /**
     * Gets current working directory on FTP server
     *
     * @async
     * @return {String|Boolean} Current working directory or false if unsuccessful
     */
    async pwd () {
        let result = false;
        let ftpRequest = await this.sendCommand('PWD');
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
     * @return {Boolean}            Operation result
     */
    async cwd (ftpPath) {
        return await this.getResponseBool('CWD ' + ftpPath, [250]);
    }

    /**
     * Moves current working directory to parent dir
     *
     * @async
     * @return {Boolean}            Operation result
     */
    async cdup () {
        return await this.getResponseBool('CDUP', [250]);
    }

    /**
     * Creates new directory on ftp server
     *
     * @async
     * @param  {String}  ftpPath    Path of new dir
     * @param  {Boolean} recursive  Recursive create (if supported by server)
     * @return {Boolean}            Operation result
     */
    async mkdir (ftpPath, recursive = false) {
        let result = false;
        if (!recursive) {
            let ftpRequest = await this.sendCommand('MKD ' + ftpPath);
            if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 257) {
                result = true;
            } else {
                this.logError(ftpRequest.response);
            }
        } else {
            if (this.hasFeature('SITE MKDIR')) {
                let ftpRequest = await this.sendCommand('SITE MKDIR ' + ftpPath);
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
     * @param  {String}  ftpPath    Path of directory to delete
     * @param  {Boolean} recursive  Recursive delete (if supported by server)
     * @return {Boolean}            Operation result
     */
    async rmdir (ftpPath, recursive = false) {
        let result = false;
        if (!recursive) {
            let ftpRequest = await this.sendCommand('RMD ' + ftpPath);
            if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 250) {
                result = true;
            } else {
                this.logError(ftpRequest.response);
            }
        } else {
            if (this.hasFeature('SITE RMDIR')) {
                let ftpRequest = await this.sendCommand('SITE RMDIR ' + ftpPath);
                if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 200) {
                    result = true;
                } else {
                    this.logError(ftpRequest.response);
                }
            } else {
                this.logError('Can not delete recursively, no server support');
            }
        }
        return result;
    }

    /**
     * Deletes file on ftp server
     *
     * @async
     * @param  {String} ftpPath     Path of file to delete
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
     * @return {Boolean}                        Operation result
     */
    async append(input, ftpPath) {
        return await this.store('APPE', input, ftpPath);
    }

    /**
     * Sends file to ftp server
     *
     * @param  {String}                         Command (STOR, STOU or APPE)
     * @param  {String|Stream|Buffer} input     Input (file path, readable stream or buffer)
     * @param  {String}               ftpPath   Path of file to store on ftp server
     * @return {Boolean}                        Operation result
     */
    async store(command, input, ftpPath) {
        let _store = async (resolve, reject) => {
            let isBuffer = Buffer.isBuffer(input);
            let inputStream;
            command += ' ' + ftpPath;

            let error = false;

            if (isBuffer) {
                inputStream = fs.createReadStream(input);
                // inputStream.pause();
            } else if (_.isString(input)) {
                fs.stat(input, async (err, /*stats*/) => {
                    if (err) {
                        // dest.end(input);
                        // if (canCompress) {
                            // await this.sendCommand('MODE S');
                        // }
                        reject(err);
                    } else {
                        inputStream = fs.createReadStream(input);
                        // inputStream.pipe(dest);
                        // inputStream.pause();
                    }
                });
            } else {
                inputStream = input;
                // inputStream.pause();
            }
            await this.startPassive();
            let passiveSocket  = this.getPassiveSocket();
            if (passiveSocket) {
                passiveSocket = this.limitSocketSpeed(passiveSocket);
                // inputStream = this.limitSocketSpeed(inputStream);
                let dest = passiveSocket;

                let canCompress = false;
                if (this.options.compression && this.hasFeature('MODE Z')) {
                    try {
                        let modeZResponse = await this.sendCommand('MODE Z');
                        if (modeZResponse && modeZResponse.responseCode && modeZResponse.responseCode == 200) {
                            canCompress = true;
                        } else {
                            canCompress = false;
                            await this.sendCommand('MODE S');
                        }
                    } catch (ex) {
                        canCompress = false;
                        this.logError('MODE Z error: ' + ex.message);
                        await this.sendCommand('MODE S');
                    }
                }

                if (canCompress) {
                    dest = zlib.createDeflate({ level: this.options.compressionLevel });
                    dest.pipe(passiveSocket);
                }


                let storRequest = await this.sendCommand(command);

                if (storRequest && storRequest.responseCode && (storRequest.responseCode === 150 || storRequest.responseCode === 125)) {
                    let onend = async () => {
                        this.removeObjListener(dest, 'error', onerror);
                        this.removeObjListener(dest, 'finish', onend);
                        this.removeObjListener(dest, 'end', onend);
                        console.log('onend')
                        if (canCompress) {
                            await this.sendCommand('MODE S');
                        }
                        resolve(true);
                    };

                    let onerror = async (err) => {
                        console.log('onerror')
                        this.removeObjListener(dest, 'end', onend);
                        this.removeObjListener(dest, 'finish', onend);
                        if (canCompress) {
                            await this.sendCommand('MODE S');
                        }
                        reject(err);
                    };

                    this.addOnceObjListener(dest, 'end', onend);
                    this.addOnceObjListener(dest, 'finish', onend);
                    this.addOnceObjListener(dest, 'error', onerror);
                    // if (isBuffer) {
                    //     dest.end(inputStream);
                    //     inputStream.resume();
                    // } else if (typeof input === 'string') {
                    //     fs.stat(input, async (err, /*stats*/) => {
                    //         if (err) {
                    //             dest.end(input);
                    //             if (canCompress) {
                    //                 await this.sendCommand('MODE S');
                    //             }
                    //             reject(err);
                    //         } else {
                    //             inputStream = fs.createReadStream(input);
                    //             inputStream.pipe(dest);
                    //             // inputStream.resume();
                    //         }
                    //     });
                    // } else {
                    //     input.pipe(dest);
                    //     // input.resume();
                    // }
                    inputStream.pipe(dest);
                } else {
                    this.logWarning(storRequest.response);
                    if (canCompress) {
                        await this.sendCommand('MODE S');
                    }
                    reject(new Error(storRequest.response));
                }
            }
        };
        return new Promise(_store);
    }

    /**
     * Checks whether given ftp request instance requires passive mode
     *
     * @param  {FtpRequest} Ftp request
     * @return {Boolean}    True if passive, false otherwise
     */
    isRequestPassive(ftpRequest) {
        let usePassive = false;
        if (ftpRequest.baseCommand) {
            for (let i=0; i<this.ftpClientData.passiveCommands.length; i++){
                if (ftpRequest.baseCommand.match(new RegExp(this.ftpClientData.passiveCommands[i], 'i'))) {
                    usePassive = true;
                }
            }
        }
        return usePassive;
    }

}

module.exports = FtpClient;