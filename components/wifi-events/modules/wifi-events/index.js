Object.defineProperty(exports, "__esModule", { value: true });
exports.getIPAddress = exports.convertBssidToArray = exports.convertBssidToString = exports.getBssid = exports.createSoftAp = exports.connectWifi = void 0;
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
var esp32_js_eventloop_1 = require("esp32-js-eventloop");
var wifi = undefined;
function resetWifiStatus(callback) {
    wifi = {
        status: callback,
        ip: undefined,
    };
    return wifi;
}
/**
 * Connect to AP with given ssid and password.
 *
 * @param ssid The ssid of the wifi network.
 * @param password The password of the wifi network.
 * @param {wifiStatusCallback} callback A cb which gets the connect status updates.
 * @param bssid Optional bssid to pin to a specific AP.
 */
function connectWifi(ssid, password, callback, bssid) {
    resetWifiStatus(callback);
    el_connectWifi(ssid, password, bssid ? convertBssidToArray(bssid) : undefined);
}
exports.connectWifi = connectWifi;
/**
 * Create soft AP with given ssid and password.
 *
 * @param ssid The ssid of the wifi network.
 * @param password The password of the wifi network.
 * @param {wifiStatusCallback} callback A cb which gets the connect status updates.
 */
function createSoftAp(ssid, password, callback) {
    resetWifiStatus(callback);
    el_createSoftAp(ssid, password);
}
exports.createSoftAp = createSoftAp;
/**
 * Get the bssid of the current connected wifi AP as formatted as hex string.
 * @returns The bssid.
 */
function getBssid() {
    return convertBssidToString(getWifiConfig().bssid);
}
exports.getBssid = getBssid;
/**
 * Converts a 6 number array into a string representation of a BSSID.
 * @returns The bssid as string representation.
 */
function convertBssidToString(bssid) {
    if (bssid.length == 6) {
        return bssid
            .map(function (n) {
            var str = n.toString(16).toUpperCase();
            return str.length == 2 ? str : "0" + str;
        })
            .join(":");
    }
}
exports.convertBssidToString = convertBssidToString;
/**
 * Converts a bssid string representation in a 6 number array.
 * @returns The bssid as 6 number array.
 */
function convertBssidToArray(bssid) {
    var bssidArray = bssid.split(":").map(function (s) { return parseInt(s, 16); });
    if (bssidArray.length == 6) {
        return bssidArray;
    }
}
exports.convertBssidToArray = convertBssidToArray;
/**
 * Convert 32 bit number to ip address string.
 * @returns The ip address as string representation.
 */
function convertIPAddress(ip) {
    if (ip > 0) {
        return ((ip & 0xff) +
            "." +
            ((ip >>> 8) & 0xff) +
            "." +
            ((ip >>> 16) & 0xff) +
            "." +
            ((ip >>> 24) & 0xff));
    }
}
/**
 * Get the ip address.
 * @returns The ip address or undefined..
 */
function getIPAddress() {
    return wifi === null || wifi === void 0 ? void 0 : wifi.ip;
}
exports.getIPAddress = getIPAddress;
function afterSuspend(evt, collected) {
    if (evt.type === EL_WIFI_EVENT_TYPE) {
        collected.push(function () {
            if (wifi) {
                var ip = convertIPAddress(evt.fd);
                wifi.ip = ip;
                wifi.status(evt, ip);
            }
        });
        return true;
    }
    return false;
}
esp32_js_eventloop_1.afterSuspendHandlers.push(afterSuspend);
