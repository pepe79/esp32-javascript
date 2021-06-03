Object.defineProperty(exports, "__esModule", { value: true });
exports.start = exports.afterSuspendHandlers = exports.beforeSuspendHandlers = void 0;
errorhandler =
    typeof errorhandler === "undefined"
        ? function (error) {
            console.error("Uncaught error:");
            console.error(error.stack || error);
        }
        : errorhandler;
var timers = [];
var intervals = [];
var handles = 0;
exports.beforeSuspendHandlers = [];
exports.afterSuspendHandlers = [];
function setTimeout(fn, timeout) {
    var handle = el_createTimer(timeout);
    timers.push({
        timeout: Date.now() + timeout,
        fn: fn,
        handle: handle,
        installed: true,
    });
    return handle;
}
function clearTimeout(handle) {
    for (var i = 0; i < timers.length; i++) {
        if (timers[i].handle === handle) {
            var removed = timers.splice(i, 1);
            if (removed[0].installed) {
                el_removeTimer(handle);
            }
        }
    }
}
function clearInterval(handle) {
    var idx = intervals.indexOf(handle);
    if (idx >= 0) {
        intervals.splice(idx, 1);
    }
}
function installIntervalTimeout(handle, fn, timeout) {
    setTimeout(function () {
        if (intervals.indexOf(handle) >= 0) {
            fn();
            installIntervalTimeout(handle, fn, timeout);
        }
    }, timeout);
}
function setInterval(fn, timeout) {
    var handle = handles++;
    intervals.push(handle);
    installIntervalTimeout(handle, fn, timeout);
    return handle;
}
function el_select_next() {
    if (exports.beforeSuspendHandlers) {
        exports.beforeSuspendHandlers.forEach(function (h) {
            h();
        });
    }
    var events = el_suspend();
    var collected = [];
    var _loop_1 = function (evid) {
        var evt = events[evid];
        if (console.isDebug) {
            console.debug("== HANDLE EVENT: " + JSON.stringify(evt) + " ==");
        }
        if (evt.type === EL_TIMER_EVENT_TYPE) {
            //TIMER EVENT
            var nextTimer = null;
            for (var timerIdx = 0; timerIdx < timers.length; timerIdx++) {
                if (timers[timerIdx].handle === evt.status) {
                    nextTimer = timers.splice(timerIdx, 1)[0];
                    collected.push(nextTimer.fn);
                }
            }
            if (!nextTimer) {
                console.warn("UNKNOWN TIMER HANDLE:" +
                    JSON.stringify(evt) +
                    ";" +
                    JSON.stringify(timers));
            }
        }
        else if (evt.type === EL_LOG_EVENT_TYPE) {
            //LOG EVENT
            var logfunction = console.log;
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
        }
        else {
            var eventHandled_1 = false;
            if (exports.afterSuspendHandlers) {
                exports.afterSuspendHandlers.forEach(function (handleCustomEvent) {
                    if (typeof handleCustomEvent === "function") {
                        eventHandled_1 = eventHandled_1 || handleCustomEvent(evt, collected);
                    }
                });
            }
            if (!eventHandled_1) {
                throw Error("UNKNOWN eventType " + JSON.stringify(evt));
            }
        }
    };
    for (var evid = 0; evid < events.length; evid++) {
        _loop_1(evid);
    }
    return collected;
}
function start() {
    var nextfuncs = [main];
    for (;;) {
        if (Array.isArray(nextfuncs)) {
            nextfuncs.forEach(function (nf) {
                if (typeof nf === "function") {
                    try {
                        nf();
                    }
                    catch (error) {
                        errorhandler(error);
                    }
                }
            });
        }
        nextfuncs = el_select_next();
    }
}
exports.start = start;
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;
global.setInterval = setInterval;
global.clearInterval = clearInterval;
