/**
 * @fileOverview FtpRequest class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;

/**
 * Class FtpRequest
 *
 * Class for objects that represent ftp commands (requests)
 *
 * @property {Boolean}  forceLog            Flag to force (enable) logging for this request when active
 * @property {Boolean}  forceInactiveLog    Flag to force (enable) logging for this request when inactive
 * @property {Boolean}  forceLogTrace       Flag to control whether log messages should contain stack traces
 * @property {String}   id                  Unique id for the request (auto-generated upon class instantiation)
 * @property {String}   command             Ftp command for the request
 * @property {String}   encoding            Encoding for the request
 *
 *
 * TODO
 *
 * @extends {EventEmitter}
 */
class FtpRequest extends EventEmitter {

    /**
     * Class constructor
     *
     * @param  {String} command  Ftp command for this request
     * @param  {String} encoding Request encoding
     *
     * @return {undefined}
     */
    constructor (command = '', encoding = null) {
        super();

        this.forceLog = false;
        this.forceInactiveLog = false;
        this.forceLogTrace = false;

        this.id = _.uniqueId('CMD_');
        this.command = command;
        this.encoding = encoding;
        this.active = false;
        this.pending = true;
        this.finished = false;
        this.previousCodes = [];
        this.responseCode = null;
        this.response = null;
        this.transferred = 0;
        this.size = 0;
        this.startTime = null;
        this.endTime = null;
        this.duration = 0;
        this.text = null;
        this.errorEmitted = false;
        this.error = null;
        this.errorObject = null;
        this.errorMessage = '';
        this._responseBuffer = null;
        this._dataBuffer = null;
        this.input = null;
        this.duration = null;
        this.speed = null;
        this.finishCodes = [];
        this.errorCodes = [];

        this.isPassive = false;
        this.isUpload = false;
        this.isSpeedLimited = false;

        this.socket = null;
        this.passiveSocket = null;
        this.client = null;
        this.parser = null;
        this.source = null;

        this.preventFinish = false;

        this.baseCommand = _.head(_.trimStart(this.command).split(' '));

        this.boundMethods = {
            onError: this.onError.bind(this),
            onData: this.onData.bind(this),
            onEnd: this.onEnd.bind(this),
            onPassivePause: this.onPassivePause.bind(this),
            onPassiveData: this.onPassiveData.bind(this),
            onPassiveEnd: this.onPassiveEnd.bind(this),
            onPassiveError: this.onPassiveError.bind(this),
        };
    }

    shouldLog() {
        return this.forceLog;
    }

    cleanup () {
        if (this.socket && this.socket.removeListener && _.isFunction(this.socket.removeListener)) {
            this.removeSocketListeners(this.socket);
        }
        this.socket = null;
        if (this.passiveSocket && this.passiveSocket.removeListener && _.isFunction(this.passiveSocket.removeListener)) {
            this.removePassiveSocketListeners(this.passiveSocket);
        }
        this.passiveSocket = null;
        this.boundMethods = null;

        if (this.source) {
            this.source = null;
        }

        if (this.client) {
            this.client = null;
        }
        if (this.parser) {
            this.parser = null;
        }
    }

    setSpeedLimited (speedLimited) {
        this.speedLimited = speedLimited;
    }

    setClient (client) {
        this.client = client;
    }

    setParser (parser) {
        this.parser = parser;
    }

    setSource (source) {
        this.source = source;
    }

    setSocket (socket) {
        this.log('Setting socket');
        this.socket = socket;
    }

    addSocketListeners(socket) {
        socket.on('data', this.boundMethods.onData);
        socket.on('end', this.boundMethods.onEnd);
        socket.on('error', this.boundMethods.onError);
    }

    removeSocketListeners(socket) {
        socket.removeListener('data', this.boundMethods.onData);
        socket.removeListener('end', this.boundMethods.onEnd);
        socket.removeListener('error', this.boundMethods.onError);
    }

    setPassiveSocket (socket) {
        this.log('Setting passive socket');
        this.passiveSocket = socket;
    }

    addPassiveSocketListeners (socket) {
        socket.on('pause', this.boundMethods.onPassivePause);
        socket.on('data', this.boundMethods.onPassiveData);
        socket.on('end', this.boundMethods.onPassiveEnd);
        socket.on('error', this.boundMethods.onPassiveError);
    }

    removePassiveSocketListeners (socket) {
        socket.removeListener('pause', this.boundMethods.onPassivePause);
        socket.removeListener('data', this.boundMethods.onPassiveData);
        socket.removeListener('end', this.boundMethods.onPassiveEnd);
        socket.removeListener('error', this.boundMethods.onPassiveError);
    }

