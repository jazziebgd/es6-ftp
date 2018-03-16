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
        this.text = text;
        this.error = false;
        this.errorMessage = errorMessage;
        this._buffer = null;

        this.onSuccess = null;
        this.onError = null;
        this.onComplete = null;

        this.baseCommand = _.head(_.trimStart(this.command).split(' '));
    }

    setFinished(finished = true) {
        this.finished = finished;
        if (finished) {
            this.size = Math.max(this.response.length, this.text.length);
            this.pending = false;
            this.active = false;
            this.emit('finish');
        }
    }

    setActive() {
        if (!this.finished && this.pending) {
            this.active = true;
            this.pending = false;
            this.finished = false;
            this.emit('active');
        }
    }

    unsetActive() {
        this.active = false;
        this.emit('inactive');
    }

    setError(errorMessage) {
        this.error = true;
        this.errorMessage = errorMessage + '';
        this.active = false;
        this.pending = false;
        this.finished = false;
        this.emit('error', errorMessage);
    }

    writeData(chunk) {
        this._buffer += chunk.toString('binary');
    }
};

module.exports = FtpRequest;