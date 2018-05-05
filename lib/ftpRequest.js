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

        this.logMessages = [];

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

        this.lastProgressTimestamp = 0;
        this.lastProgressEntry = null;
        this.progressHistory = [];

        this.inputSize = null;
        this.percent = null;

        this.queued = false;
        this.isPassive = false;
        this.isUpload = false;
        this.isSpeedLimited = false;

        this.socketFinished = false;
        this.passiveSocketFinished = false;

        this.dataStarted = false;
        this.historyStarted = false;
        this.historyDone = false;

        this.socket = null;
        this.passiveSocket = null;
        this.client = null;
        this.parser = null;
        this.source = null;

        this.preventFinish = false;

        this.baseCommand = _.head(_.trimStart(this.command).split(' '));
        this.params = _.tail(_.trimStart(this.command).split(' '));

        this.boundMethods = {
            onError: this.onError.bind(this),
            onData: this.onData.bind(this),
            onEnd: this.onEnd.bind(this),
            onProgress: this.onProgress.bind(this),
            onSocketFinish: this.onSocketFinish.bind(this),
            onPassivePause: this.onPassivePause.bind(this),
            onPassiveData: this.onPassiveData.bind(this),
            onPassiveEnd: this.onPassiveEnd.bind(this),
            onPassiveError: this.onPassiveError.bind(this),
            addStatisticEntry: this.addStatisticEntry.bind(this),
        };

        this.intervals = {
            statistics: null
        };

        this.addEventListeners();
        this.log('Created request ' + this.id + ' for command "' + this.command + '"');
    }

    /**
     * Adds event listeners for this request
     *
     * @return {undefined}
     */
    addEventListeners(){
        this.on('progress', this.boundMethods.onProgress);
    }

    /**
     * Removes event listeners for this request
     *
     * @return {undefined}
     */
    removeEventListeners(){
        this.removeListener('progress', this.boundMethods.onProgress);
    }

    /**
     * Checks whether this instance should log
     *
     * @return {Boolean}    True if should log, false otherwise
     */
    shouldLog() {
        return this.forceLog;
    }

    /**
     * Performs cleanup upon request finish
     *
     * @return {undefined}
     */
    cleanup () {
        this.log('Cleaning up');
        clearInterval(this.intervals.statistics);
        this.removeEventListeners();
        this.removeListener('socket:finish', this.boundMethods.onSocketFinish);
        if (this.socket) {
            this.removeSocketListeners(this.socket);
            this.socket = null;
        }
        if (this.passiveSocket) {
            this.removePassiveSocketListeners(this.passiveSocket);
            this.passiveSocket = null;
        }
        // if (this.socket && this.socket.removeListener && _.isFunction(this.socket.removeListener)) {
        //     this.removeSocketListeners(this.socket);
        // }
        // this.socket = null;
        // if (this.passiveSocket && this.passiveSocket.removeListener && _.isFunction(this.passiveSocket.removeListener)) {
        //     this.removePassiveSocketListeners(this.passiveSocket);
        // }
        // this.passiveSocket = null;
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

    /**
     * Sets speed limiting flag
     *
     * @param {Boolean} speedLimited Speed limiting flag
     *
     * @return {undefined}
     */
    setSpeedLimited (speedLimited) {
        this.isSpeedLimited = speedLimited;
    }

    /**
     * Sets client object
     *
     * @param {FtpClient} client Client object
     *
     * @return {undefined}
     */
    setClient (client) {
        this.client = client;
    }

    /**
     * Sets parser object
     *
     * @param {FtpResponseParser} parser Parser object
     *
     * @return {undefined}
     */
    setParser (parser) {
        this.parser = parser;
    }

    /**
     * Sets source object
     *
     * @param {Mixed} source Source object
     *
     * @return {undefined}
     */
    setSource (source) {
        this.source = source;
    }

    /**
     * Sets socket
     *
     * @param {Socket|TLSSocket} socket Socket for this request
     *
     * @return {undefined}
     */
    setSocket (socket) {
        this.log('Setting socket');
        this.socket = socket;
    }

    /**
     * Sets transferred bytes for this request
     *
     * @param {Number} transferred Number of transferred bytes
     *
     * @return {undefined}
     */
    setTransferred (transferred) {
        if (!this.transferred && transferred) {
            this.dataStarted = true;
        }
        this.transferred = transferred;
    }

    /**
     * Adds socket listeners for this request
     *
     * @param {Socket|TLSSocket} socket Socket to add listeners to
     *
     * @return {undefined}
     */
    addSocketListeners(socket) {
        socket.on('data', this.boundMethods.onData);
        socket.on('end', this.boundMethods.onEnd);
        socket.on('error', this.boundMethods.onError);
    }

    /**
     * Removes socket listeners for this request
     *
     * @param {Socket|TLSSocket} socket Socket to remove listeners from
     *
     * @return {undefined}
     */
    removeSocketListeners(socket) {
        socket.removeListener('data', this.boundMethods.onData);
        socket.removeListener('end', this.boundMethods.onEnd);
        socket.removeListener('error', this.boundMethods.onError);
    }

    /**
     * Sets passive socket for this request
     *
     * @param {Socket|TLSSocket} socket Passive socket
     *
     * @return {undefined}
     */
    setPassiveSocket (socket) {
        this.log('Setting passive socket');
        this.passiveSocket = socket;
    }

    /**
     * Adds passive socket listeners for this request
     *
     * @param {Socket|TLSSocket} socket Passive socket to add listeners to
     *
     * @return {undefined}
     */
    addPassiveSocketListeners (socket) {
        socket.on('pause', this.boundMethods.onPassivePause);
        socket.on('data', this.boundMethods.onPassiveData);
        socket.on('end', this.boundMethods.onPassiveEnd);
        socket.on('error', this.boundMethods.onPassiveError);
    }

    /**
     * Removes passive socket listeners for this request
     *
     * @param {Socket|TLSSocket} socket Passive socket to remove listeners from
     *
     * @return {undefined}
     */
    removePassiveSocketListeners (socket) {
        socket.removeListener('pause', this.boundMethods.onPassivePause);
        socket.removeListener('data', this.boundMethods.onPassiveData);
        socket.removeListener('end', this.boundMethods.onPassiveEnd);
        socket.removeListener('error', this.boundMethods.onPassiveError);
    }

    /**
     * Sets socket finished flag
     *
     * @return {undefined}
     */
    setSocketFinished () {
        this.socketFinished = true;
        this.emit('socket:finish');
    }

    /**
     * Sets passive socket finished flag
     *
     * @return {undefined}
     */
    setPassiveSocketFinished () {
        this.passiveSocketFinished = true;
        this.emit('socket:finish');
    }

    /**
     * Appends source buffer to destination
     *
     * @param  {Buffer} destination Destination buffer
     * @param  {Buffer} source      Source buffer
     *
     * @return {Buffer}             Destination buffer with source data added
     */
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

    /**
     * Adds statistic entry for this request
     *
     * @return {undefined}
     */
    addStatisticEntry() {

        let entryData = this.lastProgressEntry;
        let client = this.client;

        if (!(entryData && client)){
            return;
        }
        let lastEntry;
        let timestamp = entryData.timestamp;
        let lastTimestamp = this.lastProgressTimestamp;
        if (!lastTimestamp) {
            lastTimestamp = this.startTime;
        }
        let timeDiff = timestamp - lastTimestamp;
        let lastTransferred = entryData.transferred;
        if (this.progressHistory.length > 0) {
            lastEntry = _.last(this.progressHistory);
            lastTimestamp = lastEntry.timestamp;
            lastTransferred = lastEntry.transferred;
            timeDiff = timestamp - lastTimestamp;
        }
        let transferredDiff = entryData.transferred - lastTransferred;
        let speed = (transferredDiff / timeDiff) * 1000;

        if (!entryData.isFinal && !this.historyStarted) {
            let additionalZeroData = {
                command: this.id + ' ' + this.client.sanitizeCommand(this.command),
                isUpload: this.isUpload,
                chunkSize: entryData.chunkSize,
                duration: entryData.duration,
                transferred: entryData.transferred,
                isEnd: false,
                isFirst: true
            };
            this.client.addZeroHistoryEntry(this, additionalZeroData, new Date(this.startTime));
        }
        this.progressHistory.push(entryData);
        let additionalData = {
            command: this.id + ' ' + this.client.sanitizeCommand(this.command),
            isUpload: this.isUpload,
            chunkSize: entryData.chunkSize,
            duration: entryData.duration,
            transferred: entryData.transferred,
            isEnd: entryData.isFinal,
            isFirst: false
        };
        this.client.addHistoryEntry(this, speed, new Date(timestamp), additionalData);
        if (entryData.isFinal && this.isUpload){
            let additionalZeroData = {
                command: this.id + ' ' + this.client.sanitizeCommand(this.command),
                isUpload: this.isUpload,
                chunkSize: entryData.chunkSize,
                duration: entryData.duration,
                transferred: entryData.transferred,
                isEnd: false,
                isFirst: true
            };
            this.client.addZeroHistoryEntry(this, additionalZeroData, new Date(timestamp + 1));
        }
        this.lastProgressTimestamp = entryData.timestamp;
    }

    /**
     * Handler for 'progress' event (triggered from ftpLimiter)
     *
     * @param  {Number}     transferred     Number of total transferred bytes
     * @param  {Number}     chunkSize       Size of latest chunk
     * @param  {FtpLimiter} limiterObject   Limiter object for this request
     * @param  {Boolean}    isFinal         Flag to indicate whether chunk is final in limiting process
     *
     * @return {undefined}
     */
    onProgress (transferred, chunkSize, limiterObject, isFinal) {
        this.setTransferred(transferred);
        this.client.updateDataStats(transferred, chunkSize);
        this.calculateStatistics(transferred, chunkSize, isFinal);
        this.log('Progress - ' + this.percent + ', chunk size: ' + chunkSize + ', total transferred: ' + transferred + ', final: ' + isFinal);
    }

    /**
     * Handler for 'data' event
     *
     * @param  {Buffer}   chunk    Latest data chunk
     * @param  {String}   encoding Encoding for chunk
     * @param  {Function} callback Callback function
     *
     * @return {undefined}
     */
    onData (chunk, encoding, callback) {
        let canEnd = false;
        this.log('Received ' + chunk.length + 'B of data: ', chunk.toString('binary'), encoding);
        if (this.active) {
            this._responseBuffer = this.appendBuffer(this._responseBuffer, chunk);

            let result = false;

            try {
                result = this.parser.parseCommandResponse(this._responseBuffer.toString('binary'));
            } catch (ex) {
                this.log('Error parsing response: ' + ex.message + ', response: "' + chunk.toString('binary') + '"');
            }

            if (_.isNull(this.inputSize) && this.isPassive && !this.isUpload) {
                let response = this._responseBuffer.toString('binary');
                let size;
                if (response && response.match) {
                    size = response.match(/[^\d]([\d.]+)\s?(k|m|g)?(b|byte|bytes)/i);
                    if (size && size.length >= 3 && size[1] && !isNaN(+size[1]) && +size[1]) {
                        let unit = '';
                        let multiplier = 1;
                        if (size[2] && size[2].toLowerCase) {
                            unit = size[2].toLowerCase();
                            if (unit == 'k') {
                                multiplier = 1024;
                            } else if (unit == 'm') {
                                multiplier = 1024 * 1024;
                            } else if (unit == 'g') {
                                multiplier = 1024 * 1024 * 1024;
                            }
                        }
                        this.inputSize = +size[1] * multiplier;
                        this.log('Detected input size: ' + this.inputSize + 'b');
                    }
                } else {
                    console.warn('no response no match');
                }
            }

            if (result && result.responseCode && !_.isNull(result.responseCode)) {
                if (this.responseCode != result.responseCode){
                    if (!_.isNull(this.responseCode) && this.responseCode){
                        this.previousCodes.push(this.responseCode);
                    }
                    this.responseCode = result.responseCode;
                }
                if (this.responseCode && this.finishCodes && this.finishCodes.length && _.includes(this.finishCodes, this.responseCode)){
                    canEnd = true;
                } else if (this.responseCode && !this.error) {
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

            this.emit('data', this, this._responseBuffer.toString('binary'));

            if (callback && _.isFunction(callback)) {
                callback();
            }
            if (canEnd) {
                this.onEnd();
            }
        }
    }

    onError (error) {
        this.log('Socket error', error);
        if (this.active) {
            this.setError(error);
        }
    }

    onEnd () {
        this.log('Socket ended');
        this.setSocketFinished();
        if (this.active) {
            if (this.canFinish()) {
                this.setFinished();
            }
        }
    }

    onSocketFinish () {
        this.log('Socket finished: s:' + this.socketFinished + ', p:' + this.passiveSocketFinished);
    }

    onPassivePause () {
        this.log('Passive socket paused');
        if (this.active) {
            this.passiveSocket.resume();
        }
    }

    onPassiveData (chunk, encoding, callback) {
        if (!this.isSpeedLimited){
            this.log('Received ' + chunk.length + 'B of passive data (total: ' + this.transferred + ')', encoding, callback);
        }
        if (this.active) {
            this._dataBuffer = this.appendBuffer(this._dataBuffer, chunk);
            if (callback && _.isFunction(callback)) {
                callback();
            }
        }
    }

    onPassiveError (error) {
        this.log('Passive socket error', error);
        if (this.active) {
            this.setError(error);
        }
    }

    onPassiveEnd () {
        this.log('Passive socket ended');
        this.setPassiveSocketFinished();
        if (this.active) {
            if (this.canFinish()) {
                this.setFinished();
            }
        }
    }

    canFinish() {
        let canFinish = this.socketFinished && this.passiveSocketFinished;
        this.log('fin: ' + this.finished + ', sock: ' + this.socketFinished + ' pass: ' + this.passiveSocketFinished);









        canFinish = true;











        if (canFinish) {
            canFinish = !this.finished;
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
            this.on('socket:finish', this.boundMethods.onSocketFinish);
            if (!this.isPassive) {
                this.setPassiveSocketFinished();
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
            // this.removeListener('socket:finish', this.boundMethods.onSocketFinish);
            // if (this.socket) {
            //     if (this.command != 'RETR /zero.txta') {
            //         this.removeSocketListeners(this.socket);
            //     }
            // }
            // if (this.passiveSocket) {
            //     if (this.command != 'RETR /zero.txta') {
            //         this.removePassiveSocketListeners(this.passiveSocket);
            //     }
            // }
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

    calculateStatistics(transferred, chunkSize, isFinal){
        if (this.client.options.calculateStatistics) {
            let timestamp = Date.now();
            let previousTime;
            let lastEntry;
            if (this.lastProgressTimestamp) {
                previousTime = this.lastProgressTimestamp;
            } else if (this.progressHistory.length){
                lastEntry = _.last(this.progressHistory);
                previousTime = lastEntry.timestamp;
            } else if (this.startTime) {
                previousTime = this.startTime;
            }
            if (this.inputSize) {
                this.percent = Math.floor((transferred / this.inputSize) * 100);
                if (isNaN(this.percent)) {
                    this.percent = null;
                } else if (this.percent > 100) {
                    this.percent = 100;
                }
            }
            this.client.updateActiveRequestStatistics(this);
            let progressEntry = null;
            let duration = timestamp - previousTime;
            if (duration){
                let speed = chunkSize / duration;
                progressEntry = {
                    duration,
                    speed,
                    timestamp,
                    chunkSize,
                    transferred,
                    isFinal
                };
            }
            if (!this.lastProgressEntry) {
                this.lastProgressEntry = progressEntry;
                clearInterval(this.intervals.statistics);
                this.intervals.statistics = setInterval(this.boundMethods.addStatisticEntry, this.client.options.statisticsInterval);
            }
            this.lastProgressEntry = progressEntry;
        }
    }

    log() {
        if ((this.forceInactiveLog || this.active) && this.shouldLog()){
            this.logForce.apply(this, Array.prototype.slice.call(arguments));
        } else {
            this.addLogMessage(Array.prototype.slice.call(arguments));
        }
    }

    doLog() {
        if (this.shouldLog()){
            this.logForce.apply(this, Array.prototype.slice.call(arguments));
        } else {
            this.addLogMessage(Array.prototype.slice.call(arguments));
        }
    }

    logForce() {
        let command = this.command;
        if (this.client) {
            command = this.client.sanitizeCommand(command);
        }
        if (this.forceLogTrace) {
            console.trace.apply(console, Array.prototype.concat([], [this.id, command], Array.prototype.slice.call(arguments)));
        } else {
            if (this.client && this.client.log) {
                this.client.log.apply(this.client, Array.prototype.concat([], [this.id, command], Array.prototype.slice.call(arguments)));
            } else {
                console.log.apply(console, Array.prototype.concat([], [this.id, command], Array.prototype.slice.call(arguments)));
                if (this.client) {
                    this.client.emit('log', Array.prototype.concat([], [this.id, command], Array.prototype.slice.call(messages)), this);
                }
            }
        }
        this.addLogMessage(Array.prototype.slice.call(arguments));
    }

    addLogMessage () {
        let messages = Array.prototype.slice.call(arguments);
        this.logMessages.push({
            messages: messages,
            time: new Date()
        });
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
            if (!this.isPassive) {
                this.text = this.response;
            } else {
                this.text = '';
            }
        } else if (!this.response && this.text) {
            this.response = this.text;
        }

        let size = this.size;

        if (!this.isPassive) {
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
        } else {
            if (this.text && this.text.length){
                size = this.text.length;
            } else {
                size = 0;
            }
            this.size = size;
        }


        if (!this.endTime) {
            this.endTime = new Date().getTime();
        }

        if (this.startTime && this.endTime) {
            this.duration = (this.endTime - this.startTime) / 1000;
        }

        if (this.duration && this.size) {
            if (this.duration < 100) {
                this.speed = this.size / 1000;
            } else {
                this.speed = Math.round(this.size / this.duration);
            }
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

    addFinishCode (finishCode) {
        this.finishCodes.push(finishCode);
    }

    setFinishCodes (finishCodes = []) {
        this.finishCodes = finishCodes;
    }

    setErrorCodes (errorCodes = []) {
        this.errorCodes = errorCodes;
    }

    addErrorCode (errorCode) {
        this.errorCodes.push(errorCode);
    }
}

module.exports = FtpRequest;