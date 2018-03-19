const _ = require('lodash');
const path = require('path');

class FtpFileItem {

    getMonths (){
        return {
            jan: 0,
            feb: 1,
            mar: 2,
            apr: 3,
            may: 4,
            jun: 5,
            jul: 6,
            aug: 7,
            sep: 8,
            oct: 9,
            nov: 10,
            dec: 11
        };
    }

    getDefaultData () {
        return _.cloneDeep({
            type: null,
            name: null,
            extension: null,
            fullPath: null,
            parentDir: null,
            target: null,
            sticky: false,
            hidden: false,
            inodeCount: 0,
            rights: {
                user: null,
                group: null,
                other: null
            },
            permissions: null,
            numericPermissions: null,
            acl: false,
            owner: null,
            group: null,
            size: 0,
            ftime: null,
            date: null
        });
    }

    initialize(data = null, parentPath = null) {
        let defaultData = this.getDefaultData();
        this.type = defaultData.type;
        this.name = defaultData.name;
        this.extension = defaultData.extension;
        this.fullPath = defaultData.fullPath;
        this.parentPath = defaultData.parentPath;
        this.target = defaultData.target;
        this.sticky = defaultData.sticky;
        this.hidden = defaultData.hidden;
        this.inodeCount = defaultData.inodeCount;
        this.rights = defaultData.rights;
        this.permissions = defaultData.permissions;
        this.numericPermissions = defaultData.numericPermissions;
        this.acl = defaultData.acl;
        this.owner = defaultData.owner;
        this.group = defaultData.group;
        this.size = defaultData.size;
        this.ftime = defaultData.ftime;
        this.date = defaultData.date;

        if (parentPath) {
            this.processParentPath(parentPath);
        }

        if (data && _.isObject(data)) {
            this.setData(data);
        }
    }

    setData (data = null) {
        if (data && _.isObject(data)) {
            let keys = Object.keys(this.getDefaultData());
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
        this.processSize();
        this.processDate();
        this.processFullPath();
    }

    processSize () {
        if (this.size) {
            let size = parseInt(this.size, 10);
            if (size && !isNaN(size)){
                this.size = size;
            }
        }
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
            let months = this.getMonths();
            if (dateChunks && dateChunks.length && dateChunks.length >= 3) {
                month = months[dateChunks[0].toLowerCase()];
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
                    let fileTime = date.getTime();
                    if (fileTime - currentTime > 100800000 || fileTime > currentTime) {
                        date = new Date((year - 1), month, day, hour, minute);
                        fileTime = date.getTime();
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
}

module.exports = FtpFileItem;