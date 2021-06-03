Object.defineProperty(exports, "__esModule", { value: true });
exports.upgrade = void 0;
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
var http = require("./http");
function assertStatusCode(status, url) {
    return function (head) {
        var r = head && head.toString().match(/^HTTP\/[0-9.]+ ([0-9]+) (.*)/);
        if (!r || r[1] !== "" + status) {
            throw Error("Status " + (r && r[1]) + " for URL '" + url + "'");
        }
    };
}
function upgradeApp(handle, appImageUrl, submitSuccess, submitError) {
    var parsedAppImageUrl = urlparse(appImageUrl);
    parsedAppImageUrl.port = "" + http.getDefaultPort(parsedAppImageUrl);
    var offset = 0;
    var error = false;
    var client = http.httpClient(parsedAppImageUrl.protocol === "https", parsedAppImageUrl.hostname, parsedAppImageUrl.port, parsedAppImageUrl.pathname, "GET", undefined, // requestHeaders
    undefined, // body
    undefined, // success
    //error:
    function (message) {
        error = true;
        try {
            el_ota_end(handle);
        }
        catch (_) {
            //ignore
        }
        if (!client.cancelled) {
            console.error("Error loading ota firmware: " + message);
            submitError(message);
        }
    }, 
    //finish:
    function () {
        if (!error) {
            el_ota_end(handle);
            submitSuccess("app");
        }
    }, 
    //onData:
    function (data) {
        console.log("App download: " + Math.floor(offset / 1024) + " kb");
        el_ota_write(handle, data);
        offset += data.length;
    }, assertStatusCode(200, appImageUrl));
    return client;
}
function upgradeModules(partition, modulesImageUrl, submitSuccess, submitError) {
    var parsedModulesImageUrl = urlparse(modulesImageUrl);
    parsedModulesImageUrl.port = "" + http.getDefaultPort(parsedModulesImageUrl);
    var offset = 0;
    var error = false;
    var client = http.httpClient(parsedModulesImageUrl.protocol === "https", parsedModulesImageUrl.hostname, parsedModulesImageUrl.port, parsedModulesImageUrl.pathname, "GET", undefined, // requestHeaders
    undefined, // body
    undefined, // success
    //error:
    function (message) {
        error = true;
        if (!client.cancelled) {
            console.error("Error loading new modules firmware: " + message);
            submitError(message);
        }
    }, 
    //finish:
    function () {
        if (!error) {
            submitSuccess("modules");
        }
    }, 
    //onData:
    function (data) {
        console.log("Modules download: " + Math.floor(offset / 1024) + " kb");
        el_partition_write(partition, offset, data);
        offset += data.length;
    }, assertStatusCode(200, modulesImageUrl));
    return client;
}
exports.upgrade = function (appImageUrl, modulesImageUrl, onError, onFinish) {
    if (!el_is_native_ota_supported()) {
        onError && onError("Native OTA is not supported.");
        return;
    }
    console.log("Start native firmware upgrade:");
    console.log("App image: " + appImageUrl);
    console.log("Modules image: " + modulesImageUrl);
    var appImageUpdateCompleted = false;
    var modulesImageUpdateCompleted = false;
    var submitSuccess = function (type) {
        if (type === "app") {
            appImageUpdateCompleted = true;
            console.log("App image upgrade finished successfully.");
        }
        else if (type === "modules") {
            modulesImageUpdateCompleted = true;
            console.log("Modules image upgrade finished successfully.");
        }
        if (appImageUpdateCompleted && modulesImageUpdateCompleted) {
            el_ota_switch_boot_partition();
            console.log("Upgrade finished successfully. Please restart to start upgraded firmware.");
            onFinish && onFinish();
        }
    };
    var cancellable = [];
    var submitError = function (message) {
        console.error("Upgrading firmware failed: " + message);
        cancellable.forEach(function (c) { return c.cancel(); });
        onError && onError(message);
    };
    console.log("Erase 'App' flash partition...");
    var handle = el_ota_begin();
    var partition = el_ota_find_next_modules_partition();
    console.log("Erase 'Modules' flash partition...");
    el_partition_erase(partition);
    cancellable = [
        // this method starts the app upgrade async
        upgradeApp(handle, appImageUrl, submitSuccess, submitError),
        // this method starts the modules upgrade async
        upgradeModules(partition, modulesImageUrl, submitSuccess, submitError),
    ];
};
