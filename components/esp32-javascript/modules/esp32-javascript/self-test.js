Object.defineProperty(exports, "__esModule", { value: true });
exports.run = void 0;
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
var configserver_1 = require("./configserver");
function setPinValue(pin, val) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, val);
    console.log("Selftest: GPIO " + pin + " set to " + val);
}
function run() {
    configserver_1.requestHandler.push(function (req, res) {
        try {
            var match = void 0;
            // eslint-disable-next-line no-cond-assign
            if ((match = req.path.match(/^\/selftest\/pins\/(\d+)\/([0|1])/))) {
                setPinValue(parseInt(match[1]), parseInt(match[2]));
            }
            res.end();
        }
        catch (error) {
            if (!res.headersWritten) {
                res.setStatus(500);
            }
            if (!res.isEnded) {
                res.end("Error: " + error);
            }
        }
    });
    console.log("Self test initialized.");
}
exports.run = run;
