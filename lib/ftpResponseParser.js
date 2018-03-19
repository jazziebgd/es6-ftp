const _ = require('lodash');

class FtpResponseParser {

    constructor(fileItemClass, clientData) {
        this.fileItemClass = fileItemClass;
        this.ftpClientData = clientData;
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
        let matches = itemLine.match(this.ftpClientData.regexes.listLine);
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
}

module.exports = FtpResponseParser;