Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_FILE_NUM_LIMIT = exports.LOG_FILE_SIZE_LIMIT = exports.FILE_LOGGING_DIRECTORY = void 0;
/*
MIT License

Copyright (c) 2021 Marcel Kottmann

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
var stringbuffer_1 = require("./stringbuffer");
exports.FILE_LOGGING_DIRECTORY = "/data/logs";
exports.LOG_FILE_SIZE_LIMIT = 10240;
exports.LOG_FILE_NUM_LIMIT = 8;
var TDIWEF = "TDIWEF";
var NUMBER_PREFIX = "00000000";
var logFileNumber = -1;
function getLogFileNumber() {
    var max = -1;
    if (logFileNumber < 0) {
        var files = listDir(exports.FILE_LOGGING_DIRECTORY);
        files.forEach(function (f) {
            var m = f.match(/\d+/);
            if (m) {
                max = Math.max(max, parseInt(m[0], 10));
            }
        });
        logFileNumber = max + 1;
    }
    var numStr = logFileNumber.toString();
    return NUMBER_PREFIX.substr(0, 8 - numStr.length) + numStr;
}
function cleanupOldLogs() {
    var files = listDir(exports.FILE_LOGGING_DIRECTORY).sort();
    if (files.length > exports.LOG_FILE_NUM_LIMIT) {
        for (var i = 0; i < files.length - exports.LOG_FILE_NUM_LIMIT; i++) {
            removeFile(exports.FILE_LOGGING_DIRECTORY + "/" + files[i]);
        }
    }
}
global.el_flushLogBuffer = function () {
    var swap = global.logBuffer; // swap to prevent endless loop when error occurs in this method
    global.logBuffer = new stringbuffer_1.StringBuffer();
    var logFile = exports.FILE_LOGGING_DIRECTORY + "/logs-" + getLogFileNumber() + ".txt";
    try {
        var ret = appendFile(logFile, swap.toString());
        if (ret < 0) {
            console.error("Could not flush log file. Space exceeded?");
        }
    }
    catch (error) {
        console.error("Could not open log file. Space exceeded?");
    }
    if (fileSize(logFile) > exports.LOG_FILE_SIZE_LIMIT) {
        logFileNumber++;
    }
    cleanupOldLogs();
};
/**
 * This is defines the function to append to buffered file logging.
 */
global.el_appendLogBuffer = function (message, level) {
    global.logBuffer = global.logBuffer || new stringbuffer_1.StringBuffer();
    var l = TDIWEF.substr(level, 1);
    global.logBuffer.append(l + "\t" + new Date() + "\t" + message + "\n");
    if (global.logBuffer.length > 1024) {
        global.el_flushLogBuffer();
    }
};
console.log("File logging initialized successfully.");
