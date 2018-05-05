/* global describe, it */

let FC = require('../lib/ftpClient');
let _ = require('lodash');
let path = require('path');
let fs = require('fs');

let expect = require('chai').expect;
let assert = require('chai').assert;
let testDataFileName = 'test-data.json';
let testDataFile = path.join(__dirname, testDataFileName);
let testDataFileContents;

let testDataRequiredKeys = [
    'options',
    'connection',
    'testDir',
    'newTestDir',
    'newFileName'
];

let connectionRequiredKeys = [
    'host',
    'port'
];

let testError = function(messages = []) {
    console.log('');
    console.log('ERROR');
    console.log('-----');
    for (let i=0; i<messages.length; i++) {
        console.log(messages[i]);
    }
    console.log('-----');
    console.log('');
    process.exit(1);
};

if (!fs.existsSync(testDataFile)) {
    testError(['Test file "' + testDataFileName + '" is not present!', 'Please create it using provided "' + testDataFileName.replace(/\.json/, '-example.json') + '" example file.']);
}

try {
    testDataFileContents = fs.readFileSync(testDataFile);
    if (!testDataFileContents) {
        testError(['Test file "' + testDataFileName + '" appears to be empty!']);
    }
} catch (ex) {
    testError(['Test file "' + testDataFileName + '" contents could not be read!']);
}

let testData = require(testDataFile);

if(_.difference(testDataRequiredKeys, _.keys(testData)).length) {
    testError(['Test data is not valid!', 'Please make sure it has following values set:\n\t"' + testDataRequiredKeys.join('"\n\t"') + '"']);
}

if(!(_.isObject(testData.connection) && _.difference(connectionRequiredKeys, _.keys(testData.connection)).length == 0)) {
    testError(['Connection data is not valid!', 'Please make sure it has following values set:\n\t"' + connectionRequiredKeys.join('"\n\t"') + '"', 'It can also contain "user" and "password" fields if anonymous login is not allowed on server']);
}

let files = [];
let testDir = path.join('/', testData.testDir);
let newTestDir = path.join('/', testData.newTestDir);
let sourcePath = path.join(testDir, path.basename(testDataFile));
let destinationPath = path.join(testDir, testData.newFileName);
let testDataFileSize = fs.statSync(testDataFile).size;
let getFileNoLimitDuration = 0;
let getFileLimitDuration = 0;
let putFileNoLimitDuration = 0;
let putFileLimitDuration = 0;

let originalFileCount = 0;

let fc = new FC(testData.options);