    appendBuffer(destination, source) {
        if (!destination) {
            destination = Buffer.from([]);
        }

        let sourceBuffer;
        if (Buffer.isBuffer(source)){
            sourceBuffer = source;
        } else {
            sourceBuffer = Buffer.from(source);
        }

        destination = Buffer.concat([destination, sourceBuffer]);
        return destination;
    }

    onData (chunk, encoding, callback) {
        let canEnd = false;
        this.log('fr ondata', chunk.toString('binary'), encoding);
        if (this.active) {
            this._responseBuffer = this.appendBuffer(this._responseBuffer, chunk);

            let result = false;

            try {
                result = this.parser.parseCommandResponse(this._responseBuffer.toString('binary'));
            } catch (ex) {
                this.log('Error parsing response: ' + ex.message + ', response: "' + chunk.toString('binary') + '"');
            }

            if (result && result.responseCode && !_.isNull(result.responseCode)) {
                if (this.responseCode != result.responseCode){
                    if (!_.isNull(this.responseCode) && this.responseCode){
                        this.previousCodes.push(this.responseCode);
                    }
                    this.responseCode = result.responseCode;
                }

                if (this.responseCode && !this.error) {
                    if (this.errorCodes && this.errorCodes.length && _.includes(this.errorCodes, this.responseCode)){
                        this.setError(result.text, true);
                        canEnd = true;
                    } else if (this.responseCode >= 500) {
                        this.setError(result.text, true);
                        canEnd = true;
                    }
                }

                if (this.isUpload) {
                    if (this.responseCode == 451) {
                        this.setError(new Error(result.text));
                    } else if (this.responseCode === 150 || this.responseCode === 125) {
                        let _onPassiveEnd = () => {
                            if(this.canFinish()){
                                canEnd = true;
                            }
                        };
                        this.client.addOnceObjListener(this.passiveSocket, 'end', _onPassiveEnd);
                        this.source.pipe(this.passiveSocket);
                    } else if (this.canFinish()) {
                        canEnd = true;
                    }
                } else {
                    if (!_.isNull(result.text)){
                        if (!this.isPassive){
                            canEnd = true;
                        }
                    }
                }




            } else {
                this.log('Error parsing response: "' + chunk.toString('binary') + '"');
            }

            if (callback && _.isFunction(callback)) {
                callback();
            }
            if (canEnd) {
                this.onEnd();
            }
        }
    }

    onError (error) {
        this.log('fr onError', error);
        if (this.active) {
            this.setError(error);
        }
    }

    onEnd () {
        this.log('fr onEnd');
        if (this.active) {
            if (this.canFinish()) {
                this.setFinished();
            }
        }
    }

    onPassivePause () {
        this.log('fr onPasvPause');
        if (this.active) {
            this.passiveSocket.resume();
        }
    }

    onPassiveData (chunk, encoding, callback) {
        this.log('fr onpassivedata', chunk.length, encoding, callback);
        if (this.active) {
            this._dataBuffer = this.appendBuffer(this._dataBuffer, chunk);
            if (callback && _.isFunction(callback)) {
                callback();
            }
        }
    }

    onPassiveError (error) {
        this.log('fr onPassiveError', error);
        if (this.active) {
            this.setError(error);
        }
    }

    onPassiveEnd () {
        this.log('fr onPassiveEnd');
        if (this.active) {
            if (this.canFinish()) {
                this.setFinished();
            }
        }
    }

    canFinish() {
        let canFinish = !this.finished;
        if (canFinish) {
            if (this.finishCodes && this.finishCodes.length){
                if (!this.responseCode || !_.includes(this.finishCodes, this.responseCode)) {
                    canFinish = false;
                }
            }
        }

        if (!canFinish && this.error){
            canFinish = true;
        }

        // if (!canFinish && this.errorCodes && this.errorCodes.length){
        //     if (_.includes(this.errorCodes, this.responseCode)) {
        //         canFinish = true;
        //     }
        // }

        return canFinish;
    }

    setFinished() {
        if (!this.finished) {
            this.finished = true;
            this.log('Finished');
            this.finalize();
            if (!this.preventFinish){
                this.emit('finish', null, this);
            }
            this.cleanup();
        }
    }

    setActive() {
        if (!this.finished && this.pending) {
            this.log('Setting active');
            if (this.socket) {
                this.addSocketListeners(this.socket);
            }
            if (this.passiveSocket) {
                this.addPassiveSocketListeners(this.passiveSocket);
            }
            if (!this.startTime) {
                this.startTime = new Date().getTime();
            }
            this.active = true;
            this.pending = false;
            this.finished = false;
            this.emit('active', null, this);
        }
    }

