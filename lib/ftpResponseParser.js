/**
 * @fileOverview FtpResponseParser class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');

class FtpResponseParser {

    constructor(fileItemClass) {
        this.fileItemClass = fileItemClass;
    }

    parseListResponse(listResponse, parentPath = null, removeDotDirs = true) {
        let items = [];
        let listLines = _.compact(listResponse.split(/\r?\n/g));
        for (let i=0; i<listLines.length; i++) {
            let item = this.parseListItem(listLines[i], parentPath);
            if (item) {
                if (!removeDotDirs || !(item.name.match(/^\.\.$/) || item.name.match(/^\.$/))){
                    items.push(item);
                }
            }
        }
        return items;
    }

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
        }
        return item;
    }

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
}

module.exports = FtpResponseParser;