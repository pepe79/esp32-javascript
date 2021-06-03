Object.defineProperty(exports, "__esModule", { value: true });
exports.main = exports.getBootTime = void 0;
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
var wifi = require("wifi-events");
var configServer = require("./configserver");
var config_1 = require("./config");
errorhandler = function (error) {
    console.error(error.stack || error);
    startSoftApMode();
};
if (typeof KEY_BUILTIN !== "undefined") {
    pinMode(KEY_BUILTIN, INPUT);
}
if (typeof LED_BUILTIN !== "undefined") {
    pinMode(LED_BUILTIN, OUTPUT);
}
var configServerStarted = false;
var programLoaded = false;
function blink() {
    if (typeof LED_BUILTIN !== "undefined") {
        var blinkState_1 = 0;
        return setInterval(function () {
            digitalWrite(LED_BUILTIN, blinkState_1);
            blinkState_1 = blinkState_1 === 0 ? 1 : 0;
        }, 333);
    }
}
var bootTime = new Date();
function setBootTime(date) {
    bootTime = date;
}
function getBootTime() {
    return bootTime;
}
exports.getBootTime = getBootTime;
function startSoftApMode() {
    console.info("Starting soft ap mode.");
    var blinkId = blink();
    console.debug("Blinking initialized.");
    wifi.createSoftAp("esp32", "", function (evt) {
        console.debug("WiFi Event received: " + evt);
        if (evt.status === 1) {
            console.info("SoftAP: Connected");
            if (!configServerStarted) {
                configServer.startConfigServer();
                configServerStarted = true;
            }
            var timeout_1 = 5;
            //stop soft ap wifi after <timeout> minutes
            setTimeout(function () {
                console.info("Stopping soft ap now after " + timeout_1 + " minutes.");
                stopWifi();
                clearInterval(blinkId);
                // start normal wifi connection attempts
                connectToWifi();
            }, timeout_1 * 60 * 1000);
        }
        else if (evt.status === 0) {
            console.info("SoftAP: Disconnected");
        }
        else {
            console.debug("Unhandled wifi soft ap status " + evt.status);
        }
    });
}
function parseDate(d) {
    var day = parseInt(d.substr(5, 2));
    var month = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ].indexOf(d.substr(8, 3));
    var year = parseInt(d.substr(12, 4));
    var hour = parseInt(d.substr(17, 2));
    var minute = parseInt(d.substr(20, 2));
    var second = parseInt(d.substr(23, 2));
    var utc = Date.UTC(year, month, day, hour, minute, second, 0);
    if (isNaN(utc)) {
        throw Error("Invalid date");
    }
    return new Date(utc);
}
function evalScript(content, headers) {
    console.debug("==> Start evaluation:");
    if (typeof LED_BUILTIN !== "undefined") {
        digitalWrite(LED_BUILTIN, 0);
    }
    eval(content); // this uses headers implicitly (TODO CHECK)
}
function loadOfflineScript() {
    var _a;
    var programLoadedPrev = programLoaded;
    programLoaded = true;
    if (!programLoadedPrev && ((_a = config_1.config === null || config_1.config === void 0 ? void 0 : config_1.config.ota) === null || _a === void 0 ? void 0 : _a.script)) {
        console.log("An offline script was found. Trying to execute...");
        evalScript(config_1.config.ota.script);
    }
}
function connectToWifi() {
    var _a, _b;
    if (typeof LED_BUILTIN !== "undefined") {
        digitalWrite(LED_BUILTIN, 1);
    }
    if (!((_a = config_1.config === null || config_1.config === void 0 ? void 0 : config_1.config.wifi) === null || _a === void 0 ? void 0 : _a.ssid) || !((_b = config_1.config === null || config_1.config === void 0 ? void 0 : config_1.config.wifi) === null || _b === void 0 ? void 0 : _b.password)) {
        console.error("No ssid and/or password was configured. Cannot connect to wifi: ");
        return;
    }
    var retries = 0;
    wifi.connectWifi(config_1.config.wifi.ssid, config_1.config.wifi.password, function (evt, ip) {
        var _a, _b;
        if (evt.status === 0) {
            console.debug("WIFI: DISCONNECTED");
            if (!configServerStarted) {
                retries++;
            }
            if (!configServerStarted && retries === 5) {
                console.warn("Maximum retries exceeded to connect to wifi.");
                if ((_a = config_1.config === null || config_1.config === void 0 ? void 0 : config_1.config.ota) === null || _a === void 0 ? void 0 : _a.offline) {
                    stopWifi();
                    loadOfflineScript();
                }
                else {
                    console.warn("No offline script was found.");
                    startSoftApMode();
                }
            }
        }
        else if (evt.status === 1) {
            if (!programLoaded) {
                console.info("WIFI: CONNECTED [" + ip + "]");
                if (!configServerStarted) {
                    configServer.startConfigServer();
                    configServerStarted = true;
                }
                retries = 0;
                if ((_b = config_1.config === null || config_1.config === void 0 ? void 0 : config_1.config.ota) === null || _b === void 0 ? void 0 : _b.url) {
                    programLoaded = true;
                    console.info("Loading program from: " + config_1.config.ota.url);
                    var headers_1;
                    fetch(config_1.config.ota.url)
                        .then(function (r) {
                        headers_1 = r.headers;
                        return r.text();
                    })
                        .then(function (data) {
                        var _a;
                        if ((_a = config_1.config === null || config_1.config === void 0 ? void 0 : config_1.config.ota) === null || _a === void 0 ? void 0 : _a.offline) {
                            config_1.config.ota.script = data;
                            config_1.saveConfig(config_1.config);
                            console.info("==> Saved offline script length=" + data.length);
                        }
                        else {
                            console.info("==> NOT saving offline script");
                        }
                        var dateString = headers_1.get("Date");
                        if (dateString) {
                            var now = parseDate(dateString);
                            setDateTimeInMillis(now.getTime());
                            setDateTimeZoneOffsetInHours(2);
                            setBootTime(new Date());
                            console.debug("Setting boot time to " + getBootTime());
                        }
                        evalScript(data, headers_1);
                    })
                        .catch(function (error) {
                        console.error(error);
                        startSoftApMode();
                    });
                }
                else {
                    console.error("No OTA (Over-the-air) url specified.");
                    loadOfflineScript();
                }
            }
        }
        else if (evt.status === 2) {
            console.debug("WIFI: CONNECTING...");
        }
    }, config_1.config.wifi.bssid);
}
function main() {
    var _a, _b;
    var showSetup = false;
    console.log("Current configuration:");
    console.log(JSON.stringify(config_1.config));
    if (typeof KEY_BUILTIN !== "undefined" && digitalRead(KEY_BUILTIN) == 0) {
        console.info("Setup key pressed: Starting setup mode ...");
        showSetup = true;
    }
    if (!((_a = config_1.config === null || config_1.config === void 0 ? void 0 : config_1.config.wifi) === null || _a === void 0 ? void 0 : _a.ssid)) {
        console.info("Missing wifi SSID configuration: Starting setup mode ...");
        showSetup = true;
    }
    if (!((_b = config_1.config === null || config_1.config === void 0 ? void 0 : config_1.config.wifi) === null || _b === void 0 ? void 0 : _b.password)) {
        console.info("Missing wifi password configuration: Starting setup mode ...");
        showSetup = true;
    }
    if (showSetup) {
        startSoftApMode();
    }
    else {
        console.info("Trying to connect to Wifi from JS:");
        connectToWifi();
    }
}
exports.main = main;
