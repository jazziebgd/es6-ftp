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
        this._buffer = null;
        this.duration = null;
        this.speed = null;

        this.baseCommand = _.head(_.trimStart(this.command).split(' '));
    }

    setFinished(finished = true) {
        this.finished = finished;
        if (finished) {
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
            }
            this.pending = false;
            this.active = false;
            this.emit('finish');
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
        this.emit('error', errorMessage);
        this.setFinished(true);
    }

    writeData(chunk) {
        this._buffer += chunk.toString('binary');
    }
}

module.exports = FtpRequest;