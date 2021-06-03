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
import { afterSuspendHandlers } from "esp32-js-eventloop";

/**
 * @module wifi-events
 */
interface Esp32JsWifiEvent {
  status: number;
}

interface Esp32JsWifi {
  status: (event: Esp32JsWifiEvent, ip: string | undefined) => void;
  ip: string | undefined;
}

let wifi: Esp32JsWifi | undefined = undefined;

function resetWifiStatus(
  callback: (event: Esp32JsWifiEvent, ip: string | undefined) => void
) {
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
export function connectWifi(
  ssid: string,
  password: string,
  callback: (event: Esp32JsWifiEvent, ip: string | undefined) => void,
  bssid?: string
): void {
  resetWifiStatus(callback);
  el_connectWifi(
    ssid,
    password,
    bssid ? convertBssidToArray(bssid) : undefined
  );
}

/**
 * Create soft AP with given ssid and password.
 *
 * @param ssid The ssid of the wifi network.
 * @param password The password of the wifi network.
 * @param {wifiStatusCallback} callback A cb which gets the connect status updates.
 */
export function createSoftAp(
  ssid: string,
  password: string,
  callback: (event: Esp32JsWifiEvent) => void
): void {
  resetWifiStatus(callback);
  el_createSoftAp(ssid, password);
}

/**
 * Get the bssid of the current connected wifi AP as formatted as hex string.
 * @returns The bssid.
 */
export function getBssid(): string | undefined {
  return convertBssidToString(getWifiConfig().bssid);
}

/**
 * Converts a 6 number array into a string representation of a BSSID.
 * @returns The bssid as string representation.
 */
export function convertBssidToString(
  bssid: [number, number, number, number, number, number]
): string | undefined {
  if (bssid.length == 6) {
    return bssid
      .map((n) => {
        const str = n.toString(16).toUpperCase();
        return str.length == 2 ? str : "0" + str;
      })
      .join(":");
  }
}

/**
 * Converts a bssid string representation in a 6 number array.
 * @returns The bssid as 6 number array.
 */
export function convertBssidToArray(
  bssid: string
): [number, number, number, number, number, number] | undefined {
  const bssidArray = bssid.split(":").map((s) => parseInt(s, 16));
  if (bssidArray.length == 6) {
    return bssidArray as [number, number, number, number, number, number];
  }
}

/**
 * Convert 32 bit number to ip address string.
 * @returns The ip address as string representation.
 */
function convertIPAddress(ip: number): string | undefined {
  if (ip > 0) {
    return (
      (ip & 0xff) +
      "." +
      ((ip >>> 8) & 0xff) +
      "." +
      ((ip >>> 16) & 0xff) +
      "." +
      ((ip >>> 24) & 0xff)
    );
  }
}

/**
 * Get the ip address.
 * @returns The ip address or undefined..
 */
export function getIPAddress(): string | undefined {
  return wifi?.ip;
}

function afterSuspend(evt: Esp32JsEventloopEvent, collected: (() => void)[]) {
  if (evt.type === EL_WIFI_EVENT_TYPE) {
    collected.push(() => {
      if (wifi) {
        const ip = convertIPAddress(evt.fd);
        wifi.ip = ip;
        wifi.status(evt, ip);
      }
    });
    return true;
  }
  return false;
}

afterSuspendHandlers.push(afterSuspend);
