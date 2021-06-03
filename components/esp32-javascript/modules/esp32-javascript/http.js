Object.defineProperty(exports, "__esModule", { value: true });
exports.XMLHttpRequest = exports.getDefaultPort = exports.httpClient = exports.parseQueryStr = exports.decodeQueryParam = exports.httpServer = void 0;
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
var socketEvents = require("socket-events");
var chunked_1 = require("./chunked");
var stringbuffer_1 = require("./stringbuffer");
var sockListen = socketEvents.sockListen;
var sockConnect = socketEvents.sockConnect;
var closeSocket = socketEvents.closeSocket;
function parseHeaders(complete, endOfHeaders) {
    var headersRaw = complete.substring(0, endOfHeaders).toString();
    var headerTokens = headersRaw.split("\r\n");
    var statusLine = headerTokens.shift();
    var headers = new Headers();
    headerTokens.forEach(function (headerLine) {
        var delim = headerLine.indexOf(":");
        if (delim >= 0) {
            headers.append(headerLine.substring(0, delim).trim(), headerLine.substring(delim + 1).trim());
        }
    });
    return {
        statusLine: statusLine,
        headers: headers,
    };
}
var EventEmitter = /** @class */ (function () {
    function EventEmitter() {
        this.listener = {};
    }
    EventEmitter.prototype.on = function (event, cb) {
        (this.listener[event] = this.listener[event] || []).push(cb);
    };
    EventEmitter.prototype.emit = function (event) {
        console.debug("Event " + event + " emitted: ");
        var eventListener = this.listener[event];
        if (Array.isArray(eventListener)) {
            console.debug(eventListener.length + " listeners active.");
            eventListener.forEach(function (cb) { return setTimeout(cb, 0); });
        }
    };
    return EventEmitter;
}());
function httpServer(port, isSSL, cb) {
    var textEncoder = new TextEncoder();
    var textDecoder = new TextDecoder();
    sockListen(port, function (socket) {
        var requestCounter = 0;
        var complete = null;
        var contentLength = 0;
        var headers;
        var statusLine;
        var gotten = 0;
        var active = [];
        socket.onData = function (data, _, length) {
            complete = complete
                ? complete.append(textDecoder.decode(data))
                : new stringbuffer_1.StringBuffer(textDecoder.decode(data));
            gotten += length;
            var endOfHeaders = complete.indexOf("\r\n\r\n");
            if (gotten >= 4 && endOfHeaders >= 0) {
                if (!headers) {
                    var parsed = parseHeaders(complete, endOfHeaders);
                    statusLine = parsed.statusLine;
                    headers = parsed.headers;
                    requestCounter++;
                    console.debug("Request on socket " + socket.sockfd + ": " + statusLine + ", requestCounter:" + requestCounter);
                }
                var postedData = null;
                var contentLengthHeader = headers.get("content-length");
                if (typeof contentLengthHeader === "string") {
                    contentLength = parseInt(contentLengthHeader);
                }
                if (contentLength > 0) {
                    if (console.isDebug) {
                        console.debug("A request body is expected.");
                    }
                    if (gotten >= endOfHeaders + 4 + contentLength) {
                        var potentialRequestBody = textEncoder.encode(complete.substring(endOfHeaders + 4).toString());
                        postedData = textDecoder.decode(potentialRequestBody.subarray(0, contentLength));
                        if (console.isDebug) {
                            console.debug("Request body is complete:");
                            console.debug(postedData);
                        }
                    }
                    else {
                        //wait for more data to come (body of  a POST request)
                        if (console.isDebug) {
                            console.debug("Waiting for more data to come:");
                        }
                        return;
                    }
                }
                if (statusLine) {
                    var startOfPath = statusLine.indexOf(" ");
                    var path = statusLine.substring(startOfPath + 1, statusLine.indexOf(" ", startOfPath + 1));
                    var method = complete.substring(0, startOfPath).toString();
                    var req_1 = {
                        method: method,
                        path: path,
                        body: postedData,
                        headers: headers,
                    };
                    var eventEmitter_1 = new EventEmitter();
                    var responseHeaders_1 = new Headers();
                    var chunkedEncoding_1 = false;
                    var isConnectionClose_1 = function () {
                        var close = false;
                        if (!close && headers && headers.get("connection") === "close") {
                            close = true;
                        }
                        if (!close &&
                            responseHeaders_1 &&
                            responseHeaders_1.get("transfer-encoding") !== "chunked" &&
                            !responseHeaders_1.has("content-length")) {
                            close = true;
                        }
                        if (!close &&
                            responseHeaders_1 &&
                            responseHeaders_1.get("connection") === "close") {
                            close = true;
                        }
                        return close;
                    };
                    var chunked_2 = function () {
                        var chunked = true;
                        if (chunked && headers && headers.get("connection") === "close") {
                            chunked = false;
                        }
                        if (chunked &&
                            responseHeaders_1 &&
                            ((responseHeaders_1.has("transfer-encoding") &&
                                responseHeaders_1.get("transfer-encoding") !== "chunked") ||
                                responseHeaders_1.has("content-length"))) {
                            chunked = false;
                        }
                        if (chunked &&
                            responseHeaders_1 &&
                            responseHeaders_1.get("connection") === "close") {
                            chunked = false;
                        }
                        return chunked;
                    };
                    // initialize response
                    var res_1 = {
                        headers: responseHeaders_1,
                        isEnded: false,
                        statusWritten: false,
                        headersWritten: false,
                        status: { status: 200, statusText: "OK" },
                        on: function (event, cb) {
                            eventEmitter_1.on(event, cb);
                        },
                        flush: function () {
                            socket.flush();
                        },
                        setStatus: function (status, statusText) {
                            res_1.status.status = status;
                            if (statusText) {
                                res_1.status.statusText = statusText;
                            }
                        },
                        write: function (data) {
                            if (res_1.isEnded) {
                                throw Error("request has already ended");
                            }
                            if (!res_1.statusWritten) {
                                res_1.statusWritten = true;
                                socket.write("HTTP/1.1 " + res_1.status.status + " " + res_1.status.statusText + "\r\n");
                            }
                            if (!res_1.headersWritten) {
                                if (chunked_2()) {
                                    responseHeaders_1.set("transfer-encoding", "chunked");
                                    chunkedEncoding_1 = true;
                                }
                                if (isConnectionClose_1()) {
                                    responseHeaders_1.set("connection", "close");
                                }
                                if (!responseHeaders_1.has("connection")) {
                                    responseHeaders_1.set("connection", "keep-alive");
                                    socket.setReadTimeout(22222); // set to a non-standard timeout
                                }
                                var contentType = responseHeaders_1.get("content-type");
                                if (typeof contentType !== "string") {
                                    responseHeaders_1.set("content-type", "text/plain; charset=utf-8");
                                }
                                else if (contentType.indexOf("charset") < 0) {
                                    responseHeaders_1.set("content-type", contentType + "; charset=utf-8");
                                }
                                res_1.headersWritten = true;
                                responseHeaders_1.forEach(function (value, key) {
                                    socket.write(key + ": " + value + "\r\n");
                                });
                                socket.write("\r\n");
                            }
                            if (typeof data !== "undefined" && data.length > 0) {
                                if (chunkedEncoding_1) {
                                    var encoded = typeof data === "string"
                                        ? textEncoder.encode(data)
                                        : data;
                                    socket.write(encoded.length.toString(16) + "\r\n");
                                }
                                if (data) {
                                    socket.write(data);
                                }
                                if (chunkedEncoding_1) {
                                    socket.write("\r\n");
                                    //socket.flush();
                                }
                            }
                        },
                        end: function (data) {
                            res_1.write(data);
                            if (chunkedEncoding_1) {
                                socket.write("0\r\n");
                                socket.write("\r\n");
                            }
                            socket.flush(function () {
                                if (isConnectionClose_1()) {
                                    console.debug("Socket " + socket.sockfd + " closed.");
                                    closeSocket(socket.sockfd);
                                }
                                res_1.isEnded = true;
                                eventEmitter_1.emit("end");
                            });
                        },
                    };
                    // reset state for keep alive connections getting more requests
                    // on the same socket
                    complete = complete.substring(endOfHeaders + 4 + contentLength);
                    gotten = gotten - endOfHeaders - 4 - contentLength;
                    contentLength = 0;
                    headers = undefined;
                    statusLine = undefined;
                    var item_1 = { req: req_1, res: res_1 };
                    var num = active.push(item_1);
                    if (console.isDebug) {
                        console.debug("Currently active requests: " + num);
                    }
                    res_1.on("end", function () {
                        if (console.isDebug) {
                            console.debug("splicing req/res form active list");
                        }
                        active.splice(active.indexOf(item_1), 1);
                    });
                    var previous = num - 2;
                    if (previous < 0 || active[previous].res.isEnded) {
                        // active request/response is empty, perform immediately
                        if (console.isDebug) {
                            console.debug("// active request/response is empty or entries are ended, perform immediately");
                        }
                        setTimeout(function () {
                            if (console.isDebug) {
                                console.debug("perform immediate");
                            }
                            cb(req_1, res_1);
                        }, 0);
                    }
                    else {
                        // queue request/response callback after previous request/response
                        if (console.isDebug) {
                            console.debug("// queue request/response callback after previous request/response");
                        }
                        active[previous].res.on("end", function () {
                            if (console.isDebug) {
                                console.debug("end of previous req/res: triggering new req/res callback");
                            }
                            cb(req_1, res_1);
                        });
                    }
                    if (gotten > 0 && socket.onData) {
                        socket.onData(new Uint8Array(0), _, 0);
                    }
                }
            }
        };
        socket.onError = function (sockfd) {
            console.error("NEW SOCK: ON ERROR: " + sockfd);
        };
    }, function (sockfd) {
        console.error("ON ERROR: Socket " + sockfd);
    }, function () {
        console.info("SOCKET WAS CLOSED!");
    }, isSSL);
}
exports.httpServer = httpServer;
function decodeQueryParam(value) {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
}
exports.decodeQueryParam = decodeQueryParam;
function parseQueryStr(query) {
    var parsed = {};
    if (query) {
        var keyValues = query.split("&");
        keyValues.forEach(function (val) {
            var splitted = val.split("=");
            parsed[splitted[0]] =
                splitted.length > 1 ? decodeQueryParam(splitted[1]) : "";
        });
    }
    return parsed;
}
exports.parseQueryStr = parseQueryStr;
function httpClient(ssl, host, port, path, method, requestHeaders, body, successCB, // this is removed in favor of the new data and head callback (dataCB, headCB)
errorCB, finishCB, dataCB, headCB) {
    if (successCB) {
        throw Error("The successCB is not supported anymore.");
    }
    var complete = new stringbuffer_1.StringBuffer();
    var completeLength = 0;
    var chunked = false;
    var headerRead = false;
    var headerEnd = -1;
    var contentLength = -1;
    requestHeaders = requestHeaders || "";
    var headers;
    var chunkedConsumer;
    if (!errorCB) {
        errorCB = print;
    }
    var textDecoder = new TextDecoder();
    var socket = sockConnect(ssl, host, port, function (socket) {
        var bodyStr = body ? body.toString() : null;
        var requestLines = method + " " + path + " HTTP/1.1\r\nHost: " + host + "\r\n" + (bodyStr ? "Content-length: " + bodyStr.length + "\r\n" : "") + requestHeaders + "\r\n" + (bodyStr ? bodyStr + "\r\n" : "");
        socket.write(requestLines);
        socket.flush();
    }, function (data, sockfd, length) {
        try {
            complete === null || complete === void 0 ? void 0 : complete.append(textDecoder.decode(data));
            completeLength = completeLength + length;
            if (!headerRead &&
                complete &&
                (headerEnd = complete.indexOf("\r\n\r\n")) >= 0) {
                headerRead = true;
                chunked =
                    complete.toLowerCase().indexOf("transfer-encoding: chunked") >= 0;
                var clIndex = complete.toLowerCase().indexOf("content-length: ");
                if (clIndex >= 0) {
                    var endOfContentLength = complete.indexOf("\r\n", clIndex);
                    contentLength = parseInt(complete.substring(clIndex + 15, endOfContentLength).toString());
                }
                headerEnd += 4;
                headers = complete.substring(0, headerEnd);
                complete = undefined;
                if (headCB) {
                    headCB(headers);
                }
                if (chunked) {
                    chunkedConsumer = chunked_1.createChunkedEncodingConsumer(dataCB);
                }
                // the rest of the data is considered data and has to be consumed by the data consumers.
                data = data.subarray(headerEnd, data.length);
            }
            if (chunkedConsumer) {
                // handle chunked data
                var eof = chunkedConsumer(data);
                if (eof) {
                    closeSocket(sockfd);
                }
            }
            else if (dataCB) {
                // handle non chunked data
                dataCB(data);
            }
            if (contentLength >= 0) {
                if (completeLength - headerEnd == contentLength) {
                    closeSocket(sockfd);
                }
            }
        }
        catch (error) {
            if (errorCB) {
                errorCB(error);
            }
            closeSocket(sockfd);
        }
    }, function () {
        if (errorCB) {
            errorCB("Could not load " + (ssl ? "https" : "http") + "://" + host + ":" + port + path);
        }
    }, function () {
        if (finishCB) {
            finishCB();
        }
    });
    var client = {
        cancelled: false,
        cancel: function () {
            if (!client.cancelled) {
                client.cancelled = true;
                if (errorCB) {
                    errorCB("Request was cancelled.");
                }
                closeSocket(socket);
            }
        },
    };
    return client;
}
exports.httpClient = httpClient;
// get default port
function getDefaultPort(url) {
    var port = parseInt(url.port, 10);
    if (isNaN(port)) {
        if (url.protocol === "https:") {
            port = 443;
        }
        else if (url.protocol === "http:") {
            port = 80;
        }
        else {
            throw Error("Cannot determine default port for protocol " + url.protocol);
        }
    }
    return port;
}
exports.getDefaultPort = getDefaultPort;
var XMLHttpRequest = /** @class */ (function () {
    function XMLHttpRequest() {
        this.method = "GET";
    }
    XMLHttpRequest.prototype.send = function (body) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        var self = this;
        if (this.url) {
            var data_1 = undefined;
            var responseHeaders_2 = undefined;
            var textDecoder_1 = new TextDecoder();
            httpClient(this.url.protocol === "https:", this.url.hostname, this.url.port, this.url.pathname + this.url.search, this.method, this.requestHeaders ? this.requestHeaders.toString() : undefined, body, undefined, function (error) {
                console.error(error);
                if (self.onerror) {
                    self.onerror(error);
                }
            }, function () {
                var r = responseHeaders_2 &&
                    responseHeaders_2.toString().match(/^HTTP\/[0-9.]+ ([0-9]+) (.*)/);
                if (r) {
                    self.status = parseInt(r[1], 10);
                    self.statusText = r[2];
                    self.responseURL = "";
                    self.responseText = data_1 && data_1.toString();
                    self.reponseHeaders =
                        responseHeaders_2 &&
                            responseHeaders_2.substring(r[0].length + 2).toString();
                    if (self.onload) {
                        self.onload();
                    }
                }
                else {
                    if (self.onerror) {
                        self.onerror("Bad http status line.");
                    }
                }
                data_1 = undefined;
                responseHeaders_2 = undefined;
            }, function (dataIn) {
                if (data_1) {
                    data_1.append(textDecoder_1.decode(dataIn));
                }
                else {
                    data_1 = new stringbuffer_1.StringBuffer(textDecoder_1.decode(dataIn));
                }
            }, function (head) {
                responseHeaders_2 = head;
            });
        }
        else {
            if (self.onerror) {
                self.onerror("Url unset.");
            }
        }
    };
    XMLHttpRequest.prototype.getAllResponseHeaders = function () {
        return this.reponseHeaders;
    };
    XMLHttpRequest.prototype.open = function (method, url) {
        this.method = method;
        this.url = urlparse(url);
        // check protocol
        if (this.url.protocol !== "http:" && this.url.protocol !== "https:") {
            throw Error("Unsupported protocol for esp32 fetch implementation: " + this.url.protocol);
        }
        var port = getDefaultPort(this.url);
        this.url.port = "" + port;
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        this.requestHeaders = this.requestHeaders || new stringbuffer_1.StringBuffer();
        this.requestHeaders.append(name).append(": ").append(value).append("\r\n");
    };
    return XMLHttpRequest;
}());
exports.XMLHttpRequest = XMLHttpRequest;
