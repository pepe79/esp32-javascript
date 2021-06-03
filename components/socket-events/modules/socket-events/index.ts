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
import {
  beforeSuspendHandlers,
  afterSuspendHandlers,
} from "esp32-js-eventloop";

export type OnDataCB = (
  data: Uint8Array,
  sockfd: number,
  length: number
) => void;
export type OnConnectCB = (socket: Esp32JsSocket) => boolean | void;
export type OnErrorCB = (sockfd: number) => void;
export type OnCloseCB = (sockfd: number) => void;
export type OnAcceptCB = () => void;
export type OnWritableCB = (socket: Esp32JsSocket) => boolean;

export interface Esp32JsSocket {
  sockfd: number;
  onAccept: OnAcceptCB | null;
  onData: OnDataCB | null;
  onConnect: OnConnectCB | null;
  onError: OnErrorCB | null;
  onWritable: OnWritableCB | null;
  flush(cb?: () => void): void;
  write(data: string | Uint8Array): void;
  onClose: OnCloseCB | null;
  setReadTimeout(readTimeout: number): void;
  ssl: any;
  writebuffer: BufferEntry[];
}

let sslClientCtx: any;

class NumberSet {
  public set: number[] = [];
  public add(n: number) {
    if (this.set.indexOf(n) < 0) {
      this.set.push(n);
    }
  }
  public remove(n: number) {
    const i = this.set.indexOf(n);
    if (i >= 0) {
      this.set.splice(i, 1);
    }
  }
}

class SocketLookupMap {
  public map: { [key: string]: Socket } = {};
  public add(item: Socket): void {
    this.map[item.sockfd] = item;
  }
  public get(sockfd: number): Socket | undefined {
    return this.map[sockfd];
  }
  public remove(sockfd: number) {
    delete this.map[sockfd];
  }
}

class ActiveSockets {
  private activeSockets = new SocketLookupMap();

  // maintained socket status lists
  public sst_notConnectedSockets = new NumberSet();
  public sst_connectedSockets = new NumberSet();
  public sst_connectedWritableSockets = new NumberSet();

  maintainSocketStatus(
    sockfd: number,
    isListening: boolean,
    isConnected: boolean,
    isError: boolean,
    onWritable: OnWritableCB | null
  ) {
    // check if socket is still a valid actual socket
    if (!this.get(sockfd)) {
      if (console.isDebug) {
        console.debug(`Invalid sockfd ${sockfd} given to maintain.`);
      }
      return;
    }

    if (console.isDebug) {
      console.debug(
        `Maintain socket status, sockfd: ${sockfd}, isListening: ${isListening}, isConnected: ${isConnected}, isError: ${isError}`
      );
    }

    if (onWritable && isConnected && !isError) {
      this.sst_connectedWritableSockets.add(sockfd);
    } else {
      this.sst_connectedWritableSockets.remove(sockfd);
    }

    if (isConnected && !isError) {
      this.sst_connectedSockets.add(sockfd);
    } else {
      this.sst_connectedSockets.remove(sockfd);
    }

    if (!isConnected && !isListening && !isError) {
      this.sst_notConnectedSockets.add(sockfd);
    } else {
      this.sst_notConnectedSockets.remove(sockfd);
    }
  }

  public add(item: Socket) {
    this.activeSockets.add(item);
    this.maintainSocketStatus(
      item.sockfd,
      item.isListening,
      item.isConnected,
      item.isError,
      item.onWritable
    );
  }

  public remove(sockfd: number) {
    this.sst_connectedSockets.remove(sockfd);
    this.sst_notConnectedSockets.remove(sockfd);
    this.sst_connectedWritableSockets.remove(sockfd);

    this.activeSockets.remove(sockfd);
  }

  public get(sockfd: number): Socket | undefined {
    return this.activeSockets.get(sockfd);
  }
}
export const sockets = new ActiveSockets();

interface BufferEntry {
  written: number;
  data: Uint8Array;
  len: number;
  cb?: () => void;
}
/**
 * @class
 */
class Socket implements Esp32JsSocket {
  private defaultBufferSize = 3 * 1024;
  private dataBuffer = new Uint8Array(this.defaultBufferSize);
  private dataBufferSize = 0;
  private textEncoder = new TextEncoder();
  public writebuffer: BufferEntry[] = [];
  private readTimeout = -1; // infinite
  private readTimeoutHandle = -1;

  public setReadTimeout(readTimeout: number) {
    this.readTimeout = readTimeout;
    this.extendReadTimeout();
  }

  public clearReadTimeoutTimer() {
    if (this.readTimeoutHandle >= 0) {
      clearTimeout(this.readTimeoutHandle);
    }
  }

  public extendReadTimeout() {
    this.clearReadTimeoutTimer();
    if (this.readTimeout > 0) {
      this.readTimeoutHandle = setTimeout(() => {
        console.debug("Close socket because of read timeout.");
        closeSocket(this);
      }, this.readTimeout);
    }
  }

  /**
   * The socket file descriptor.
   * @type {number}
   */
  public sockfd = -1;

