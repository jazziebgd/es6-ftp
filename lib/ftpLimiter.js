const Transform = require('stream').Transform

class FtpLimiter extends Transform {

    constructor (options) {
        super(options);

        this.limiting = false;
        this.rate = 0;
        this.timeout = null;
        this.duration = 200;
        this.realRate = 0;
        this.completed = false;

        this.on('end', this.onEnd.bind(this));
        this.on('finish', this.onFinish.bind(this));
        this.on('drain', this.onDrain.bind(this));
        this.on('close', this.onClose.bind(this));
        this.on('error', this.onError.bind(this));
        this.on('pipe', this.onPipe.bind(this));
    }

    onEnd() {
        console.log('onEnd', this, Array.prototype.slice(arguments));
        this.complete();
    }

    onClose() {
        console.log('onClose', Array.prototype.slice(arguments));
    }

    onDrain() {
        this.resume();
        console.log('onDrain', Array.prototype.slice(arguments));
    }

    onError(err) {
        console.error(err);
    }

    onPipe() {
        console.log('onPipe', Array.prototype.slice(arguments));
    }

    onFinish() {
        console.log('onFinish', Array.prototype.slice(arguments));
        this.complete();
    }

    complete () {
        clearTimeout(this.timeout);
        if (!this.completed) {
            this.completed = true;
            this.removeAllListeners();
        }
    }

    setLimiting(limiting) {
        this.limiting = limiting;
    }

    setRate(rate = 0) {
        this.rate = rate;
        this.realRate = parseInt(this.rate / (1000 / this.duration), 10);
    }

    _transform (chunk, encoding, callback) {
        console.log('progress', chunk.length);
        if (!this.limiting) {
            callback(null, chunk);
        } else {
            this.process(chunk, encoding, callback);
        }
    }

    _flush (done) {
        done();
    }

    process (chunk, encoding, callback) {
        clearTimeout(this.timeout);
        let size = chunk.length;
        if (size > this.realRate) {
            let slice = chunk.slice(0, this.realRate);
            if (!slice.length) {
                callback(null, slice);
            } else {
                let rest = chunk.slice(this.realRate);
                this.push(slice);
                this.timeout = setTimeout( () => {
                    this.process(rest, encoding, callback);
                }, this.duration);
            }
        } else {
            this.push(chunk);
            callback();
        }
    }
};

module.exports = FtpLimiter;