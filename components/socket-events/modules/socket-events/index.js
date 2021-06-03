Object.defineProperty(exports, "__esModule", { value: true });
exports.sockListen = exports.sockConnect = exports.closeSocket = exports.sockets = void 0;
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
var sslClientCtx;
var NumberSet = /** @class */ (function () {
    function NumberSet() {
        this.set = [];
    }
    NumberSet.prototype.add = function (n) {
        if (this.set.indexOf(n) < 0) {
            this.set.push(n);
        }
    };
    NumberSet.prototype.remove = function (n) {
        var i = this.set.indexOf(n);
        if (i >= 0) {
            this.set.splice(i, 1);
        }
    };
    return NumberSet;
}());
var SocketLookupMap = /** @class */ (function () {
    function SocketLookupMap() {
        this.map = {};
    }
    SocketLookupMap.prototype.add = function (item) {
        this.map[item.sockfd] = item;
    };
    SocketLookupMap.prototype.get = function (sockfd) {
        return this.map[sockfd];
    };
    SocketLookupMap.prototype.remove = function (sockfd) {
        delete this.map[sockfd];
    };
    return SocketLookupMap;
}());
var ActiveSockets = /** @class */ (function () {
    function ActiveSockets() {
        this.activeSockets = new SocketLookupMap();
        // maintained socket status lists
        this.sst_notConnectedSockets = new NumberSet();
        this.sst_connectedSockets = new NumberSet();
        this.sst_connectedWritableSockets = new NumberSet();
    }
    ActiveSockets.prototype.maintainSocketStatus = function (sockfd, isListening, isConnected, isError, onWritable) {
        // check if socket is still a valid actual socket
        if (!this.get(sockfd)) {
            if (console.isDebug) {
                console.debug("Invalid sockfd " + sockfd + " given to maintain.");
            }
            return;
        }
        if (console.isDebug) {
            console.debug("Maintain socket status, sockfd: " + sockfd + ", isListening: " + isListening + ", isConnected: " + isConnected + ", isError: " + isError);
        }
        if (onWritable && isConnected && !isError) {
            this.sst_connectedWritableSockets.add(sockfd);
        }
        else {
            this.sst_connectedWritableSockets.remove(sockfd);
        }
        if (isConnected && !isError) {
            this.sst_connectedSockets.add(sockfd);
        }
        else {
            this.sst_connectedSockets.remove(sockfd);
        }
        if (!isConnected && !isListening && !isError) {
            this.sst_notConnectedSockets.add(sockfd);
        }
        else {
            this.sst_notConnectedSockets.remove(sockfd);
        }
    };
    ActiveSockets.prototype.add = function (item) {
        this.activeSockets.add(item);
        this.maintainSocketStatus(item.sockfd, item.isListening, item.isConnected, item.isError, item.onWritable);
    };
    ActiveSockets.prototype.remove = function (sockfd) {
        this.sst_connectedSockets.remove(sockfd);
        this.sst_notConnectedSockets.remove(sockfd);
        this.sst_connectedWritableSockets.remove(sockfd);
        this.activeSockets.remove(sockfd);
    };
    ActiveSockets.prototype.get = function (sockfd) {
        return this.activeSockets.get(sockfd);
    };
    return ActiveSockets;
}());
exports.sockets = new ActiveSockets();
/**
 * @class
 */
