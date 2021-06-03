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
import http = require("./http");
import { StringBuffer } from "./stringbuffer";

type SubmitFunction = (type: "app" | "modules") => void;
type SubmitErrorFunction = (message: string) => void;

function assertStatusCode(status: number, url: string) {
  return (head: StringBuffer) => {
    const r = head && head.toString().match(/^HTTP\/[0-9.]+ ([0-9]+) (.*)/);
    if (!r || r[1] !== "" + status) {
      throw Error(`Status ${r && r[1]} for URL '${url}'`);
    }
  };
}

function upgradeApp(
  handle: number,
  appImageUrl: string,
  submitSuccess: SubmitFunction,
  submitError: SubmitErrorFunction
) {
  const parsedAppImageUrl = urlparse(appImageUrl);
  parsedAppImageUrl.port = "" + http.getDefaultPort(parsedAppImageUrl);

  let offset = 0;
  let error = false;
  const client = http.httpClient(
    parsedAppImageUrl.protocol === "https",
    parsedAppImageUrl.hostname,
    parsedAppImageUrl.port,
    parsedAppImageUrl.pathname,
    "GET",
    undefined, // requestHeaders
    undefined, // body
    undefined, // success
    //error:
    (message) => {
      error = true;
      try {
        el_ota_end(handle);
      } catch (_) {
        //ignore
      }
      if (!client.cancelled) {
        console.error(`Error loading ota firmware: ${message}`);
        submitError(message);
      }
    },
    //finish:
    () => {
      if (!error) {
        el_ota_end(handle);
        submitSuccess("app");
      }
    },
    //onData:
    (data) => {
      console.log(`App download: ${Math.floor(offset / 1024)} kb`);
      el_ota_write(handle, data);
      offset += data.length;
    },
    assertStatusCode(200, appImageUrl)
  );
  return client;
}

function upgradeModules(
  partition: number,
  modulesImageUrl: string,
  submitSuccess: SubmitFunction,
  submitError: SubmitErrorFunction
) {
  const parsedModulesImageUrl = urlparse(modulesImageUrl);
  parsedModulesImageUrl.port = "" + http.getDefaultPort(parsedModulesImageUrl);

  let offset = 0;
  let error = false;
  const client = http.httpClient(
    parsedModulesImageUrl.protocol === "https",
    parsedModulesImageUrl.hostname,
    parsedModulesImageUrl.port,
    parsedModulesImageUrl.pathname,
    "GET",
    undefined, // requestHeaders
    undefined, // body
    undefined, // success
    //error:
    (message) => {
      error = true;
      if (!client.cancelled) {
        console.error(`Error loading new modules firmware: ${message}`);
        submitError(message);
      }
    },
    //finish:
    () => {
      if (!error) {
        submitSuccess("modules");
      }
    },
    //onData:
    (data) => {
      console.log(`Modules download: ${Math.floor(offset / 1024)} kb`);
      el_partition_write(partition, offset, data);
      offset += data.length;
    },
    assertStatusCode(200, modulesImageUrl)
  );
  return client;
}

export const upgrade = (
  appImageUrl: string,
  modulesImageUrl: string,
  onError: (message: string) => void,
  onFinish: () => void
): void => {
  if (!el_is_native_ota_supported()) {
    onError && onError("Native OTA is not supported.");
    return;
  }

  console.log(`Start native firmware upgrade:`);
  console.log(`App image: ${appImageUrl}`);
  console.log(`Modules image: ${modulesImageUrl}`);

  let appImageUpdateCompleted = false;
  let modulesImageUpdateCompleted = false;

  const submitSuccess: SubmitFunction = (type) => {
    if (type === "app") {
      appImageUpdateCompleted = true;
      console.log("App image upgrade finished successfully.");
    } else if (type === "modules") {
      modulesImageUpdateCompleted = true;
      console.log("Modules image upgrade finished successfully.");
    }

    if (appImageUpdateCompleted && modulesImageUpdateCompleted) {
      el_ota_switch_boot_partition();
      console.log(
        "Upgrade finished successfully. Please restart to start upgraded firmware."
      );
      onFinish && onFinish();
    }
  };

  let cancellable: { cancel: () => void }[] = [];
  const submitError: SubmitErrorFunction = (message) => {
    console.error(`Upgrading firmware failed: ${message}`);

    cancellable.forEach((c) => c.cancel());
    onError && onError(message);
  };

  console.log("Erase 'App' flash partition...");
  const handle = el_ota_begin();

  const partition = el_ota_find_next_modules_partition();
  console.log("Erase 'Modules' flash partition...");
  el_partition_erase(partition);

  cancellable = [
    // this method starts the app upgrade async
    upgradeApp(handle, appImageUrl, submitSuccess, submitError),
    // this method starts the modules upgrade async
    upgradeModules(partition, modulesImageUrl, submitSuccess, submitError),
  ];
};
