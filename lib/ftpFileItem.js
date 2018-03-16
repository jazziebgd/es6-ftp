const _ = require('lodash');
const path = require('path');

class FtpFileItem {

    constructor (ftpClientData) {
        this.ftpClientData = ftpClientData;
    }

    initialize(data = null, parentPath = null) {
        this.type = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.type);
        this.name = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.name);
        this.extension = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.extension);
        this.fullPath = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.fullPath);
        this.parentPath = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.parentPath);
        this.target = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.target);
        this.sticky = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.sticky);
        this.hidden = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.hidden);
        this.inodeCount = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.inodeCount);
        this.rights = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.rights);
        this.permissions = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.permissions);
        this.numericPermissions = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.numericPermissions);
        this.acl = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.acl);
        this.owner = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.owner);
        this.group = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.group);
        this.size = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.size);
        this.ftime = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.ftime);
        this.date = _.cloneDeep(this.ftpClientData.fileItemDefaultValues.date);

        if (parentPath) {
            this.processParentPath(parentPath);
        }

        if (data && _.isObject(data)) {
            this.setData(data);
        }
    }

    setData (data = null) {
        if (data && _.isObject(data)) {
            let keys = Object.keys(this.ftpClientData.fileItemDefaultValues);
            for (let i=0; i<keys.length; i++) {
                if (!_.isUndefined(data[keys[i]])) {
                    this[keys[i]] = _.cloneDeep(data[keys[i]]);
                }
            }
        }

        this.processData();
    }

    processParentPath(parentPath = null) {
        if (parentPath) {
            this.parentPath = parentPath;
            this.processFullPath();
        }
    }

    processFullPath() {
        if (this.parentPath && this.name) {
            this.fullPath = path.posix.join(this.parentPath, this.name);
        }
    }

    processData() {
        this.processPermissions();
        this.processExtension();
        this.processHiddenFlag();
        this.processDate();
        this.processFullPath();
    }

    processExtension () {
        if (this.name) {
            let nameParts = this.name.split('.');
            if (this.type != 'd' && nameParts.length > 1) {
                this.extension = _.last(nameParts);
            } else {
                this.extension = '';
            }
        }
    }

    processHiddenFlag () {
        if (this.name) {
            if (this.name.match(/^\./)){
                this.hidden = true;
            } else {
                this.hidden = false;
            }
        }
    }

    processDate() {
        if (this.ftime) {
            let date = null;
            let hasYear = false;
            let year;
            let month;
            let day;
            let hour;
            let minute;
            let dateChunks = this.ftime.split(' ');
            if (dateChunks && dateChunks.length && dateChunks.length >= 3) {
                month = this.ftpClientData.months[dateChunks[0].toLowerCase()];
                day = parseInt(dateChunks[1], 10);
                if (dateChunks[2].match(/:/)) {
                    year = (new Date()).getFullYear();
                    let timeChunks = dateChunks[2].split(':');
                    hour = parseInt(timeChunks[0], 10);
                    minute = parseInt(timeChunks[1], 10);
                } else {
                    hasYear = true;
                    year = parseInt(dateChunks[2], 10);
                    hour = 0;
                    minute = 0;
                }

                date = new Date(year, month, day, hour, minute);
                if (!hasYear) {
                    let currentTime = Date.now();
                    let fileTime = date.getTime()
                    if (fileTime - currentTime > 100800000 || fileTime > currentTime) {
                        date = new Date((year - 1), month, day, hour, minute);
                        fileTime = date.getTime()
                    }

                    if (currentTime - fileTime > 16070400000) {
                        date = new Date((year + 1), month, day, hour, minute);
                    }
                }
            }
            this.date = date;
        }
    }

    processPermissions () {
        if (this.permissions) {
            this.processNumericPermissions();
            this.rights.user = this.permissions.substr(0, 3);
            this.rights.group = this.permissions.substr(3, 3);
            this.rights.other = this.permissions.substr(6, 3);
        }
    }

    processNumericPermissions () {
        let chunks = this.permissions.split('');
        let numericPermissions = '';
        if (this.permissions && this.permissions.length == 9){
            for (let j=0; j<3; j++){
                let octal = 0;
                for (let i=0; i<3; i++){
                    let perm = chunks[(j*3)+i];
                    if (perm != '-'){
                        let currentPerm = Math.pow(2, Math.abs(2-i));
                        octal += currentPerm;
                    }
                }
                numericPermissions += '' + octal;
            }
        }
        if (numericPermissions){
            numericPermissions = '0x' + numericPermissions;
        }
        this.numericPermissions = numericPermissions;
    }
};

module.exports = FtpFileItem;