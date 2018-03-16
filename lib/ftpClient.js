const _ = require('lodash');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const tls = require('tls');
const ftpClientData = require('./ftpClientData');
const FtpFileItem = require('./ftpFileItem');
const FtpRequest = require('./ftpRequest');
const FtpResponseParser = require('./ftpResponseParser');
const Socket = require('net').Socket;
const EventEmitter = require('events').EventEmitter;
const Writable = require('stream').Writable;


class FtpClient extends EventEmitter {
    constructor(options = null) {
        super();

        this.defaultOptions = {
            compression: false,
            ftpClientData: null,
            fileItemClass: null,
            ftpResponseParserClass: null,
            ftpRequestClass: null,
        };

        this.securityState = null;
        this.secureOptions = {
            host: null,
            socket: null,
            session: null,
            rejectUnauthorized: false,
        };

        if (options && _.isObject(options)) {
            this.options = _.defaultsDeep(options, this.defaultOptions);
        } else {
            this.options = _.cloneDeep(this.defaultOptions);
        }

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

        this.debug = true;
        this.debugLevels = [
            // 'debug',
            // 'info',
            'warning',
            'error',

            // 'commands',
            // 'functionCalls',
        ];

        this.debugCommands = true;
        this.debugFunctions = {
            // handleData: true,
            // handlePassiveData: true,
            // onPassiveEnd: true,
            // onPassiveError: true,
            // onResponse: true,
            // onData: true,
            // onPassiveData: true,
            // onError: true,
            // onEnd: true,
            // command: true,
            // sendDataSync: true,
            // sendCommand: true,
            // sendFtpRequest: true,
            // processQueue: true,
            // processFtpRequest: true,
            // setSecurity: true,
            // connectSecure: true,
        };

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

        this.conns = {
            'maclocal': {host: 'localhost', port: 2121, username: 'maclocal', password: 'maclocal'},
            'mascomdev': {host: 'mascom.spotcraftdev.com', port: 21, username: 'mascom', password: 'com4#MAS'},
            'localftp': {host: '192.168.1.104', port: 2121, username: 'localftp', password: 'local4#FTP', secure: true},
            'mascom': {host: 'ftp.mascom.rs', port: 21, username: 'mascomr', password: '2ENx@LoYJ!6t', secure: true},
        };
    }

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

    initializeParser() {
        this.setParser(new this.parserClass(this.fileItemClass, this.ftpClientData));
    }

    setFtpClientData(clientData) {
        this.ftpClientData = clientData;
    }

    setParserClass(parserClass) {
        this.parserClass = parserClass;
    }

    setFtpRequestClass(ftpRequestClass) {
        this.ftpRequestClass = ftpRequestClass;
    }

    setParser(parser) {
        this.parser = parser;
    }

    setFileItemClass(fileItemClass) {
        this.fileItemClass = fileItemClass;
    }

    setConnection(connection) {
        if (connection && _.isObject(connection)) {
            if (!this.connected) {
                this.connection = _.defaultsDeep(connection, this.defaultConnection);
            } else {
                this.logWarning('Can not set connection while connected');
            }
        }
    }

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

    addEventListeners() {
        this.on('response', this.boundMethods.onResponse);
    }

    removeEventListeners() {
        this.removeListener('response', this.boundMethods.onResponse);
    }

    addObjListener(object, eventName, handler) {
        this.logDebug('Add listener for ' + eventName);
        if (object && object.on && _.isFunction(object.on)){
            object.on(eventName, handler);
        }
    }

    removeObjListener(object, eventName, handler) {
        this.logDebug('Remove listener for ' + eventName);
        if (object && object.removeListener && _.isFunction(object.removeListener)){
            object.removeListener(eventName, handler);
        }
    }

    addOnceObjListener(object, eventName, handler) {
        this.logDebug('Add "once" listener for ' + eventName);
        if (object && object.once && _.isFunction(object.once)){
            object.once(eventName, handler);
        }
    }