    unsetActive() {
        this.log('Unsetting active');
        if (this.active) {
            if (this.socket) {
                this.removeSocketListeners(this.socket);
            }
            if (this.passiveSocket) {
                this.removePassiveSocketListeners(this.passiveSocket);
            }
            this.active = false;
            this.emit('inactive', null, this);
        }
    }

    checkError (response = 'error') {
        if (this.responseCode && !this.error) {
            if (this.errorCodes && this.errorCodes.length){
                if (!this.error && _.includes(this.errorCodes, this.responseCode)) {
                    this.error = true;
                    this.errorMessage = response;
                }
            } else if (this.responseCode >= 500) {
                this.error = true;
                this.errorMessage = response;
            }
        }
    }

    setError(errorMessage, silent = false) {
        if (!this.errorMessage) {
            this.errorMessage = errorMessage + '';
        }
        if (!this.error){
            this.log('Setting error', errorMessage);
            this.error = true;
            this.errorMessage = errorMessage + '';
            this.errorObject = this.getErrorObject();
            if (!silent && !this.errorEmitted) {
                this.errorEmitted = true;
                this.emit('error', errorMessage, this);
            }
            if (this.canFinish()) {
                this.setFinished();
            }
        }
    }

    log() {
        if ((this.forceInactiveLog || this.active) && this.shouldLog()){
            this.logForce.apply(this, Array.prototype.slice.call(arguments));
        }
    }

    doLog() {
        if (this.shouldLog()){
            this.logForce.apply(this, Array.prototype.slice.call(arguments));
        }
    }

    logForce() {
        if (this.forceLogTrace) {
            console.trace.apply(console, Array.prototype.concat([], [this.id, this.command], Array.prototype.slice.call(arguments)));
        } else {
            if (this.client && this.client.log) {
                this.client.log.apply(this.client, Array.prototype.concat([], [this.id, this.command], Array.prototype.slice.call(arguments)));
            } else {
                console.log.apply(console, Array.prototype.concat([], [this.id, this.command], Array.prototype.slice.call(arguments)));
            }
        }
    }

    finalize () {
        this.unsetActive();
        if (this._responseBuffer) {
            let result = false;
            try {
                result = this.parser.parseCommandResponse(this._responseBuffer.toString('binary'));
            } catch (ex) {
                this.log('Error parsing response: ' + ex.message + ', response: "' + this._responseBuffer.toString('binary') + '"');
            }
            if (!_.isNull(result.text)) {
                this.response = result.text;
            }
        }

        if (this._dataBuffer) {
            this.text = this._dataBuffer.toString('binary');
        }

        if (!this.text && this.response) {
            this.text = this.response;
        } else if (!this.response && this.text) {
            this.response = this.text;
        }

        let size = this.size;

        if (this.response && this.text) {
            size = Math.max(this.response.length, this.text.length);
        } else if (this.text) {
            size = this.text.length;
        } else if (this.response) {
            size = this.response.length;
        }
        if (this.size < size) {
            this.size = size;
        }
        if (!this.endTime) {
            this.endTime = new Date().getTime();
        }

        if (this.startTime && this.endTime) {
            this.duration = (this.endTime - this.startTime) / 1000;
        }

        if (this.duration && this.size) {
            this.speed = Math.round(this.size / this.duration);
        } else {
            this.speed = 0;
        }
        this.pending = false;

        this.doLog('Finalized', {
            size: this.size,
            duration: +this.duration.toFixed(3),
            speed: this.speed,
        });
    }

    getErrorObject() {
        let code = 0;
        let message = '';
        let result;
        if (this._responseBuffer){
            result = this.parser.parseCommandResponse(this._responseBuffer.toString('binary'));
        }
        if (result) {
            if (result.responseCode) {
                code = result.responseCode;
            }
            if (result.response) {
                message = result.response;
            } else if (result.text) {
                message = result.text;
            }
        }

        if (!message) {
            message = 'Request error';
        }
        let error = new Error(message);
        error.code = code;
        error.originalStack = error.stack;
        let stackLines = error.stack.split('\n');
        let firstLine = _.head(stackLines);
        let takeLines = 3;
        if (takeLines >= stackLines.length) {
            takeLines = stackLines.length - 1;
        }
        error.stack = _.concat([firstLine], _.drop(stackLines, takeLines)).join('\n');
        return error;
    }
}

module.exports = FtpRequest;