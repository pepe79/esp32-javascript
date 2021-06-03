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
interface Esp32JsTimer {
  handle: number;
  timeout: number;
  fn: () => void;
  installed: boolean;
}

type Esp32JsEventHandler = (
  event: Esp32JsEventloopEvent,
  collected: (() => void)[]
) => boolean;

errorhandler =
  typeof errorhandler === "undefined"
    ? function (error) {
        console.error("Uncaught error:");
        console.error(error.stack || error);
      }
    : errorhandler;

const timers: Esp32JsTimer[] = [];
const intervals: number[] = [];
let handles = 0;
export const beforeSuspendHandlers: (() => void)[] = [];
export const afterSuspendHandlers: Esp32JsEventHandler[] = [];

function setTimeout(fn: () => void, timeout: number) {
  const handle = el_createTimer(timeout);
  timers.push({
    timeout: Date.now() + timeout,
    fn: fn,
    handle: handle,
    installed: true,
  });
  return handle;
}

function clearTimeout(handle: number) {
  for (let i = 0; i < timers.length; i++) {
    if (timers[i].handle === handle) {
      const removed = timers.splice(i, 1);
      if (removed[0].installed) {
        el_removeTimer(handle);
      }
    }
  }
}

function clearInterval(handle: number) {
  const idx = intervals.indexOf(handle);
  if (idx >= 0) {
    intervals.splice(idx, 1);
  }
}

function installIntervalTimeout(
  handle: number,
  fn: () => void,
  timeout: number
) {
  setTimeout(function () {
    if (intervals.indexOf(handle) >= 0) {
      fn();
      installIntervalTimeout(handle, fn, timeout);
    }
  }, timeout);
}

function setInterval(fn: () => void, timeout: number) {
  const handle = handles++;
  intervals.push(handle);
  installIntervalTimeout(handle, fn, timeout);
  return handle;
}

function el_select_next() {
  if (beforeSuspendHandlers) {
    beforeSuspendHandlers.forEach(function (h) {
      h();
    });
  }

  const events = el_suspend();

  const collected: (() => void)[] = [];
  for (let evid = 0; evid < events.length; evid++) {
    const evt = events[evid];
    if (console.isDebug) {
      console.debug(`== HANDLE EVENT: ${JSON.stringify(evt)} ==`);
    }
    if (evt.type === EL_TIMER_EVENT_TYPE) {
      //TIMER EVENT
      let nextTimer = null;
      for (let timerIdx = 0; timerIdx < timers.length; timerIdx++) {
        if (timers[timerIdx].handle === evt.status) {
          nextTimer = timers.splice(timerIdx, 1)[0];
          collected.push(nextTimer.fn);
        }
      }
      if (!nextTimer) {
        console.warn(
          "UNKNOWN TIMER HANDLE:" +
            JSON.stringify(evt) +
            ";" +
            JSON.stringify(timers)
        );
      }
    } else if (evt.type === EL_LOG_EVENT_TYPE) {
      //LOG EVENT
      let logfunction = console.log;
      switch (evt.status) {
        case 1:
          logfunction = console.debug;
          break;
        case 2:
          logfunction = console.info;
          break;
        case 3:
          logfunction = console.warn;
          break;
        case 4:
          logfunction = console.error;
          break;
      }
      logfunction(el_readAndFreeString(evt.fd));
    } else {
      let eventHandled = false;
      if (afterSuspendHandlers) {
        afterSuspendHandlers.forEach(function (
          handleCustomEvent: Esp32JsEventHandler
        ) {
          if (typeof handleCustomEvent === "function") {
            eventHandled = eventHandled || handleCustomEvent(evt, collected);
          }
        });
      }

      if (!eventHandled) {
        throw Error("UNKNOWN eventType " + JSON.stringify(evt));
      }
    }
  }
  return collected;
}

export function start(): void {
  let nextfuncs: (() => void)[] = [main];
  for (;;) {
    if (Array.isArray(nextfuncs)) {
      nextfuncs.forEach(function (nf) {
        if (typeof nf === "function") {
          try {
            nf();
          } catch (error) {
            errorhandler(error);
          }
        }
      });
    }
    nextfuncs = el_select_next();
  }
}

global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.setInterval = setInterval;
global.clearInterval = clearInterval;