    handleData (chunk, encoding, callback = null) {
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

    onPassiveEnd () {
        this.logCall('onPassiveEnd', arguments);
        let passiveSocket = this.getPassiveSocket();
        let text = this._currentPassiveBuffer;
        this._currentPassiveBuffer = '';
        this.emit('passive-response', text);
    }

    onPassiveError (error) {
        this.logCall('onPassiveError', arguments);
        this.logError(error);
    }

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

    hasFeature(featureCommand) {
        return this.features.indexOf(featureCommand) !== -1;
    }

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

    onResponse (responseCode, text) {
        this.logCall('onResponse', arguments);
        this.logDebug({
            responseCode: responseCode,
            text:text
        });
    }

    onTimeout () {
        console.log('Socket timeout', arguments);
    }

    onPassiveTimeout () {
        console.log('Passive socket timeout', arguments);
    }

    onData (chunk) {
        this.logCall('onData', arguments);
        if (this.responseHandler){
            this.responseHandler.write(chunk);
        }
    }

    onPassiveData (chunk) {
        this.logCall('onPassiveData', arguments);
        if (this.passiveResponseHandler){
            this.passiveResponseHandler.write(chunk);
        }
    }

    onError (error) {
        this.logCall('onError', arguments);
        this.logError(error);
    }

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

    onEnd () {
        this.logCall('onEnd', arguments);
        let text = this._currentBuffer;
        this.logDebug({
            text: text
        });
        this._currentBuffer = '';
    }

    log(message) {
        console.log(message);
    }

    logCommand (command) {
        if (this.debug && _.includes(this.debugLevels, 'commands')) {
            console.log('SEND CMD: ' + command);
        }
    }

    logCall(fName, fArguments) {
        if (this.debug && _.includes(this.debugLevels, 'functionCalls') && this.debugFunctions[fName]) {
            console.log('FUNC: ' + fName, fArguments);
        }
    }

    logDebug(message) {
        if (this.debug && _.includes(this.debugLevels, 'debug')) {
            console.log(message);
        }
    }

    logInfo(message) {
        if (this.debug && _.includes(this.debugLevels, 'info')) {
            console.log(message);
        }
    }

    logWarning(message) {
        if (this.debug && _.includes(this.debugLevels, 'warning')) {
            console.warn(message);
        }
    }

    logError(message) {
        if (this.debug && _.includes(this.debugLevels, 'error')) {
            console.error(message);
        }
    }

    command (command, encoding) {
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
            // socket.once('connect', _onPassiveSocketConnect;
            // socket.once('error', onerror);
            // socket.once('end', onend);
            // socket.once('close', onclose);


            socket.connect(port, ip);
        };
        return new Promise(_passiveConnect);
    }

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

    getSocket(){
        if (this.secureSocket) {
            return this.secureSocket;
        } else {
            return this.socket;
        }
    }

    getPassiveSocket(){
        let socket;
        if (this.securePassiveSocket) {
            socket = this.securePassiveSocket;
        } else if (this.passiveSocket) {
            socket = this.passiveSocket;
        }
        return socket;
    }

    setPassiveSocket(socket){
        if (socket) {
            this.passiveSocket = socket;
            this.passiveSocket.setTimeout(0);
            this.addSocketListeners(socket, true);
        } else {
            this.logError('Not setting passive socket');
        }
    }

    setSecurePassiveSocket(socket){
        if (socket) {
            this.securePassiveSocket = socket;
            this.securePassiveSocket.setTimeout(0);
            this.addSocketListeners(socket, true);
        } else {
            this.logError('Not setting passive socket');
        }
    }

    createFtpRequest(command = '', encoding = null, active = false, pending = true, finished = false, responseCode = null, response = null, text = null, error = false, errorMessage = '') {
        let frClass = this.ftpRequestClass;
        return new frClass(command, encoding, active, pending, finished, responseCode, response, text, error, errorMessage);
    }

