/**
 *
 * A network based REPL (Read–eval–print loop).
 *
 * Usage:
 *     netcat [IP-ADDRESS] 1234
 *
 * After successful connection a prompt appears: '>'
 * Then type [USER]:[PASS] (the defaults are esp32:esp32)
 * After successful authentication you will see "====> authorized."
 *
 * After that you can type every JS expression, which then gets
 * evaluated in esp32-javascript and the result is printed.
 *
 * This is only considered as demo. If you want to use it in production 
 * please change the ssl flag to true, otherwise credentials 
 * are visible for "persons in the middle".
 */
var configManager = require("esp32-javascript/config");

var PROMPT = "> ";
var textDecoder = new TextDecoder();

function writeOutput(socket, result) {
  socket.write(result);
  socket.flush();
}

require("socket-events").sockListen(
  1234,
  function (socket) {
    var authorized = false;
    var _ = undefined;
    socket.onData = function (buffer) {
      var data = textDecoder.decode(buffer);
      var result = null;
      if (!authorized) {
        var accessConfig = configManager.config.access;
        if (
          data ===
          accessConfig.username + ":" + accessConfig.password + "\n"
        ) {
          authorized = true;
          result = "====> authorized.\n";
        } else {
          result = "ERR=> type [username]:[pass] to authorize.\n";
        }
      } else {
        try {
          var logOutput = [];
          (function () {
            var _console = console;
            try {
              console = {
                log: function (msg) {
                  _console.log(msg);
                  //writeOutput(socket, '|' + msg + '\n');
                  logOutput.push("LOG|" + msg + "\n");
                },
                debug: function (msg) {
                  _console.debug(msg);
                  //writeOutput(socket, "|" + msg + "\n");
                  logOutput.push("DEBUG|" + msg + "\n");
                },
                info: function (msg) {
                  _console.info(msg);
                  //writeOutput(socket, "|" + msg + "\n");
                  logOutput.push("INFO|" + msg + "\n");
                },
                warn: function (msg) {
                  _console.warn(msg);
                  //writeOutput(socket, "|" + msg + "\n");
                  logOutput.push("WARN|" + msg + "\n");
                },
                error: function (msg) {
                  _console.error(msg);
                  //writeOutput(socket, "|" + msg + "\n");
                  logOutput.push("ERROR|" + msg + "\n");
                },
              };
              _ = eval(data);
            } finally {
              console = _console;
            }
          })();
          result = logOutput.join("") + "====> " + _ + "\n";
        } catch (error) {
          result = logOutput.join("") + "ERR=> " + error + "\n";
        }
      }
      writeOutput(socket, result);
      writeOutput(socket, PROMPT);
    };
    // write initial prompt
    writeOutput(socket, PROMPT);
  },
  function (sockfd) {
    console.error("ON ERROR: Socket " + sockfd);
  },
  function () {
    console.debug("SOCKET WAS CLOSED!");
  },
  false
);