describe('FtpClient', function () {
    describe('connect', function () {
        it('Connects to ftp server', async function () {
            let connected = false;
            try {
                connected = await fc.connect(testData.connection);
            } catch (err) {
                connected  = false;
            }
            expect(connected).to.equal(true);
        });
    });
    describe('status', function () {
        it('Gets ftp server status information', async function () {
            let status = '';
            try {
                status = await fc.status();
            } catch (err) {
                status = '';
            }
            assert(status != '', 'Status info retrieved');
        });
    });
    describe('system', function () {
        it('Gets ftp server system information', async function () {
            let systemInfo = '';
            try {
                systemInfo = await fc.system();
            } catch (err) {
                systemInfo = '';
            }
            assert(systemInfo != '', 'System info retrieved');
        });
    });
    describe('list', function () {
        it('Lists files from root directory', async function () {
            try {
                files = await fc.list('/');
                originalFileCount = files.length;
            } catch (err) {
                files = [];
            }
            assert(originalFileCount > 0, 'File list length is not empty');
        });
    });
    describe('get', function () {
        it('Gets contents of first readable file from root directory', async function () {
            let startTime = Date.now();
            let fileContents = '';
            let fileItem = _.find(files, (item) => {
                return item.type == '-' && item.size > 0 && item.fullPath && item.rights && item.rights.user && item.rights.user.match(/^r/);
            });
            if (fileItem) {
                try {
                    let ftpRequest = await fc.get(fileItem.fullPath);
                    fileContents = ftpRequest.text;
                } catch (err) {
                    fileContents = '';
                }
            }
            let endTime = Date.now();
            getFileNoLimitDuration = endTime - startTime;
            assert(fileContents.length > 0, 'File contents received');
        });
    });
    describe('getLimited', function () {
        it('Gets contents of first readable file from root directory with speed limits applied', async function () {
            let startTime = Date.now();
            fc.options.limitDownload = 10 * 1024;
            fc.options.limitUpload = 10 * 1024;
            fc.setLimiting(true);
            let fileContents = '';
            let fileItem = _.find(files, (item) => {
                return item.type == '-' && item.size > 0 && item.fullPath && item.rights && item.rights.user && item.rights.user.match(/^r/);
            });
            if (fileItem) {
                try {
                    let ftpRequest = await fc.get(fileItem.fullPath);
                    fileContents = ftpRequest.text;
                } catch (err) {
                    fileContents = '';
                }
            }
            fc.setLimiting(false);
            let endTime = Date.now();
            getFileLimitDuration = endTime - startTime;
            assert(fileContents.length > 0, 'File contents received');
            assert(getFileLimitDuration > getFileNoLimitDuration, 'Limited transfer took longer than unlimited one');
        });
    });
    describe('mkdir', function () {
        it('Creates new directory on server', async function () {
            let created = false;
            try {
                created = await fc.mkdir(testDir);
            } catch (err) {
                created = false;
            }
            expect(created).to.equal(true);
        });
    });
    describe('cwd', function () {
        it('Changes cwd to new dir', async function () {
            let changed = false;
            try {
                changed = await fc.cwd(testDir);
            } catch (err) {
                changed = false;
            }
            expect(changed).to.equal(true);
        });
    });
    describe('pwd', function () {
        it('Gets current working directory', async function () {
            let directory = '';
            try {
                directory = await fc.pwd();
            } catch (err) {
                directory = '';
            }
            expect(directory).to.equal(testDir);
        });
    });
    describe('cdup', function () {
        it('Goes one dir level up', async function () {
            let result = false;
            let directory = '';
            try {
                result = await fc.cdup();
                if (result) {
                    try {
                        directory = await fc.pwd();
                    } catch (pwdEx) {
                        directory = '';
                    }
                }
            } catch (err) {
                result = false;
            }
            expect(result).to.equal(true);
            expect(directory).to.equal('/');
        });
    });
    describe('put/size', function () {
        it('Uploads file and checks it size on server', async function () {
            let startTime = Date.now();
            let uploaded = false;
            let fileSize = 0;
            try {
                uploaded = await fc.put(testDataFile, sourcePath);
                await fc.wait(1000);
                if (uploaded) {
                    try {
                        fileSize = await fc.size(sourcePath);
                    } catch (ex) {
                        fileSize = 0;
                    }
                }
            } catch (ex) {
                uploaded = false;
            }
            let endTime = Date.now();
            putFileNoLimitDuration = endTime - startTime;
            expect(uploaded).to.equal(true);
            expect(fileSize).to.equal(testDataFileSize);
        });
    });
    describe('put/sizeLimited', function () {
        it('Uploads file with limits and checks it size on server', async function () {
            let startTime = Date.now();
            fc.options.limitDownload = 1024;
            fc.options.limitUpload = 1024;
            fc.setLimiting(true);
            let uploaded = false;
            let fileSize = 0;
            try {
                uploaded = await fc.put(testDataFile, sourcePath);
                await fc.wait(1000);
                if (uploaded) {
                    try {
                        fileSize = await fc.size(sourcePath);
                    } catch (ex) {
                        fileSize = 0;
                    }
                }
            } catch (ex) {
                uploaded = false;
            }
            let endTime = Date.now();
            putFileLimitDuration = endTime - startTime;
            fc.setLimiting(false);
            expect(uploaded).to.equal(true);
            expect(fileSize).to.equal(testDataFileSize);
            assert(putFileLimitDuration > putFileNoLimitDuration, 'Limited transfer took longer than unlimited one');
        });
    });
    describe('get/compare', function () {
        it('Gets previously uploaded file contents from root directory and compares them to original file', async function () {
            let fileContents = '';
            try {
                let ftpRequest = await fc.get(sourcePath);
                fileContents = ftpRequest.text;
            } catch (err) {
                fileContents = '';
            }
            assert(fileContents.length > 0, 'File contents received');
            assert(fileContents == testDataFileContents, 'File contents identical');
        });
    });
    describe('append/size', function () {
        it('Appends file contents to file and checks it size on server', async function () {
            let uploaded = false;
            let fileSize = 0;
            try {
                uploaded = await fc.append(testDataFile, sourcePath);
                await fc.wait(1000);
                if (uploaded) {
                    try {
                        fileSize = await fc.size(sourcePath);
                    } catch (ex) {
                        fileSize = 0;
                    }
                }
            } catch (ex) {
                uploaded = false;
            }
            expect(uploaded).to.equal(true);
            expect(fileSize).to.equal(2 * testDataFileSize);
        });
    });
    describe('lastMod', function () {
        it('Gets last modification time for file on server', async function () {
            let lastMod = 0;
            try {
                lastMod = await fc.lastMod(sourcePath);
            } catch (ex) {
                lastMod = 0;
            }
            expect(lastMod).to.not.equal(0);
        });
    });
    describe('rename (file)', function () {
        it('Renames file on server', async function () {
            let renamed = false;
            try {
                renamed = await fc.rename(sourcePath, destinationPath);
            } catch (ex) {
                renamed = false;
            }
            expect(renamed).to.equal(true);
        });
    });
    describe('fileExists', function () {
        it('Checks whether file exists on server', async function () {
            let exists = false;
            try {
                exists = await fc.fileExists(destinationPath);
            } catch (err) {
                exists = false;
            }
            expect(exists).to.equal(true);
        });
    });
    describe('delete', function () {
        it('Deletes file on server', async function () {
            let deleted = false;
            try {
                deleted = await fc.delete(destinationPath);
            } catch (ex) {
                deleted = false;
            }
            expect(deleted).to.equal(true);
        });
    });
    describe('rename (directory)', function () {
        it('Renames directory on server', async function () {
            let renamed = false;
            try {
                renamed = await fc.rename(testDir, newTestDir);
            } catch (ex) {
                renamed = false;
            }
            expect(renamed).to.equal(true);
        });
    });
    describe('dirExists', function () {
        it('Checks whether directory exists on server', async function () {
            let exists = false;
            try {
                exists = await fc.dirExists(newTestDir);
            } catch (err) {
                exists = false;
            }
            expect(exists).to.equal(true);
        });
    });
    describe('rmdir', function () {
        it('Deletes directory on server', async function () {
            let deleted = false;
            try {
                deleted = await fc.rmdir(newTestDir);
            } catch (ex) {
                deleted = false;
            }
            expect(deleted).to.equal(true);
        });
    });
    describe('list (check count)', function () {
        it('Checks whether current root dir file count remains the same as it was on first list test', async function () {
            let newFileCount = 0;
            let newFiles = [];
            try {
                newFiles = await fc.list('/');
                newFileCount = newFiles.length;
            } catch (err) {
                newFiles = [];
                newFileCount = 0;
            }
            assert(originalFileCount == newFileCount, 'File lists have same length');
        });
    });
    describe('disconnect', function () {
        it('Disconnects from ftp server', async function () {
            let disconnected = false;
            try {
                disconnected = await fc.disconnect();
            } catch (err) {
                disconnected  = false;
            }
            expect(disconnected).to.equal(true);
        });
    });
});