    getFtpRequest(id) {
        let ftpRequest = _.find(this.queue, (item) => {
            return item.id == id;
        });
        return ftpRequest;
    }

    getCommandFtpRequest(id) {
        let ftpRequest = _.find(this.commandQueue, (item) => {
            return item.id == id;
        });
        return ftpRequest;
    }

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

    async sendCommand(command, encoding) {
        this.logCall('sendCommand', arguments);
        let commandObject = this.createFtpRequest(command, encoding);
        let socket = this.getSocket();
        let _sendCommand = (resolve, reject) => {
            let onSendResponse = (responseCode, text) => {
                commandObject.responseCode = responseCode;
                commandObject.response = text;
                commandObject.text = text;
                commandObject.active = false;
                this._currentBuffer = '';
                this.removeObjListener(socket, 'error', onSendError);
                resolve(commandObject);
            };
            let onSendError = (error) => {
                this._currentBuffer = '';
                commandObject.active = false;
                this.removeObjListener(this, 'response', onSendResponse);
                reject(error);
            };

            this.addOnceObjListener(this, 'response', onSendResponse);
            this.addOnceObjListener(socket, 'error', onSendError);
            commandObject.active = true;
            this.commandQueue.push(commandObject);
            this.command(command, encoding);
        };
        return new Promise(_sendCommand);
    }