  /**
   * The onData callback.
   * @type {module:socket-events~onDataCB}
   */
  public onAccept: OnAcceptCB | null = null;
  public onData: OnDataCB | null = null;
  public onConnect: OnConnectCB | null = null;
  public onError: OnErrorCB | null = null;
  public onClose: OnCloseCB | null = null;
  private _onWritable: OnWritableCB | null = null;
  private _isConnected = false;
  public _isError = false;
  private _isListening = false;
  public ssl: any = null;
  public flushAlways = true;

  private maintainSocketStatus() {
    sockets.maintainSocketStatus(
      this.sockfd,
      this.isListening,
      this.isConnected,
      this.isError,
      this.onWritable
    );
  }

  public set isConnected(isConnected: boolean) {
    this._isConnected = isConnected;
    this.maintainSocketStatus();
  }

  public get isConnected() {
    return this._isConnected;
  }

  public set isListening(isListening: boolean) {
    this._isListening = isListening;
    this.maintainSocketStatus();
  }

  public get isListening() {
    return this._isListening;
  }

  public set onWritable(onWritable: OnWritableCB | null) {
    this._onWritable = onWritable;
    this.maintainSocketStatus();
  }

  public get onWritable() {
    return this._onWritable;
  }

  public set isError(isError: boolean) {
    this._isError = isError;
    this.maintainSocketStatus();
  }

  public get isError() {
    return this._isError;
  }

  public write(data: string | Uint8Array) {
    if (this.dataBuffer) {
      if (typeof data === "undefined" || data === null) {
        return;
      } else if (Array.isArray(data)) {
        throw Error("arrays not allowed anymore");
      } else if (typeof data === "string") {
        // prevents size transmission problems for non-asci-data
        data = this.textEncoder.encode(data);
      } else if (
        Object.prototype.toString.call(data) !== "[object Uint8Array]"
      ) {
        throw Error("only strings and Uint8Array are supported");
      }
      // data is now always Uint8Array

      if (data.length + this.dataBufferSize > this.dataBuffer.length) {
        this.flush();
      }
      if (data.length > this.dataBuffer.length) {
        // enlarge default buffer
        this.dataBuffer = data;
      } else {
        this.dataBuffer.set(data, this.dataBufferSize);
      }
      this.dataBufferSize += data.length;
    }
  }

  public flush(cb?: () => void) {
    const onWritable: OnWritableCB = function (socket: Esp32JsSocket) {
      socket.onWritable = null;

      while (socket.writebuffer.length > 0) {
        const entry = socket.writebuffer[0];
        let written = entry.written;
        const data = entry.data;
        const len = entry.len;

        if (written < len) {
          if (socket.sockfd === null) {
            console.error("error writing to socket. not initialized.");
            break;
          } else {
            if (console.isDebug) {
              console.debug("before write to socket");
            }
            const ret = writeSocket(
              socket.sockfd,
              data,
              len - written,
              written,
              socket.ssl
            );
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
            } else {
              console.error(
                `error writing to socket ${socket.sockfd}, return value was ${ret}`
              );
              break;
            }
          }
        }
        if (written >= len) {
          // remove entry because it has been written completely.
          if (console.isDebug) {
            console.debug(
              "// remove entry because it has been written completely."
            );
          }
          socket.writebuffer.shift();
          if (entry.cb) {
            entry.cb();
          }
        }
      }

      const bufferEmpty = socket.writebuffer.length === 0;
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
      const writtenCompletely = onWritable(this);
      if (!writtenCompletely) {
        // if not written completely the buffer was stored in write queue
        // and a new buffer must be created to prevent race conditions
        this.dataBuffer = new Uint8Array(this.defaultBufferSize);
      }
      this.dataBufferSize = 0;
    }
  }
}

function getOrCreateNewSocket() {
  return new Socket();
}

