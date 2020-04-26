Object.defineProperty(exports, "__esModule", { value: true });
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
    var blinkState = 0;
    return setInterval(function () {
        digitalWrite(LED_BUILTIN, blinkState);
        blinkState = blinkState === 0 ? 1 : 0;
    }, 333);
}
function startSoftApMode() {
    console.info("Starting soft ap mode.");
    var blinkId = blink();
    console.debug("Blinking initialized.");
    wifi.createSoftAp("esp32", "", function (evt) {
        console.debug("Event received:" + evt);
        if (evt.status === 1) {
            console.info("SoftAP: Connected");
            if (!configServerStarted) {
                configServer.startConfigServer();
                configServerStarted = true;
            }
            var timeout = 5;
            //stop soft ap wifi after <timeout> minutes
            setTimeout(function () {
                console.info("Stopping soft ap now after " + timeout + " minutes.");
                stopWifi();
                clearInterval(blinkId);
                // start normal wifi connection attempts
                connectToWifi();
            }, timeout * 60 * 1000);
        }
        else if (evt.status === 0) {
            console.info("SoftAP: Disconnected");
        }
        else {
            console.debug("SoftAP: Status " + evt.status);
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
    var date = new Date(Date.UTC(year, month, day, hour, minute, second, 0));
    return date;
}
function evalScript(content, headers) {
    console.debug("==> Start evaluation:");
    digitalWrite(LED_BUILTIN, 0);
    eval(content); // this uses headers implicitly (TODO CHECK)
}
function connectToWifi() {
    digitalWrite(LED_BUILTIN, 1);
    var retries = 0;
    wifi.connectWifi(config_1.config.wlan.ssid, config_1.config.wlan.password, function (evt) {
        if (evt.status === 0) {
            console.info("WIFI: DISCONNECTED");
            if (!configServerStarted) {
                retries++;
            }
            if (!configServerStarted && retries === 5) {
                if (config_1.config.ota.offline) {
                    stopWifi();
                    var programLoadedPrev = programLoaded;
                    programLoaded = true;
                    if (!programLoadedPrev) {
                        evalScript(el_load("config.script"));
                    }
                }
                else {
                    startSoftApMode();
                }
            }
        }
        else if (evt.status === 1) {
            if (!programLoaded) {
                console.info("WIFI: CONNECTED");
                if (!configServerStarted) {
                    configServer.startConfigServer();
                    configServerStarted = true;
                }
                retries = 0;
                if (config_1.config.ota.url) {
                    programLoaded = true;
                    console.info("Loading program from: " + config_1.config.ota.url.href);
                    var headers;
                    fetch(config_1.config.ota.url.href)
                        .then(function (r) {
                        headers = r.headers;
                        return r.text();
                    })
                        .then(function (data) {
                        if (config_1.config.ota.offline) {
                            el_store("config.script", data);
                            console.info("==> Saved offline script length=" + data.length);
                        }
                        else {
                            console.info("==> NOT saving offline script");
                        }
                        var dateString = headers.get("Date");
                        if (dateString) {
                            var now = parseDate(dateString);
                            setDateTimeInMillis(now.getTime());
                            setDateTimeZoneOffsetInHours(2);
                            console.debug("Setting date to " + new Date());
                        }
                        evalScript(data, headers);
                    })
                        .catch(function (error) {
                        console.error(error);
                        startSoftApMode();
                    });
                }
                else {
                    console.error("No OTA (Over-the-air) url specified.");
                    startSoftApMode();
                }
            }
        }
        else if (evt.status === 2) {
            console.info("WIFI: CONNECTING...");
        }
    });
}
function main() {
    if ((typeof KEY_BUILTIN !== "undefined" && digitalRead(KEY_BUILTIN) == 0) ||
        typeof config_1.config.wlan.ssid === "undefined") {
        console.info("Setup key pressed: Start soft ap...");
        startSoftApMode();
    }
    else {
        console.info("Trying to connect to Wifi from JS:");
        connectToWifi();
    }
}
module.exports = {
    main: main,
};
