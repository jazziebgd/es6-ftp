/**
 * @fileOverview FtpLimiter class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');
const Transform = require('stream').Transform;

/**
 * Class FtpLimiter
 *
 * Class implementation for limiting transfer speeds
 *
 * @extends {Transform}
 */
class FtpLimiter extends Transform {

    /**
     * Constructor method
     *
     * @param  {Object} options Stream.Transform options object
     *
     * @return {undefined}
     */
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
            onProgress: this.onProgress.bind(this),
        };

        this.addEventListeners();
    }

    /**
     * Adds event listeners for limiter instance
     *
     * @return {undefined}
     */
    addEventListeners () {
        this.on('end', this.boundMethods.onEnd);
        this.on('finish', this.boundMethods.onFinish);
        this.on('drain', this.boundMethods.onDrain);
        this.on('close', this.boundMethods.onClose);
        this.on('error', this.boundMethods.onError);
        this.on('pipe', this.boundMethods.onPipe);
        // this.on('progress', this.boundMethods.onProgress);
    }

    /**
     * Removes event listeners for limiter instance
     *
     * @return {undefined}
     */
    removeEventListeners () {
        this.removeListener('end', this.boundMethods.onEnd);
        this.removeListener('finish', this.boundMethods.onFinish);
        this.removeListener('drain', this.boundMethods.onDrain);
        this.removeListener('close', this.boundMethods.onClose);
        this.removeListener('error', this.boundMethods.onError);
        this.removeListener('pipe', this.boundMethods.onPipe);
        // this.removeListener('progress', this.boundMethods.onProgress);
        this.removeAllListeners('progress');
    }

    /**
     * Event handler for 'end' event
     *
     * @return {undefined}
     */
    onEnd() {
        this.log('LIMITER:onEnd');
        this.complete();
    }

    /**
     * Event handler for 'close' event
     *
     * @return {undefined}
     */
    onClose() {
        this.log('LIMITER:onClose');
    }

    /**
     * Event handler for 'drain' event
     *
     * @return {undefined}
     */
    onDrain() {
        this.log('LIMITER:onDrain');
        this.resume();
    }

    /**
     * Event handler for 'error' event
     *
     * @param  {Error|Exception} err Error that triggered the event
     *
     * @return {undefined}
     */
    onError(err) {
        console.error(err);
    }

    /**
     * Event handler for 'progress' event
     *
     * @param {Number} transferred Bytes transferred
     *
     * @return {undefined}
     */
    onProgress() {
        this.log('LIMITER:onProgress ' + this.transferred);
    }

    /**
     * Event handler for 'pipe' event
     *
     * @return {undefined}
     */
    onPipe() {
        // this.log('LIMITER:onPipe');
    }

    /**
     * Event handler for 'finish' event
     *
     * @return {undefined}
     */
    onFinish() {
        this.log('LIMITER:onFinish ' + this.transferred);
        this.complete();
    }

    /**
     * Emits 'progress' event on this object and its ftpRequest
     *
     * @param  {Number}  chunkSize Newest received (or sent) chunk size
     * @param  {Boolean} isFinal   Flag to indicate whether chunk is final in limiting process
     *
     * @return {undefined}
     */
    emitProgress (chunkSize, isFinal = false) {
        this.emit('progress', this.transferred, chunkSize, this, isFinal);
        if (this.ftpRequest) {
            this.ftpRequest.emit('progress', this.transferred, chunkSize, this, isFinal);
        }
    }

    /**
     * Method that completes current transfer
     *
     * @return {undefined}
     */
    complete () {
        clearTimeout(this.timeout);
        if (!this.completed) {
            this.log('LIMITER:complete');
            this.completed = true;
            this.removeEventListeners();
            if (this.ftpRequest && this.isUpload && this.transferred) {
                this.ftpRequest.size = this.transferred;
            }
            // if (this.ftpRequest && !this.isUpload) {
            //     this.ftpRequest.setFinished();
            // }
        }
    }

    /**
     * Sets limiting flag based on parameter
     *
     * @param {Boolean} limiting Limiting flag
     *
     * @return {undefined}
     */
    setLimiting(limiting) {
        this.log('LIMITER turning limiting ' + limiting ? 'on' : 'off');
        this.limiting = limiting;
        if (this.ftpRequest) {
            this.ftpRequest.setSpeedLimited(this.limiting);
        }
    }

    /**
     * Sets ftpRequest for this limiter instance
     *
     * @param {FtpRequest} ftpRequest Ftp request object
     *
     * @return {undefined}
     */
    setFtpRequest(ftpRequest) {
        this.log('LIMITER setting ftpRequest ' + ftpRequest.id);
        this.ftpRequest = ftpRequest;
        if (this.ftpRequest) {
            if (!_.isUndefined(this.ftpRequest.isUpload)){
                this.isUpload = this.ftpRequest.isUpload;
            }
            this.ftpRequest.setSpeedLimited(this.limiting);
        }
    }

    /**
     * Sets limiting rate for this limiter
     *
     * @param {Number} rate Limiting rate (bytes / second)
     *
     * @return {undefined}
     */
    setRate(rate = 0) {
        if (!rate) {
            rate = 100 * 1024 * 1024;
        }
        this.log('LIMITER setting rate to ' + rate);
        this.rate = rate;
        this.realRate = parseInt(this.rate / (1000 / this.duration), 10);
    }

    /**
     * _transform method implementation
     *
     * @param  {Buffer}   chunk    Data chunk buffer
     * @param  {String}   encoding Data chunk encoding
     * @param  {Function} callback Callback method
     *
     * @return {undefined}
     */
    _transform (chunk, encoding, callback) {
        clearTimeout(this.timeout);
        let size = chunk.length;
        if (!this.limiting) {
            this.transferred += size;
            this.emitProgress(size);
            this.log('LIMITER, limiting off, size: ' + chunk.length + ', total: ' + this.transferred);
            callback(null, chunk);
        } else {

            if (size <= this.realRate) {
                this.transferred += size;
                this.log('LIMITER, limiting on but unnecessary, size: ' + size + ', rate: ' + this.realRate + ', total: ' + this.transferred);
                this.emitProgress(size);
                callback(null, chunk);
            } else {
                this.process(chunk, encoding, callback);
            }
        }
    }

    /**
     * _flush method implementation
     *
     * @param  {Function} done Callback function
     *
     * @return {undefined}
     */
    _flush (done) {
        this.log('LIMITER:flush');
        done();
    }

    /**
     * Process method implementation that limits transfer speed. Emits 'progress' event unless limiting and chunk is smaller than realRate
     *
     * @param  {Buffer}   chunk    Data chunk buffer
     * @param  {String}   encoding Data chunk encoding
     * @param  {Function} callback Callback method
     *
     * @return {undefined}
     */
    process (chunk, encoding, callback) {
        clearTimeout(this.timeout);
        if (this.ftpRequest.client && this.ftpRequest.client.aborting) {
            callback();
        } else {
            if (this.limiting) {
                let size = chunk.length;
                if (size > this.realRate) {
                    let slice = chunk.slice(0, this.realRate);
                    this.log('LIMITER, limiting on, chunk size: ' + size + ', slice size: ' + slice.length + ', rate: ' + this.realRate + ', total: ' + (this.transferred + slice.length));
                    if (!slice.length) {
                        this.emitProgress(slice.length);
                        callback(null, slice);
                    } else {
                        this.transferred += slice.length;
                        let rest = chunk.slice(this.realRate);
                        this.push(slice);
                        this.emitProgress(slice.length);
                        this.timeout = setTimeout( () => {
                            this.process(rest, encoding, callback);
                        }, this.duration);
                    }
                } else {
                    this.transferred += chunk.length;
                    this.log('LIMITER, limiting on but chunk smaller than rate, chunk size: ' + size + ', rate: ' + this.realRate + ', total: ' + this.transferred);
                    this.push(chunk);
                    this.emitProgress(chunk.length, true);
                    callback();
                }
            } else {
                this.transferred += chunk.length;
                this.emitProgress(chunk.length);
                // this.log('LIMITER, limiting off, size: ' + chunk.length + ', total: ' + this.transferred);
                callback(null, chunk);
            }
        }
    }

    /**
     * Logs message using ftpRequest logging system
     *
     * @param  {String} message Message to log
     *
     * @return {undefined}
     */
    log (message) {
        if (this.ftpRequest) {
            this.ftpRequest.log(message);
        }
    }
}

module.exports = FtpLimiter;