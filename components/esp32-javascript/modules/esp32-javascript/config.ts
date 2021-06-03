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
import firmwareConfig from "./firmware-config";
export interface Esp32JsConfig {
  access: {
    username: string;
    password: string;
  };
  wifi?: {
    ssid?: string;
    password?: string;
    bssid?: string;
  };
  ota?: {
    url?: string;
    offline?: boolean;
    script?: string;
  };
}

const CONFIG_PATH = "/data/config.js";

export let config: Esp32JsConfig;

export function reloadConfig(): void {
  try {
    config = JSON.parse(readFile(CONFIG_PATH));
  } catch (error) {
    config = firmwareConfig;
    console.error(
      "Using default config. Seems like you never changed the config."
    );
  }
}

export function saveConfig(config: Esp32JsConfig): void {
  try {
    console.debug("Saving config.");
    writeFile(CONFIG_PATH, JSON.stringify(config));
    console.debug("Reloading config.");
    reloadConfig();
  } catch (error) {
    console.error("An error ocurred while saving config.");
  }
}
