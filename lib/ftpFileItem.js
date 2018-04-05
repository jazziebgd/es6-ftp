/**
 * @fileOverview FtpFileItem class file
 * @author Dino Ivankov <dinoivankov@gmail.com>
 * @version 0.0.1
 */

const _ = require('lodash');
const path = require('path');

/**
 * Class FtpFileItem
 *
 * Class that represents single file or directory item from ftp server
 */

class FtpFileItem {

    /**
     * Returns object with month acronyms as keys and month number values as properties (compatible with Date() months)
     *
     * @return {Object} Object with month acronyms as keys and month number values as properties
     */
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

    /**
     * Returns default data for file item instance
     *
     * @return {Object} File item default data
     */
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

    /**
     * Initializes file item class instance
     *
     * @param  {Object} data       Object with data for file item instance
     * @param  {String} parentPath Parent path for given file item instance
     *
     * @return {undefined}
     */
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

    /**
     * Sets file item instance data
     *
     * @param {Object} data Object with data for file item instance
     *
     * @return {undefined}
     */
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

    /**
     * Processes parent path, setting it in object instance and updating fullPath based on parentPath
     *
     * @param  {String} parentPath Parent path for this file item object
     *
     * @return {undefined}
     */
    processParentPath(parentPath = null) {
        if (parentPath) {
            this.parentPath = parentPath;
            this.processFullPath();
        }
    }

    /**
     * Processes full path based on parentPath and name properties
     *
     * @return {undefined}
     */
    processFullPath() {
        if (this.parentPath && this.name) {
            this.fullPath = path.posix.join(this.parentPath, this.name);
        }
    }

    /**
     * Processes file item data, populating additional properties from known ones
     *
     * @return {undefined}
     */
    processData() {
        this.processPermissions();
        this.processExtension();
        this.processHiddenFlag();
        this.processSize();
        this.processDate();
        this.processFullPath();
    }

    /**
     * Processes size value for file item instance
     *
     * @return {undefined}
     */
    processSize () {
        if (this.size) {
            let size = parseInt(this.size, 10);
            if (size && !isNaN(size)){
                this.size = size;
            }
        }
    }

    /**
     * Processes file extension from file name
     *
     * @return {undefined}
     */
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

    /**
     * Sets or unsets hidden flag based on file name
     *
     * @return {undefined}
     */
    processHiddenFlag () {
        if (this.name) {
            if (this.name.match(/^\./)){
                this.hidden = true;
            } else {
                this.hidden = false;
            }
        }
    }

    /**
     * Processes file date based on value returned from ftp server. Automatically detects format (unix: 'Mar 6 21:19', windows (IIS): '03-30-18 09:54PM') and parses it accordingly
     *
     * @return {undefined}
     */
    processDate() {
        if (this.ftime) {
            let date = null;
            if (this.ftime.match(/^\d/)) {
                let ftimeChunks = this.ftime.split(' ');
                let dateChunks = ftimeChunks[0].split('-');
                let timeChunks = ftimeChunks[1].split(':');
                let month = dateChunks[0];
                let day = dateChunks[1];
                let year = dateChunks[2];
                if (year && year.length == 2) {
                    let currentYear = (new Date()).getFullYear() + '';
                    currentYear = currentYear.replace(/\d\d$/, '');
                    year = currentYear + year;
                }

                let hour = timeChunks[0];
                let minute = timeChunks[1].replace(/[^\d]/g, '');
                if (timeChunks[1].replace(/[\d:]/g, '') == 'PM') {
                    hour += 12;
                }
                date = new Date(year, month, day, hour, minute);
            } else if (this.ftime.match(/^\w/)) {
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
            }
            this.date = date;
        }
    }

    /**
     * Processes file item permissions
     *
     * @return {undefined}
     */
    processPermissions () {
        if (this.permissions) {
            this.processNumericPermissions();
            this.rights.user = this.permissions.substr(0, 3);
            this.rights.group = this.permissions.substr(3, 3);
            this.rights.other = this.permissions.substr(6, 3);
        }
    }

    /**
     * Processes file item numeric permissions
     *
     * @return {undefined}
     */
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