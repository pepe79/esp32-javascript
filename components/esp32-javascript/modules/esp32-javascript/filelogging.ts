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
import { StringBuffer } from "./stringbuffer";

export const FILE_LOGGING_DIRECTORY = "/data/logs";
export const LOG_FILE_SIZE_LIMIT = 10240;
export const LOG_FILE_NUM_LIMIT = 8;

const TDIWEF = "TDIWEF";
const NUMBER_PREFIX = "00000000";
let logFileNumber = -1;

function getLogFileNumber(): string {
  let max = -1;
  if (logFileNumber < 0) {
    const files = listDir(FILE_LOGGING_DIRECTORY);
    files.forEach((f) => {
      const m = f.match(/\d+/);
      if (m) {
        max = Math.max(max, parseInt(m[0], 10));
      }
    });
    logFileNumber = max + 1;
  }
  const numStr = logFileNumber.toString();
  return NUMBER_PREFIX.substr(0, 8 - numStr.length) + numStr;
}

function cleanupOldLogs() {
  const files = listDir(FILE_LOGGING_DIRECTORY).sort();
  if (files.length > LOG_FILE_NUM_LIMIT) {
    for (let i = 0; i < files.length - LOG_FILE_NUM_LIMIT; i++) {
      removeFile(`${FILE_LOGGING_DIRECTORY}/${files[i]}`);
    }
  }
}

global.el_flushLogBuffer = function (): void {
  const swap = global.logBuffer; // swap to prevent endless loop when error occurs in this method
  global.logBuffer = new StringBuffer();

  const logFile = `${FILE_LOGGING_DIRECTORY}/logs-${getLogFileNumber()}.txt`;
  try {
    const ret = appendFile(logFile, swap.toString());
    if (ret < 0) {
      console.error("Could not flush log file. Space exceeded?");
    }
  } catch (error) {
    console.error("Could not open log file. Space exceeded?");
  }

  if (fileSize(logFile) > LOG_FILE_SIZE_LIMIT) {
    logFileNumber++;
  }
  cleanupOldLogs();
};

/**
 * This is defines the function to append to buffered file logging.
 */
global.el_appendLogBuffer = function (message: string, level: number): void {
  global.logBuffer = global.logBuffer || new StringBuffer();
  const l = TDIWEF.substr(level, 1);
  global.logBuffer.append(`${l}\t${new Date()}\t${message}\n`);
  if (global.logBuffer.length > 1024) {
    global.el_flushLogBuffer();
  }
};

console.log("File logging initialized successfully.");
