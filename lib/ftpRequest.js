const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;

class FtpRequest extends EventEmitter {
    constructor (command = '', encoding = null, active = false, pending = true, finished = false, responseCode = null, response = null, text = null, error = false, errorMessage = '') {
        super();

        this.id = _.uniqueId('CMD_');
        this.command = command;
        this.encoding = encoding;
        this.active = active;
        this.pending = pending;
        this.finished = finished;
        this.responseCode = responseCode;
        this.response = response;
        this.size = 0;
        this.startTime = null;
        this.endTime = null;
        this.text = text;
        this.error = error;
        this.errorMessage = errorMessage;
        this._responseBuffer = null;
        this._dataBuffer = null;
        this.input = null;
        this.duration = null;
        this.speed = null;

        this.isPassive = false;
        this.isUpload = false;

        this.socket = null;
        this.passiveSocket = null;
        this.client = null;

        this.preventFinish = false;

        this.baseCommand = _.head(_.trimStart(this.command).split(' '));

        this.boundMethods = {
            onError: this.onError.bind(this),
            onData: this.onData.bind(this),
            onPassiveData: this.onPassiveData.bind(this),
            onPassiveEnd: this.onPassiveEnd.bind(this),
        };
    }

    cleanup () {
        if (this.socket && this.socket.removeListener && _.isFunction(this.socket.removeListener)) {
            this.socket.removeListener('data', this.boundMethods.onData);
            this.socket.removeListener('error', this.boundMethods.onError);
        }
        if (this.passiveSocket && this.passiveSocket.removeListener && _.isFunction(this.passiveSocket.removeListener)) {
            this.passiveSocket.removeListener('data', this.boundMethods.onPassiveData);
            this.passiveSocket.removeListener('end', this.boundMethods.onPassiveEnd);
            this.passiveSocket.removeListener('error', this.boundMethods.onError);
        }
        this.socket = null;
        this.passiveSocket = null;
        if (this.client) {
            this.client = null;
        }
    }

    setClient (client) {
        this.client = client;
    }

    setSocket (socket) {
        this.socket = socket;
        this.socket.on('data', this.boundMethods.onData);
        this.socket.on('error', this.boundMethods.onError);
    }

    setPassiveSocket (socket) {
        this.passiveSocket = socket;
        this.passiveSocket.on('data', this.boundMethods.onPassiveData);
        this.passiveSocket.on('end', this.boundMethods.onPassiveEnd);
        this.passiveSocket.on('error', this.boundMethods.onError);
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
        // console.log('fr ondata', chunk, encoding);
        this._responseBuffer = this.appendBuffer(this._responseBuffer, chunk);
        if (callback && _.isFunction(callback)) {
            callback();
        }
    }

    onPassiveData (chunk, encoding, callback) {
        // console.log('fr onpassivedata', chunk.length, encoding);
        this._dataBuffer = this.appendBuffer(this._dataBuffer, chunk);
        if (callback && _.isFunction(callback)) {
            callback();
        }
    }

    onPassiveEnd () {
        // console.log('fr onpassiveEnd');
    }

    onError (error) {
        this.setError(error + '');
    }

    setFinished(finished = true) {
        this.finished = finished;
        if (finished) {
            this.cleanup();
            if (this.response && this.text) {
                this.size = Math.max(this.response.length, this.text.length);
            } else if (this.text) {
                this.size = this.text.length;
            } else if (this.response) {
                this.size = this.response.length;
            }
            if (!this.endTime) {
                this.endTime = new Date().getTime() / 1000;
            }
            if (this.startTime && this.endTime && this.size) {
                this.speed = this.size / (this.endTime - this.startTime);
            } else {
                this.speed = 0;
            }
            this.pending = false;
            this.unsetActive();
            // console.log('finished', this.command);
            if (!this.preventFinish){
                this.emit('finish', null, this);
            }
        }
    }

    setActive() {
        if (!this.finished && this.pending) {
            if (!this.startTime) {
                this.startTime = new Date().getTime() / 1000;
            }
            this.active = true;
            this.pending = false;
            this.finished = false;
            // console.log('active', this.command);
            this.emit('active', null, this);
        }
    }

    unsetActive() {
        this.active = false;
        // console.log('inactive', this.command);
        this.emit('inactive', null, this);
    }

    setError(errorMessage) {
        this.error = true;
        this.errorMessage = errorMessage + '';
        this.emit('error', errorMessage, this);
        this.setFinished(true);
    }

    writeData(chunk) {
        this._dataBuffer += chunk.toString('binary');
    }
}

module.exports = FtpRequest;