function performOnClose(socket: Esp32JsSocket) {
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

export function closeSocket(socketOrSockfd: Esp32JsSocket | number): void {
  let socket: Socket | undefined;
  if (typeof socketOrSockfd === "number") {
    socket = sockets.get(socketOrSockfd);
  } else if (typeof socketOrSockfd === "object") {
    socket = sockets.get(socketOrSockfd.sockfd);
  }

  if (!socket) {
    console.debug(
      "Socket not found for closing! Maybe already closed, doing nothing."
    );
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
export function sockConnect(
  ssl: boolean,
  host: string,
  port: string,
  onConnect: OnConnectCB,
  onData: (data: Uint8Array, sockfd: number, length: number) => void,
  onError: (sockfd: number) => void,
  onClose: () => void
): Esp32JsSocket {
  const sockfd = el_createNonBlockingSocket();
  el_connectNonBlocking(sockfd, host, parseInt(port, 10));

  const socket = getOrCreateNewSocket();
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
      const result = connectSSL(skt.ssl, skt.sockfd);
      if (result == 0) {
        // retry
        return true;
      } else if (result < 0) {
        console.error("error connecting ssl: " + result);
        closeSocket(socket);
        return false;
      } else {
        return onConnect(skt);
      }
    };
  }

  sockets.add(socket);
  return socket;
}

export function sockListen(
  port: string | number,
  onAccept: (socket: Esp32JsSocket) => void,
  onError: (sockfd: number) => void,
  onClose: (sockfd: number) => void,
  isSSL: boolean
): Esp32JsSocket | null {
  let sslCtx: any = null;
  if (isSSL) {
    sslCtx = createSSLServerContext();
  }

  const sockfd = el_createNonBlockingSocket();
  const ret = el_bindAndListen(sockfd, parseInt("" + port, 10));

  if (ret < 0) {
    if (onError) {
      onError(sockfd);
    }
    return null;
  } else {
    const socket = getOrCreateNewSocket();
    socket.sockfd = sockfd;

    socket.onAccept = function () {
      let ssl = null;
      if (isSSL) {
        ssl = createSSL(sslCtx);
      }
      const newsockfd = el_acceptIncoming(sockfd);
      if (newsockfd < 0) {
        console.error("accept returned: " + newsockfd);
        onError(sockfd);
      } else if (typeof newsockfd !== "undefined") {
        //EAGAIN
        const newSocket = getOrCreateNewSocket();
        newSocket.sockfd = newsockfd;
        newSocket.isConnected = false;
        newSocket.isError = false;
        newSocket.isListening = false;
        newSocket.ssl = ssl;

        sockets.add(newSocket);
        if (onAccept) {
          onAccept(newSocket);
        }
        if (isSSL) {
          const sslConnected = acceptSSL(ssl, newsockfd);
          if (sslConnected <= 0) {
            closeSocket(newsockfd);
          }
        }
      } else {
        if (console.isDebug) {
          console.debug("EAGAIN received after accept...");
        }
      }
    };
    socket.onError = function (sockfd) {
      console.error("Default error handler: " + sockfd);
    };
    socket.onClose = function (sockfd: number) {
      console.info("Default close handler: " + sockfd);
    };
    socket.isConnected = true;
    socket.isError = false;
    socket.isListening = true;

    sockets.add(socket);
    return socket;
  }
}

function resetSocket(socket: Socket) {
  if (console.isDebug) {
    console.debug(`Reset Socket called on ${socket.sockfd}`);
  }
  if (socket) {
    sockets.remove(socket.sockfd);
    return;
  }
  throw Error("invalid sockfd");
}

function beforeSuspend() {
  if (console.isDebug) {
    console.debug(`Socket FDs for select.
  not connected =>${sockets.sst_notConnectedSockets.set}
  connected     =>${sockets.sst_connectedSockets.set}
  connected wri =>${sockets.sst_connectedWritableSockets.set}
`);
  }

  el_registerSocketEvents(
    sockets.sst_notConnectedSockets.set,
    sockets.sst_connectedSockets.set,
    sockets.sst_connectedWritableSockets.set
  );
}

function afterSuspend(evt: Esp32JsEventloopEvent, collected: (() => void)[]) {
  if (evt.type === EL_SOCKET_EVENT_TYPE) {
    const socket = sockets.get(evt.fd);
    if (socket) {
      if (evt.status === 0) {
        //writable
        if (!socket.isConnected && socket.onConnect) {
          collected.push(() => {
            const retry = (socket.onConnect as OnConnectCB)(socket);
            socket.isConnected = !retry;
          });
        } else if (!socket.isConnected) {
          socket.isConnected = true;
        }
        if (socket.isConnected && socket.onWritable) {
          collected.push(() => {
            (socket.onWritable as OnWritableCB)(socket);
          });
        }
      } else if (evt.status === 1) {
        //readable
        if (socket.isListening && socket.onAccept) {
          collected.push(socket.onAccept);
        } else {
          if (console.isDebug) {
            console.debug("before eventloop read socket");
          }
          const result = readSocket(socket.sockfd, socket.ssl);
          if (console.isDebug) {
            console.debug("after eventloop read socket");
          }
          if (
            result === null ||
            (result &&
              Object.prototype.toString.call(result.data) ===
                "[object Uint8Array]" &&
              result.length == 0)
          ) {
            if (console.isDebug) {
              console.debug(`Read EOF from ${socket.sockfd}. Closing...`);
            }
            closeSocket(socket.sockfd);
          } else if (!result) {
            if (console.isDebug) {
              console.debug("******** EAGAIN!!");
            }
          } else {
            if (socket.onData) {
              socket.extendReadTimeout();
              collected.push(
                ((data, fd, length) => () => {
                  (socket.onData as OnDataCB)(data, fd, length);
                })(result.data, socket.sockfd, result.length)
              );
            }
          }
        }
      } else if (evt.status === 2) {
        //error
        socket.isError = true;
        if (socket.onError) {
          collected.push(
            ((sockfd) => () => {
              (socket.onError as OnErrorCB)(sockfd);
            })(socket.sockfd)
          );
        }
      } else {
        throw Error("UNKNOWN socket event status " + evt.status);
      }
    }
    return true;
  }
  return false;
}

beforeSuspendHandlers.push(beforeSuspend);
afterSuspendHandlers.push(afterSuspend);
