declare const KEY_BUILTIN: number | undefined;
declare const LED_BUILTIN: number | undefined;

declare const INPUT: number;
declare const OUTPUT: number;

declare let errorhandler: (error: Error) => void;

declare function pinMode(pin: number, direction: number): void;
declare function digitalWrite(pin: number, value: number): void;
declare function digitalRead(pin: number): number;
declare function stopWifi(): void;

declare function el_load(key: string): string;
declare function el_store(key: string, value: string): void;

declare function setDateTimeInMillis(time: number): void;
declare function setDateTimeZoneOffsetInHours(hours: number): void;
interface Esp32JsFirmwareDefaults {
  basicAuthUsername: string;
  basicAuthPassword: string;
}

declare function restart(): void;

interface Esp32JsEventloopEvent {
  type: number;
  status: number;
  fd: number;
}

declare function el_createTimer(timeout: number): number;
declare function el_removeTimer(handle: number): void;
declare function el_suspend(): Esp32JsEventloopEvent[];

declare function main(): void;

interface Esp32JsWifiConfig {
  bssid: [number, number, number, number, number, number];
}
declare function getWifiConfig(): Esp32JsWifiConfig;
declare const EL_WIFI_EVENT_TYPE: number;
declare const EL_TIMER_EVENT_TYPE: number;
declare const EL_LOG_EVENT_TYPE: number;
declare function el_connectWifi(
  ssid: string,
  password: string,
  bssid?: [number, number, number, number, number, number]
): void;
declare function el_createSoftAp(ssid: string, password: string): void;

declare function writeSocket(
  sockfd: number,
  data: Uint8Array,
  len: number,
  offset: number,
  ssl: boolean
): number;

declare function shutdownSSL(ref: any): void;
declare function freeSSL(ref: any): void;
declare function createSSLClientContext(): number;
declare function createSSL(clientContext: number, host?: string): number;
declare function connectSSL(sslHandle: number, sockfd: number): number;
declare function createSSLServerContext(): number;
declare function acceptSSL(ssl: any, newsockfd: number): number;

declare function el_closeSocket(sockfd: number): void;
declare function el_createNonBlockingSocket(): number;
declare function el_connectNonBlocking(
  sockfd: number,
  host: string,
  port: number
): void;
declare function el_bindAndListen(sockfd: number, port: number): number;
declare function el_acceptIncoming(sockfd: number): number;
declare function el_registerSocketEvents(
  notConnectedSockets: number[],
  connectedSockets: number[],
  connectedWritableSockets: number[]
): void;
declare const EL_SOCKET_EVENT_TYPE: number;
declare function readSocket(
  sockfd: number,
  ssl: any
): { data: Uint8Array; length: number };

declare function readFile(path: string): string;
declare function writeFile(path: string, data: string): number;
declare function appendFile(path: string, data: string): number;
declare function removeFile(path: string): number;
declare function fileSize(path: string): number;
declare function listDir(path: string): string[];
declare function mkdir(path: string): void;

// ota
declare function el_is_native_ota_supported(): boolean;
declare function el_ota_begin(): number;
declare function el_ota_write(handle: number, data: Uint8Array): number;
declare function el_ota_end(handle: number): number;
declare function el_ota_switch_boot_partition(): number;

declare function el_ota_find_next_modules_partition(): number;
declare function el_partition_erase(partition: number): void;
declare function el_partition_write(
  partition: number,
  offset: number,
  data: Uint8Array
): void;
declare function el_find_partition(name: string): {
  _ref: number;
  size: number;
};
declare function el_readAndFreeString(ptr: number): string;

interface Console {
  /*
   * Check if logger level is appropiate to print debug messsages.
   */
  isDebug: boolean;

  /*
   * Check if logger level is appropiate to print info messsages.
   */
  isInfo: boolean;

  /*
   * Check if logger level is appropiate to print warn messsages.
   */
  isWarn: boolean;

  /*
   * Check if logger level is appropiate to print error messsages.
   */
  isError: boolean;
}