    async sendFtpRequest(ftpRequest) {
        this.logCall('sendFtpRequest', arguments);
        let coId = ftpRequest.id;
        let _sendFtpRequest = async (resolve, reject) => {
            let socket = this.getSocket();
            let onSendResponse = (responseCode, text) => {
                ftpRequest.responseCode = responseCode;
                ftpRequest.response = text;
                ftpRequest.text = text;
                ftpRequest.active = false;
                if (responseCode && responseCode >= 500) {
                    ftpRequest.error = true;
                    ftpRequest.errorMessage = text;
                    reject(new Error(text));
                }
                this.removeObjListener(socket, 'error', onSendError);
                resolve(ftpRequest);
            };
            let onSendError = async (error) => {
                ftpRequest.active = false;
                this.removeObjListener(this, 'response', onSendResponse);
                await this.sendCommand('MODE S');
                reject(error);
            };

            let passiveSocket = this.getPassiveSocket();
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

    getActiveFtpRequest() {
        let ftpRequest = _.find(this.queue, (item) => {
            return !item.pending && item.active && !item.finished;
        });
        return ftpRequest;
    }

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

    async processFtpRequest(ftpRequest) {
        this.logCall('processFtpRequest', arguments);
        // let usePassive = false;
        // if (ftpRequest.baseCommand) {
        //     for (let i=0; i<this.ftpClientData.passiveCommands.length; i++){
        //         if (ftpRequest.baseCommand.match(new RegExp(this.ftpClientData.passiveCommands[i], 'i'))) {
        //             usePassive = true;
        //         }
        //     }
        // }
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
                        ftpRequest.text = text;
                        ftpRequest.setFinished(true);
                        this.removeObjListener(passiveSocket, 'error', onPassiveError);
                        this.passiveDisconnect();
                        resolve(ftpRequest);
                    };

                    let onPassiveError = (error) => {
                        ftpRequest.error = true;
                        ftpRequest.errorMessage = error + '';
                        this.removeObjListener(this, 'passive-response', onPassiveResponse);
                        this.passiveDisconnect();
                        reject(error);
                    };

                    this.addOnceObjListener(passiveSocket, 'error', onPassiveError);
                    this.addOnceObjListener(this, 'passive-response', onPassiveResponse);
                    try {
                        await this.sendFtpRequest(ftpRequest);
                    } catch (ex) {
                        ftpRequest.error = true;
                        ftpRequest.errorMessage = ex.message;
                        this.passiveDisconnect();
                        this.removeObjListener(passiveSocket, 'error', onPassiveError);
                        this.removeObjListener(this, 'passive-response', onPassiveResponse);
                        reject(ex);
                    }
                } else {
                    ftpRequest.error = true;
                    ftpRequest.errorMessage = 'Can not open data connection';
                    this.passiveDisconnect();
                    reject(new Error('Can not open data connection for "' + ftpRequest.command + '"'));
                }
            };
            return new Promise(_processFtpRequest);
        }
    }

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


    async abort() {
        // let result = false;
        // let ftpRequest = await this.sendCommand('ABOR');
        // if (ftpRequest && ftpRequest.responseCode && ftpRequest.responseCode == 226) {
        //     result = true;
        // } else {
        //     this.logError(ftpRequest.response);
        // }
        // return result;
        return await this.getResponseBool('ABOR', [226]);
    }

    async system() {
        return await this.getResponseText('SYST', [215]);
    }

    async status() {
        return await this.getResponseText('SYST', [211]);
    }

    async site(command) {
        return await this.getResponseText('SITE ' + command, [200]);
    }

    async ascii() {
        return await this.getResponseBool('TYPE A', [200]);
    }

    async binary() {
        return await this.getResponseBool('TYPE I', [200]);
    }

    async logout() {
        return await this.getResponseBool('QUIT', [221]);
    }

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

    async restart(offset) {
        return await this.getResponseBool('REST ' + offset, [350]);
    }

    async size(ftpPath) {
        return parseInt(await this.getResponseText('SIZE ' + ftpPath, [213]), 10);
    }

    async fileExists(ftpPath) {
        let result = await this.lastMod(ftpPath);
        if (result) {
            result = true;
        }
        return result;
    }

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

    async lastMod(ftpPath) {
        return parseInt(await this.getResponseText('MDTM ' + ftpPath, [213]), 10);
    }

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

    async cwd (ftpPath) {
        return await this.getResponseBool('CWD ' + ftpPath, [250]);
    }

    async cdup () {
        return await this.getResponseBool('CDUP', [250]);
    }

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

    async delete (ftpPath) {
        return await this.getResponseBool('DELE ' + ftpPath, [250]);
    }

    async put(input, ftpPath) {
        return await this.store('STOR', input, ftpPath);
    }

    async append(input, ftpPath) {
        return await this.store('APPE', input, ftpPath);
    }

    async store(command, input, ftpPath) {
        let _store = async (resolve, reject) => {
            let isBuffer = Buffer.isBuffer(input);
            command += ' ' + ftpPath;

            if (isBuffer) {
                input.pause();
            }
            await this.startPassive();
            let passiveSocket  = this.getPassiveSocket();
            if (passiveSocket) {
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
                    dest = zlib.createDeflate({ level: 8 });
                    dest.pipe(passiveSocket);
                }


                let storRequest = await this.sendCommand(command);

                if (storRequest && storRequest.responseCode && (storRequest.responseCode === 150 || storRequest.responseCode === 125)) {
                    let onend = async () => {
                        this.removeObjListener(dest, 'error', onerror);
                        if (canCompress) {
                            await this.sendCommand('MODE S');
                        }
                        resolve(true);
                    };

                    let onerror = async (err) => {
                        this.removeObjListener(dest, 'end', onend);
                        if (canCompress) {
                            await this.sendCommand('MODE S');
                        }
                        reject(err);
                    };

                    this.addOnceObjListener(dest, 'end', onend);
                    this.addOnceObjListener(dest, 'error', onerror);
                    if (isBuffer) {
                        dest.end(input);
                    } else if (typeof input === 'string') {
                        fs.stat(input, async (err, /*stats*/) => {
                            if (err) {
                                dest.end(input);
                                if (canCompress) {
                                    await this.sendCommand('MODE S');
                                }
                                reject(err);
                            } else {
                                fs.createReadStream(input).pipe(dest);
                            }
                        });
                    } else {
                        input.pipe(dest);
                        input.resume();
                    }
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

    async isRequestPassive(ftpRequest) {
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