var Socket = /** @class */ (function () {
    function Socket() {
        this.defaultBufferSize = 3 * 1024;
        this.dataBuffer = new Uint8Array(this.defaultBufferSize);
        this.dataBufferSize = 0;
        this.textEncoder = new TextEncoder();
        this.writebuffer = [];
        this.readTimeout = -1; // infinite
        this.readTimeoutHandle = -1;
        /**
         * The socket file descriptor.
         * @type {number}
         */
        this.sockfd = -1;
        /**
         * The onData callback.
         * @type {module:socket-events~onDataCB}
         */
        this.onAccept = null;
        this.onData = null;
        this.onConnect = null;
        this.onError = null;
        this.onClose = null;
        this._onWritable = null;
        this._isConnected = false;
        this._isError = false;
        this._isListening = false;
        this.ssl = null;
        this.flushAlways = true;
    }
    Socket.prototype.setReadTimeout = function (readTimeout) {
        this.readTimeout = readTimeout;
        this.extendReadTimeout();
    };
    Socket.prototype.clearReadTimeoutTimer = function () {
        if (this.readTimeoutHandle >= 0) {
            clearTimeout(this.readTimeoutHandle);
        }
    };
    Socket.prototype.extendReadTimeout = function () {
        var _this = this;
        this.clearReadTimeoutTimer();
        if (this.readTimeout > 0) {
            this.readTimeoutHandle = setTimeout(function () {
                console.debug("Close socket because of read timeout.");
                closeSocket(_this);
            }, this.readTimeout);
        }
    };
    Socket.prototype.maintainSocketStatus = function () {
        exports.sockets.maintainSocketStatus(this.sockfd, this.isListening, this.isConnected, this.isError, this.onWritable);
    };
    Object.defineProperty(Socket.prototype, "isConnected", {
        get: function () {
            return this._isConnected;
        },
        set: function (isConnected) {
            this._isConnected = isConnected;
            this.maintainSocketStatus();
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Socket.prototype, "isListening", {
        get: function () {
            return this._isListening;
        },
        set: function (isListening) {
            this._isListening = isListening;
            this.maintainSocketStatus();
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Socket.prototype, "onWritable", {
        get: function () {
            return this._onWritable;
        },
        set: function (onWritable) {
            this._onWritable = onWritable;
            this.maintainSocketStatus();
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(Socket.prototype, "isError", {
        get: function () {
            return this._isError;
        },
        set: function (isError) {
            this._isError = isError;
            this.maintainSocketStatus();
        },
        enumerable: false,
        configurable: true
    });
    Socket.prototype.write = function (data) {
        if (this.dataBuffer) {
            if (typeof data === "undefined" || data === null) {
                return;
            }
            else if (Array.isArray(data)) {
                throw Error("arrays not allowed anymore");
            }
            else if (typeof data === "string") {
                // prevents size transmission problems for non-asci-data
                data = this.textEncoder.encode(data);
            }
            else if (Object.prototype.toString.call(data) !== "[object Uint8Array]") {
                throw Error("only strings and Uint8Array are supported");
            }
            // data is now always Uint8Array
            if (data.length + this.dataBufferSize > this.dataBuffer.length) {
                this.flush();
            }
            if (data.length > this.dataBuffer.length) {
                // enlarge default buffer
                this.dataBuffer = data;
            }
            else {
                this.dataBuffer.set(data, this.dataBufferSize);
            }
            this.dataBufferSize += data.length;
        }
    };
    Socket.prototype.flush = function (cb) {
        var onWritable = function (socket) {
            socket.onWritable = null;
            while (socket.writebuffer.length > 0) {
                var entry = socket.writebuffer[0];
                var written = entry.written;
                var data = entry.data;
                var len = entry.len;
                if (written < len) {
                    if (socket.sockfd === null) {
                        console.error("error writing to socket. not initialized.");
                        break;
                    }
                    else {
                        if (console.isDebug) {
                            console.debug("before write to socket");
                        }
                        var ret = writeSocket(socket.sockfd, data, len - written, written, socket.ssl);
                        if (console.isDebug) {
                            console.debug("after write to socket");
                        }
                        if (ret == 0) {
                            // eagain, return immediately and wait for futher onWritable calls
                            if (console.isDebug) {
                                console.debug("eagain in onWritable, socket " + socket.sockfd);
                            }
                            // wait for next select when socket is writable
                            break;
                        }
                        if (ret >= 0) {
                            written += ret;
                            entry.written = written;
                        }
                        else {
                            console.error("error writing to socket " + socket.sockfd + ", return value was " + ret);
                            break;
                        }
                    }
                }
                if (written >= len) {
                    // remove entry because it has been written completely.
                    if (console.isDebug) {
                        console.debug("// remove entry because it has been written completely.");
                    }
                    socket.writebuffer.shift();
                    if (entry.cb) {
                        entry.cb();
                    }
                }
            }
            var bufferEmpty = socket.writebuffer.length === 0;
            if (!bufferEmpty) {
                socket.onWritable = onWritable;
            }
            return bufferEmpty;
        };
        if (this.dataBufferSize > 0 && this.dataBuffer) {
            this.writebuffer.push({
                data: this.dataBuffer,
                written: 0,
                len: this.dataBufferSize,
                cb: cb,
            });
            var writtenCompletely = onWritable(this);
            if (!writtenCompletely) {
                // if not written completely the buffer was stored in write queue
                // and a new buffer must be created to prevent race conditions
                this.dataBuffer = new Uint8Array(this.defaultBufferSize);
            }
            this.dataBufferSize = 0;
        }
    };
    return Socket;
}());
function getOrCreateNewSocket() {
    return new Socket();
}
function performOnClose(socket) {
    if (socket && socket.onClose) {
        socket.onClose(socket.sockfd);
    }
}
/**
 * Flushes buffered writes, shutdowns SSL (if it is a secure socket),
 * close the socket, performs the close callback function, removes
 * socket from {@link module:socket-events.sockets}.
 *
 * @param {(module:socket-events~Socket|number)}
 */
function closeSocket(socketOrSockfd) {
    var socket;
    if (typeof socketOrSockfd === "number") {
        socket = exports.sockets.get(socketOrSockfd);
    }
    else if (typeof socketOrSockfd === "object") {
        socket = exports.sockets.get(socketOrSockfd.sockfd);
    }
    if (!socket) {
        console.debug("Socket not found for closing! Maybe already closed, doing nothing.");
        return;
    }
    //User should flush socket theirself
    //socket.flush();
    if (socket.ssl) {
        shutdownSSL(socket.ssl);
    }
    socket.clearReadTimeoutTimer();
    el_closeSocket(socket.sockfd);
    if (socket.ssl) {
        freeSSL(socket.ssl);
    }
    performOnClose(socket);
    resetSocket(socket);
}
exports.closeSocket = closeSocket;
/**
 * Connects to specified host and port.
 *
 * @param {boolean} ssl If we want to connect via SSL.
 * @param {string} host The remote hostname.
 * @param {number} port The remote port.
 * @param {module:socket-events~onConnectCB} onConnect A callback which gets called on connect event.
 * @param {module:socket-events~onDataCB} onData A callback which gets called on a data event.
 * @param {module:socket-events~onErrorCB} onError A callback which gets called on an error event.
 * @param {module:socket-events~onCloseCB} onClose A callback which gets called on a close event.
 *
 * @returns {module:socket-events~Socket} The socket.
 */
function sockConnect(ssl, host, port, onConnect, onData, onError, onClose) {
    var sockfd = el_createNonBlockingSocket();
    el_connectNonBlocking(sockfd, host, parseInt(port, 10));
    var socket = getOrCreateNewSocket();
    socket.sockfd = sockfd;
    socket.onData = onData;
    socket.onConnect = onConnect;
    socket.onError = onError;
    socket.onClose = onClose;
    socket.isConnected = false;
    socket.isError = false;
    socket.isListening = false;
    socket.ssl = null;
    if (ssl) {
        sslClientCtx =
            typeof sslClientCtx === "undefined"
                ? createSSLClientContext()
                : sslClientCtx;
        socket.ssl = createSSL(sslClientCtx, host);
        socket.onConnect = function (skt) {
            var result = connectSSL(skt.ssl, skt.sockfd);
            if (result == 0) {
                // retry
                return true;
            }
            else if (result < 0) {
                console.error("error connecting ssl: " + result);
                closeSocket(socket);
                return false;
            }
            else {
                return onConnect(skt);
            }
        };
    }
    exports.sockets.add(socket);
    return socket;
}
exports.sockConnect = sockConnect;
function sockListen(port, onAccept, onError, onClose, isSSL) {
    var sslCtx = null;
    if (isSSL) {
        sslCtx = createSSLServerContext();
    }
    var sockfd = el_createNonBlockingSocket();
    var ret = el_bindAndListen(sockfd, parseInt("" + port, 10));
    if (ret < 0) {
        if (onError) {
            onError(sockfd);
        }
        return null;
    }
    else {
        var socket = getOrCreateNewSocket();
        socket.sockfd = sockfd;
        socket.onAccept = function () {
            var ssl = null;
            if (isSSL) {
                ssl = createSSL(sslCtx);
            }
            var newsockfd = el_acceptIncoming(sockfd);
            if (newsockfd < 0) {
                console.error("accept returned: " + newsockfd);
                onError(sockfd);
            }
            else if (typeof newsockfd !== "undefined") {
                //EAGAIN
                var newSocket = getOrCreateNewSocket();
                newSocket.sockfd = newsockfd;
                newSocket.isConnected = false;
                newSocket.isError = false;
                newSocket.isListening = false;
                newSocket.ssl = ssl;
                exports.sockets.add(newSocket);
                if (onAccept) {
                    onAccept(newSocket);
                }
                if (isSSL) {
                    var sslConnected = acceptSSL(ssl, newsockfd);
                    if (sslConnected <= 0) {
                        closeSocket(newsockfd);
                    }
                }
            }
            else {
                if (console.isDebug) {
                    console.debug("EAGAIN received after accept...");
                }
            }
        };
        socket.onError = function (sockfd) {
            console.error("Default error handler: " + sockfd);
        };
        socket.onClose = function (sockfd) {
            console.info("Default close handler: " + sockfd);
        };
        socket.isConnected = true;
        socket.isError = false;
        socket.isListening = true;
        exports.sockets.add(socket);
        return socket;
    }
}
exports.sockListen = sockListen;
function resetSocket(socket) {
    if (console.isDebug) {
        console.debug("Reset Socket called on " + socket.sockfd);
    }
    if (socket) {
        exports.sockets.remove(socket.sockfd);
        return;
    }
    throw Error("invalid sockfd");
}
function beforeSuspend() {
    if (console.isDebug) {
        console.debug("Socket FDs for select.\n  not connected =>" + exports.sockets.sst_notConnectedSockets.set + "\n  connected     =>" + exports.sockets.sst_connectedSockets.set + "\n  connected wri =>" + exports.sockets.sst_connectedWritableSockets.set + "\n");
    }
    el_registerSocketEvents(exports.sockets.sst_notConnectedSockets.set, exports.sockets.sst_connectedSockets.set, exports.sockets.sst_connectedWritableSockets.set);
}
function afterSuspend(evt, collected) {
    if (evt.type === EL_SOCKET_EVENT_TYPE) {
        var socket_1 = exports.sockets.get(evt.fd);
        if (socket_1) {
            if (evt.status === 0) {
                //writable
                if (!socket_1.isConnected && socket_1.onConnect) {
                    collected.push(function () {
                        var retry = socket_1.onConnect(socket_1);
                        socket_1.isConnected = !retry;
                    });
                }
                else if (!socket_1.isConnected) {
                    socket_1.isConnected = true;
                }
                if (socket_1.isConnected && socket_1.onWritable) {
                    collected.push(function () {
                        socket_1.onWritable(socket_1);
                    });
                }
            }
            else if (evt.status === 1) {
                //readable
                if (socket_1.isListening && socket_1.onAccept) {
                    collected.push(socket_1.onAccept);
                }
                else {
                    if (console.isDebug) {
                        console.debug("before eventloop read socket");
                    }
                    var result = readSocket(socket_1.sockfd, socket_1.ssl);
                    if (console.isDebug) {
                        console.debug("after eventloop read socket");
                    }
                    if (result === null ||
                        (result &&
                            Object.prototype.toString.call(result.data) ===
                                "[object Uint8Array]" &&
                            result.length == 0)) {
                        if (console.isDebug) {
                            console.debug("Read EOF from " + socket_1.sockfd + ". Closing...");
                        }
                        closeSocket(socket_1.sockfd);
                    }
                    else if (!result) {
                        if (console.isDebug) {
                            console.debug("******** EAGAIN!!");
                        }
                    }
                    else {
                        if (socket_1.onData) {
                            socket_1.extendReadTimeout();
                            collected.push((function (data, fd, length) { return function () {
                                socket_1.onData(data, fd, length);
                            }; })(result.data, socket_1.sockfd, result.length));
                        }
                    }
                }
            }
            else if (evt.status === 2) {
                //error
                socket_1.isError = true;
                if (socket_1.onError) {
                    collected.push((function (sockfd) { return function () {
                        socket_1.onError(sockfd);
                    }; })(socket_1.sockfd));
                }
            }
            else {
                throw Error("UNKNOWN socket event status " + evt.status);
            }
        }
        return true;
    }
    return false;
}
esp32_js_eventloop_1.beforeSuspendHandlers.push(beforeSuspend);
esp32_js_eventloop_1.afterSuspendHandlers.push(afterSuspend);
