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
import configManager = require("./config");
import { getBootTime } from "./boot";
import { upgrade } from "./native-ota";

import {
  httpServer,
  Esp32JsResponse,
  parseQueryStr,
  Esp32JsRequest,
} from "./http";
import {
  FILE_LOGGING_DIRECTORY,
  LOG_FILE_NUM_LIMIT,
  LOG_FILE_SIZE_LIMIT,
} from "./filelogging";

let schema = {
  access: {
    type: "object",
    options: {
      disable_collapse: true,
      disable_properties: true,
    },
    title: "Access",
    additionalProperties: false,
    required: ["username", "password"],
    properties: {
      username: {
        type: "string",
        title: "Username",
      },
      password: {
        type: "string",
        title: "Password",
      },
    },
  },
  wifi: {
    type: "object",
    options: {
      disable_collapse: true,
      disable_properties: true,
    },
    title: "WiFi",
    additionalProperties: false,
    required: ["ssid", "password"],
    properties: {
      ssid: {
        type: "string",
        title: "SSID",
      },
      password: {
        type: "string",
        title: "Password",
      },
      bssid: {
        type: "string",
        title: "BSSID",
      },
    },
  },
  ota: {
    type: "object",
    options: {
      disable_collapse: true,
      disable_properties: true,
    },
    title: "Ota",
    additionalProperties: false,
    required: ["url", "offline", "script"],
    properties: {
      url: {
        type: "string",
        title: "Firmware url",
      },
      offline: {
        type: "boolean",
        title: "Offline",
      },
      script: {
        type: "string",
        format: "textarea",
        title: "Offline",
      },
    },
  },
};

export function addSchema(additional: any): void {
  schema = { ...schema, ...additional };
}

export const requestHandler: ((
  req: Esp32JsRequest,
  res: Esp32JsResponse
) => void | boolean)[] = [];
export const baExceptionPathes: string[] = [];

export function redirect(res: Esp32JsResponse, location: string): void {
  res.setStatus(302);
  res.headers.set("location", location);
  res.headers.set("content-length", "0");
  res.end();
}

function page(
  res: Esp32JsResponse,
  headline: string,
  text: string | string[],
  cb?: () => void,
  additionalHeadTags?: string
) {
  if (cb) {
    // register callback
    res.on("end", cb);
  }

  res.setStatus(200);
  res.headers.set("content-type", "text/html");

  res.write(`<!doctype html><html><head><title>esp32-javascript</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
      <style>
      body {
        font-family: monospace;
        font-size: 13pt;
      }
      .input {
        font-family: monospace;
        font-size: 13pt;
      }
      .fill {
        width: calc(100% - 146px);
      }
      .full {
        width: calc(100% - 16px);
      }
      .txt {
        height: 100px;
      }
      .formlabel {
        display: inline-block;
      }
      .formpad {
        padding: 8px;
      }
      .green {
        color: green;
      }
      .red {
        color: red;
      }
      .inline-form {
        display: inline;
      }
      .blink {
        animation: blinkanimation 1s linear infinite;
      }
      .nowrap {
        white-space: nowrap;
      }
      @keyframes blinkanimation {
        50% {
          opacity: 0;
        }
      }
      </style>
      ${additionalHeadTags ? additionalHeadTags : ""}
      <script>
        function showpassword(label)
        {
          var inputId=label.parentElement.getAttribute("for");
          document.getElementById(inputId).setAttribute("type","text");
        }
      </script>
      </head>
      <body><div><div><div><h1>${headline}</h1>`);
  if (Array.isArray(text)) {
    res.write(text.join(""));
  } else {
    res.write(text);
  }
  res.end("</div></div></div></body></html>\r\n\r\n");
}

function getLogFileList() {
  global.el_flushLogBuffer();
  const logFileList: { filename: string; size: number | undefined }[] = [];
  try {
    const list = listDir(FILE_LOGGING_DIRECTORY).sort();
    list.forEach((f) => {
      try {
        logFileList.push({
          filename: f,
          size: fileSize(`${FILE_LOGGING_DIRECTORY}/${f}`),
        });
      } catch (error) {
        console.error(error);
      }
    });
  } catch (_) {
    // ignore
  }
  return logFileList;
}

const upgradeStatus: {
  status: "idle" | "error" | "success" | "inprogress";
  message: string;
} = {
  status: "idle",
  message: "",
};

