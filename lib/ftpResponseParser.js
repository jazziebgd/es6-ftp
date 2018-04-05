/**
 * @fileOverview FtpResponseParser class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');

/**
 * Class FtpResponseParser
 *
 * Class for object that parses FTP server responses
 */
class FtpResponseParser {

    /**
     * Constructor method
     *
     * @param  {Class}  fileItemClass Class to use for fileItem objects
     *
     * @return {undefined}
     */
    constructor(fileItemClass) {
        this.fileItemClass = fileItemClass;
    }

    /**
     * Parses response from ftp 'LIST' command
     *
     * @param  {String}  listResponse  'LIST' command response text
     * @param  {String}  parentDir    Parent directory path for file items
     * @param  {Boolean} removeDotDirs Flag to indicate removal of dot ('.' and '..') dirs
     *
     * @return {FtpFileItem[]}         An array of file items for files and dirs in directory
     */
    parseListResponse(listResponse, parentDir = null, removeDotDirs = true) {
        let items = [];
        if (listResponse && listResponse.split && _.isFunction(listResponse.split)) {
            let listLines = _.compact(listResponse.split(/\r?\n/g));
            for (let i=0; i<listLines.length; i++) {
                let item = this.parseListItem(listLines[i], parentDir);
                if (item) {
                    if (!removeDotDirs || !(item.name.match(/^\.\.$/) || item.name.match(/^\.$/))){
                        items.push(item);
                    }
                }
            }
        }
        return items;
    }

    /**
     * Parses single line from 'LIST' command response. Detects whether response is unix or windows (IIS)
     *
     * @param  {String} itemLine   Line from 'LIST' command response
     * @param  {String} parentPath Parent directory path for file items
     *
     * @return {[type]}            [description]
     */
    parseListItem(itemLine, parentPath = null) {
        let data = {};
        let item;
        let matches = itemLine.match(/^([-dl]{1})([-rwx]{9})\s+?([\d]+)\s+?([^\s]+)\s+?([^\s]+)\s+?([\d]+)\s+?([^\s]+\s+?[^\s]+\s+?[^\s]+)\s+?(.*)$/);
        if (matches && matches.length && matches.length >= 9) {
            data.type = matches[1];
            data.permissions = matches[2];
            data.inodeCount = matches[3];
            data.owner = matches[4];
            data.group = matches[5];
            data.size = matches[6];
            data.ftime = matches[7].replace(/\s+/g, ' ');
            data.name = matches[8];
            let itemClass = this.fileItemClass;
            item = new itemClass();
            item.initialize(data, parentPath);
        } else {
            matches = itemLine.match(/^([\d]{2}-[\d]{2}-[\d]{2}\s+?[\d]{2}:[\d]{2}[AP]M)(\s*<DIR>)?\s*(\d*)?\s*(.*)$/);
            if (matches && matches.length && matches.length >= 5) {
                data.type = matches[2] ? 'd' : '-';
                data.permissions = 'rwxrwxrwx';
                data.inodeCount = 0;
                data.owner = '';
                data.group = '';
                data.size = !_.isUndefined(matches[3]) ? parseInt(matches[3], 10) : 0;
                data.ftime = matches[1].replace(/\s+/g, ' ');
                data.name = matches[4];
                let itemClass = this.fileItemClass;
                item = new itemClass();
                item.initialize(data, parentPath);
            }
        }
        return item;
    }

    /**
     * Parses 'PASV' ftp command response
     *
     * @param  {FtpRequest} ftpRequest  FtpRequest instance with 'PASV' command executed
     *
     * @return {Object|Boolean}         Object with 'ip' and 'port' properties or false on failure
     */
    parsePasvResponse(ftpRequest) {
        let result = false;
        let matches = ftpRequest.text.match(/([\d]+),([\d]+),([\d]+),([\d]+),([-\d]+),([-\d]+)/);
        if (matches) {
            let ip = _.slice(matches, 1, 5).join('.');
            let port = (parseInt(matches[5], 10) * 256) + parseInt(matches[6], 10);
            if (ip && port) {
                result = {
                    ip: ip,
                    port: port
                };
            }
        }
        return result;
    }

    /**
     * Parses ftp command responses
     *
     * @param  {String} responseText Ftp command response
     *
     * @return {Object}              An object with 'responseCode', 'text', 'rest' and 'unchangedResponse' properties
     */
    parseCommandResponse(responseText) {
        let result = {
            responseCode: null,
            text: null,
            rest: null,
            unchangedResponse: responseText + '',
        };
        let match;
        let reRmLead;
        let rest = '';
        while ((match = responseText.match(/(?:^|\r?\n)(\d{3})\s[^\r\n]*\r?\n/))) {
            // support multiple terminating responses in the buffer
            rest = responseText.substring(match.index + match[0].length);
            if (rest.length) {
                responseText = responseText.substring(0, match.index + match[0].length);
            }

            // we have a terminating response line
            result.responseCode = parseInt(match[1], 10);

            // RFC 959 does not require each line in a multi-line response to begin
            // with '<code>-', but many servers will do this.
            //
            // remove this leading '<code>-' (or '<code> ' from last line) from each
            // line in the response ...
            reRmLead = '(^|\\r?\\n)';
            reRmLead += match[1];
            reRmLead += '(?: |\\-)';
            reRmLead = new RegExp(reRmLead, 'g');
            result.text = responseText.replace(reRmLead, '$1').trim();
            result.rest = rest;
            responseText = rest;
            // responseText = '';
            // this.emit('response', responseCode, text);
        }
        return result;
    }

    /**
     * Parses FEAT command response and returns an array of available features
     *
     * @param  {String}     featureResponse FEAT command response
     *
     * @return {String[]}                   An array of available features
     */
    parseFeatures(featureResponse) {
        let features = [];
        let featLines = featureResponse.split(/\r?\n/g);
        for (let i=1; i<(featLines.length - 1); i++){
            features = _.concat(features, this.parseFeatureLine(featLines[i]));
        }
        return features;
    }

    /**
     * Parses FEAT command response line and returns an array of available features
     *
     * @param  {String}     featureLine     FEAT command response line
     *
     * @return {String[]}                   An array of available features
     */
    parseFeatureLine(featureLine) {
        let features = [];
        let featLine = _.trim(featureLine);
        if (featLine.match(/;/)){
            let featChunks = featLine.split(' ');
            let baseFeat = featChunks[0];
            let featItems = featLine.replace(/^[^\s]+\s+?/, '').split(';');
            for (let i=0; i<featItems.length; i++) {
                let featItem = _.trim(featItems[i]);
                if (featItem) {
                    features.push(baseFeat + ' ' + featItem);
                }
            }
        } else {
            features.push(featLine);
        }
        return features;
    }
}

module.exports = FtpResponseParser;