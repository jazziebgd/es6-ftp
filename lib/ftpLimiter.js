/**
 * @fileOverview FtpLimiter class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');
const Transform = require('stream').Transform;

class FtpLimiter extends Transform {

    constructor (options) {
        super(options);

        this.limiting = false;
        this.rate = 0;
        this.timeout = null;
        this.duration = 100;
        this.realRate = 0;
        this.completed = false;
        this.isWritable = false;
        this.transferred = 0;
        this.isUpload = false;
        this.ftpRequest = '';

        this.boundMethods = {
            onEnd: this.onEnd.bind(this),
            onFinish: this.onFinish.bind(this),
            onClose: this.onClose.bind(this),
            onDrain: this.onDrain.bind(this),
            onError: this.onError.bind(this),
            onPipe: this.onPipe.bind(this),
        };

        this.addEventListeners();
    }

    addEventListeners () {
        this.on('end', this.boundMethods.onEnd);
        this.on('finish', this.boundMethods.onFinish);
        this.on('drain', this.boundMethods.onDrain);
        this.on('close', this.boundMethods.onClose);
        this.on('error', this.boundMethods.onError);
        this.on('pipe', this.boundMethods.onPipe);
    }

    removeEventListeners () {
        this.removeListener('end', this.boundMethods.onEnd);
        this.removeListener('finish', this.boundMethods.onFinish);
        this.removeListener('drain', this.boundMethods.onDrain);
        this.removeListener('close', this.boundMethods.onClose);
        this.removeListener('error', this.boundMethods.onError);
        this.removeListener('pipe', this.boundMethods.onPipe);
        this.removeAllListeners('progress');
    }

    onEnd() {
        // console.log('onEnd', this.ftpRequest.id + ' ' + this.ftpRequest.command, Array.prototype.slice(arguments));
        this.complete();
    }

    onClose() {
        // console.log('onClose', this.ftpRequest.id + ' ' + this.ftpRequest.command, Array.prototype.slice(arguments));
    }

    onDrain() {
        this.resume();
        // console.log('onDrain', Array.prototype.slice(arguments));
    }

    onError(err) {
        console.error(err);
    }

    onPipe() {
        // console.log('onPipe', Array.prototype.slice(arguments));
    }

    onFinish() {
        // console.log('onFinish', this.ftpRequest.id + ' ' + this.ftpRequest.command, Array.prototype.slice(arguments));
        this.complete();
    }

    complete () {
        clearTimeout(this.timeout);
        if (!this.completed) {
            this.completed = true;
            this.removeEventListeners();
            if (this.ftpRequest && !this.isUpload) {
                this.ftpRequest.setFinished(true);
            }
        }
    }

    setLimiting(limiting) {
        this.limiting = limiting;
    }

    setFtpRequest(ftpRequest) {
        this.ftpRequest = ftpRequest;
        if (this.ftpRequest && !_.isUndefined(this.ftpRequest.isUpload)){
            this.isUpload = this.ftpRequest.isUpload;
        }
    }

    setRate(rate = 0) {
        if (!rate) {
            rate = 100 * 1024 * 1024;
        }
        this.rate = rate;
        this.realRate = parseInt(this.rate / (1000 / this.duration), 10);
    }

    _transform (chunk, encoding, callback) {
        return this.process(chunk, encoding, callback);
    }

    // _flush (done) {
    //     console.warn('flush', this.ftpRequest.id + ' ' + this.ftpRequest.command, done);
    //     done();
    // }

    process (chunk, encoding, callback) {
        clearTimeout(this.timeout);
        if (!this.limiting) {
            this.transferred += chunk.length;
            this.emit('progress', this.transferred);
            callback(null, chunk);
        } else {
            let size = chunk.length;
            if (size > this.realRate) {
                let slice = chunk.slice(0, this.realRate);
                if (!slice.length) {
                    callback(null, slice);
                } else {
                    this.transferred += slice.length;
                    this.emit('progress', this.transferred);
                    let rest = chunk.slice(this.realRate);
                    this.push(slice);
                    this.timeout = setTimeout( () => {
                        this.process(rest, encoding, callback);
                    }, this.duration);
                }
            } else {
                this.transferred += chunk.length;
                this.emit('progress', this.transferred);
                this.push(chunk);
                callback();
            }
        }
    }
}

module.exports = FtpLimiter;