let successMessage = "";
let errorMessage = "";
export function startConfigServer(): void {
  console.info("Starting config server.");
  const authString =
    "Basic " +
    btoa(
      configManager.config.access.username +
        ":" +
        configManager.config.access.password
    );
  httpServer(80, false, function (req, res) {
    if (
      req.headers.get("authorization") !== authString &&
      baExceptionPathes.indexOf(req.path) < 0
    ) {
      console.debug("401 response");
      res.setStatus(401);
      res.headers.set("WWW-Authenticate", 'Basic realm="Enter credentials"');
      res.end("401 Unauthorized");
    } else if (req.path === "/restart" && req.method === "POST") {
      page(
        res,
        "Restart",
        '<div class="formpad green">Restarting... please wait. <a href="/">Home</a></div>',
        function () {
          setTimeout(restart, 1000);
        }
      );
    } else if (req.path === "/setup" || req.path === "/restart") {
      if (req.path === "/setup" && req.method === "POST") {
        try {
          const storedConfig = configManager.config;
          if (!storedConfig.wifi) {
            storedConfig.wifi = {};
          }
          if (!storedConfig.ota) {
            storedConfig.ota = {};
          }

          const config = parseQueryStr(req.body);
          storedConfig.wifi.ssid = config.ssid;
          storedConfig.wifi.password = config.password;
          storedConfig.wifi.bssid = config.bssid;
          storedConfig.access.username = config.username;
          storedConfig.access.password = config.userpass;
          storedConfig.ota.url = config.url;
          storedConfig.ota.offline = config.offline === "true";
          storedConfig.ota.script = config.script;

          configManager.saveConfig(storedConfig);
          successMessage = "Saved. Some settings require a restart.";
        } catch (err) {
          errorMessage = err;
        }
      }
      const config = configManager.config;

      page(
        res,
        "Setup",
        `${
          successMessage
            ? `<div class="formpad green">${successMessage}</div>`
            : ""
        }${
          errorMessage ? `<div class="formpad red">${errorMessage}</div>` : ""
        }<h2>Configuration</h2><h3>Wifi</h3><form action="/setup" method="post">
        <div class="formpad"><label for="ssid" class="formlabel">SSID</label><br /><input type="text" name="ssid" class="full input" value="${
          config.wifi?.ssid || ""
        }" /></div>
        <div class="formpad"><label for="password" class="formlabel">Password (<a href="javascript:void(0)" onclick="showpassword(this)">Show</a>)</label><br /><input type="password" name="password" id="password" class="full input" value="${
          config.wifi?.password || ""
        }" /></div>
        <div class="formpad"><label for="bssid" class="formlabel">BSSID (optional)</label></br /><input type="text" name="bssid" class="full input" value="${
          config.wifi?.bssid || ""
        }" /></div>
        <h3>Basic authentication</h3>
        <div class="formpad"><label for="username" class="formlabel">Username</label></br /><input type="text" name="username" class="full input" value="${
          config.access.username
        }" /></div>
        <div class="formpad"><label for="userpass" class="formlabel">Password (<a href="javascript:void(0)" onclick="showpassword(this)">Show</a>)</label></br /><input type="password" name="userpass" id="userpass" class="full input" value="${
          config.access.password
        }" /></div>
        <h3>JavaScript OTA</h3><div class="formpad"><label for="url" class="formlabel">JS file url</label></br /><input type="text" name="url" class="full input" value="${
          config.ota?.url || ""
        }" /></div>
        <div class="formpad"><label for="offline"><input type="checkbox" name="offline" value="true" ${
          config.ota?.offline ? "checked" : ""
        }/> Offline Mode</label></div>
        <label for="script" class="formpad">Offline Script</label><div class="formpad"><textarea name="script" class="full input txt">${
          config.ota?.script || ""
        }</textarea></div>
        <div class="formpad"><input type="submit" value="Save" class="formpad input"/></div></form>
        <h2>Logs</h2>
        <div class="formpad">
          <p>
            Showing last ${LOG_FILE_NUM_LIMIT} log files, with each having maximum of ${
          LOG_FILE_SIZE_LIMIT / 1024
        } kB data.<br/>
          </p>
          ${getLogFileList()
            .map((e) => {
              return `<div>${e.filename} (${
                e.size === undefined ? "?" : Math.floor(e.size / 1024)
              } kB) <span class="nowrap"><form action="/viewlog" method="post" class="inline-form"><button class="input" type="submit" name="file" value="${FILE_LOGGING_DIRECTORY}/${
                e.filename
              }">View</button></form>&nbsp;<form action="/deletelog" method="post" class="inline-form"><button class="input" type="submit" name="file" value="${FILE_LOGGING_DIRECTORY}/${
                e.filename
              }">Delete</button></form></span></div>`;
            })
            .join("")}
          </form>
        </div>
        
        ${
          el_is_native_ota_supported()
            ? `<h2>Native OTA Upgrade</h2>
        <form action="/native-ota" method="post">
          <div class="formpad"><label for="appbin" class="formlabel">URL to app binary</label><br /><input type="text" name="appbin" class="full input" value="" /></div>
          <div class="formpad"><label for="modulesbin" class="formlabel">URL to modules binary</label><br /><input type="text" name="modulesbin" class="full input" value="" /></div>
          <div class="formpad"><input type="submit" value="Upgrade" class="formpad input" ${
            upgradeStatus.status === "inprogress" ? "disabled" : ""
          }/> ${
                upgradeStatus.status !== "idle"
                  ? '<a href="/native-ota">Upgrade status</a>'
                  : ""
              }</div>
        </form>`
            : ""
        }

        <h2>Request restart</h2>
        <form action="/restart" method="post"><div class="formpad"><input type="submit" value="Restart" class="formpad input"/></div></form>
        <h2>Uptime</h2>
        <div class="formpad">
          Boot time: ${getBootTime()}
        </div>
        <div class="formpad">
          Uptime (hours): ${
            Math.floor((Date.now() - getBootTime().getTime()) / 10 / 60 / 60) /
            100
          }<br />
        </div>
        <div class="formpad">
          Boot time is only available if a valid 'JS file url' is configured, otherwise it starts at unix epoch (1970).
        </div>`
      );
      successMessage = "";
      errorMessage = "";
    } else {
      let handled = false;
      for (let i = 0; i < requestHandler.length; i++) {
        if (!res.isEnded) {
          try {
            const reqHandled = requestHandler[i](req, res);
            handled = Boolean(handled || reqHandled);
          } catch (error) {
            const errorMessage = "Internal server error: " + error;
            console.error(errorMessage);
            if (!res.isEnded) {
              res.setStatus(500);
              res.headers.set("Content-type", "text/plain");
              res.end(errorMessage);
            }
          }
        }
      }
      if (!handled && !res.isEnded) {
        if (req.path === "/") {
          redirect(res, "/setup");
        } else {
          res.setStatus(404, "Not found");
          res.headers.set("Content-type", "text/plain");
          res.end("Not found");
        }
      }
    }
  });

  requestHandler.push((req, res) => {
    if (req.path === "/config") {
      res.setStatus(200);
      res.headers.set("Content-type", "text/html");
      res.end(`<html>
      <head>
        <title>Configuration</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
        <link 
          rel="stylesheet" 
          href="https://bootswatch.com/4/united/bootstrap.min.css" 
          crossorigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://use.fontawesome.com/releases/v5.6.1/css/all.css"
          crossorigin="anonymous"
        />
      </head>
      <body>
        <div class="container">
          <div id="editor_holder"></div>
          <p>
            <form action="/restart" method="post">
              <button
                type="button"
                class="btn btn-primary"
                onclick="save(editor.getValue())"
              >
                Save
              </button>
              <button
                type="submit"
                class="btn btn-secondary"
              >
                Restart
              </button>
            </form>
          </p>
        </div>
        <script
          src="https://code.jquery.com/jquery-3.2.1.slim.min.js"
          integrity="sha384-KJ3o2DKtIkvYIK3UENzmM7KCkRr/rE9/Qpg6aAZGJwFDMVNA/GpGFF93hXpG5KkN"
          crossorigin="anonymous"
        ></script>
        <script
          src="https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.12.9/umd/popper.min.js"
          integrity="sha384-ApNbgh9B+Y1QKtv3Rn7W3mgPxhU9K/ScQsAP7hUibX39j7fakFPskvXusvfa0b4Q"
          crossorigin="anonymous"
        ></script>
        <script
          src="https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/js/bootstrap.min.js"
          integrity="sha384-JZR6Spejh4U02d8jOt6vLEHfe/JQGiRRSQQxSfFWpi1MquVdAyjUar5+76PVCmYl"
          crossorigin="anonymous"
        ></script>
        <script src="https://cdn.jsdelivr.net/npm/@json-editor/json-editor@latest/dist/jsoneditor.min.js"
          crossorigin="anonymous"
        ></script>
        <script>
          const element = document.getElementById("editor_holder");
          const editor = new JSONEditor(element, 
            {
              theme: "bootstrap4",
              iconlib: "fontawesome5",
              disable_edit_json: true,
              disable_array_delete_all_rows: true,
              disable_array_delete_last_row: true,
              ajax: true,
              schema: {
                $schema: "http://json-schema.org/draft-07/schema",
                $ref: '/config/schema'
              }
            });
          editor.on('ready', () => {
            editor.disable();
            fetch('/config/current').then(r=>r.json()).then(data => {
              editor.setValue(data);
              editor.enable();
            });
          });

          function save(data)
          {
            fetch('/config/current', { method: 'POST', body: JSON.stringify(data)}).then(()=>alert('Saved. Some settings may require a restart.'));
          }
        </script>
      </body>
    </html>`);
    }
  });

  requestHandler.push((req, res) => {
    if (req.path === "/config/schema") {
      res.setStatus(200);
      res.headers.set("Content-type", "application/json");
      res.end(`
      {
        "type": "object",
        "format": "categories",
        "options": {
          "disable_collapse": true,
          "disable_properties": true
        },
        "title": "Configuration",
        "description": "Configure every aspect.",
        "additionalProperties": false,
        "required": ${JSON.stringify(Object.keys(schema))},
        "properties": ${JSON.stringify(schema)}
      }`);
    }
  });

  requestHandler.push((req, res) => {
    if (req.path === "/config/current") {
      if (req.method === "GET") {
        res.setStatus(200);
        res.headers.set("Content-type", "application/json");
        res.end(JSON.stringify(configManager.config));
      } else if (req.method === "POST") {
        try {
          if (req.body) {
            configManager.saveConfig(JSON.parse(req.body));
            res.setStatus(204);
            res.end();
          } else {
            res.setStatus(400);
            res.end("No config provided.");
          }
        } catch (error) {
          console.error(error);
          res.setStatus(500);
          res.end("Internal server error while saving configuration.");
        }
      }
    }
  });

  requestHandler.push((req, res) => {
    if (/\/viewlog/.exec(req.path)) {
      const parsed = parseQueryStr(req.body);
      if (parsed.file.indexOf(FILE_LOGGING_DIRECTORY) !== 0) {
        res.setStatus(400, "Invalid supplied filename.");
        res.end();
        return;
      }
      try {
        const content = readFile(parsed.file);
        res.setStatus(200);
        res.headers.set("Content-type", "text/plain");
        global.el_flushLogBuffer();
        res.write(content);
      } catch {
        res.setStatus(404, "Not found");
      } finally {
        res.end();
      }
    }
  });

  requestHandler.push((req, res) => {
    if (/\/deletelog/.exec(req.path)) {
      const parsed = parseQueryStr(req.body);
      if (parsed.file.indexOf(FILE_LOGGING_DIRECTORY) !== 0) {
        res.setStatus(400, "Invalid supplied filename.");
        res.end();
        return;
      }
      if (removeFile(parsed.file) >= 0) {
        successMessage = "Log file deleted successfully.";
      } else {
        errorMessage = "Log file not found.";
      }
      redirect(res, "/setup");
    }
  });

  requestHandler.push((req, res) => {
    if (/\/native-ota/.exec(req.path)) {
      if (req.method === "POST") {
        const parsed = parseQueryStr(req.body);

        if (parsed.appbin && parsed.modulesbin) {
          if (upgradeStatus.status !== "inprogress") {
            upgradeStatus.status = "inprogress";
            upgradeStatus.message = "";
            setTimeout(() => {
              upgrade(
                parsed.appbin,
                parsed.modulesbin,
                (error) => {
                  upgradeStatus.status = "error";
                  upgradeStatus.message = error;
                },
                () => {
                  upgradeStatus.status = "success";
                  upgradeStatus.message = "";
                }
              );
            }, 2000);
          }
        }
        redirect(res, "/native-ota");
      } else {
        page(
          res,
          "Upgrade",
          `${
            (upgradeStatus.status === "error" &&
              `<div class="formpad red">An error occured while upgrading: ${upgradeStatus.message}</div>`) ||
            (upgradeStatus.status === "success" &&
              `<div class="formpad green">Upgrade was successful. Please restart to start upgraded firmware.</div>
              <form action="/restart" method="post"><div class="formpad"><input type="submit" value="Restart" class="formpad input"/></div></form>`) ||
            (upgradeStatus.status === "inprogress" &&
              `<div class="formpad">Upgrade in progress<span class="blink">...</span><br/>Page refreshes automatically.</div>`) ||
            (upgradeStatus.status === "idle" &&
              `<div class="formpad red">No upgrade started.</div>`)
          }`,
          undefined,
          '<meta http-equiv="refresh" content="20">'
        );
      }
    }
  });
}
