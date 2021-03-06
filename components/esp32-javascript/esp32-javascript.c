/*
MIT License

Copyright (c) 2020 Marcel Kottmann

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

#include "sdkconfig.h"
#include <stdio.h>
#include <string.h>
#include <stddef.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_system.h"
#include <duktape.h>
#include "esp_event.h"
#include "esp_system.h"
#if CONFIG_IDF_TARGET_ESP32S2
#include "esp32s2/spiram.h"
#else
#include "esp32/spiram.h"
#endif
#include "esp_log.h"
#include "esp_newlib.h"
#include "nvs_flash.h"
#include "freertos/timers.h"
#include "nvs.h"
#include "esp32-hal-gpio.h"
#include "esp32-hal-ledc.h"
#include "pins_arduino.h"
#include "duk_module_node.h"
#include "esp32-javascript.h"
#include "esp32-js-log.h"
#include "libb64/cdecode.h"
#include "libb64/cencode.h"

static const char *tag = "esp32-javascript";

// global task handle
TaskHandle_t task;
xQueueHandle el_event_queue;

bool flag = false;
bool spiramAvailable = false;
duk_context *ctx = NULL;

// only for debug purposes
bool DISABLE_EVENTS = false;

void jslog(log_level_t level, const char *msg, ...)
{
    char *my_string;
    va_list argp;

    va_start(argp, msg);
    vasprintf(&my_string, msg, argp);
    va_end(argp);

    TaskHandle_t current = xTaskGetCurrentTaskHandle();

    if (ctx && current == task) // prevent race conditions with ctx from different tasks
    {
        if (level == DEBUG)
        {
            duk_push_string(ctx, "console.debug");
        }
        else if (level == INFO)
        {
            duk_push_string(ctx, "console.info");
        }
        else if (level == WARN)
        {
            duk_push_string(ctx, "console.warn");
        }
        else
        {
            duk_push_string(ctx, "console.error");
        }
        duk_eval(ctx); /* -> [ ... func ] */
        duk_push_string(ctx, my_string);
        duk_call(ctx, 1);
    }
    else
    {
        if (level == DEBUG)
        {
            ESP_LOGD(tag, "No ctx present: %s", my_string);
        }
        else if (level == INFO)
        {
            ESP_LOGI(tag, "No ctx present: %s", my_string);
        }
        else if (level == WARN)
        {
            ESP_LOGW(tag, "No ctx present: %s", my_string);
        }
        else
        {
            ESP_LOGE(tag, "No ctx present: %s", my_string);
        }
    }
    free(my_string);
}

static duk_ret_t console_debug_binding(duk_context *ctx)
{
    ESP_LOGD(tag, "%s", duk_to_string(ctx, 0));
    return 0;
}
static duk_ret_t console_info_binding(duk_context *ctx)
{
    ESP_LOGI(tag, "%s", duk_to_string(ctx, 0));
    return 0;
}
static duk_ret_t console_warn_binding(duk_context *ctx)
{
    ESP_LOGW(tag, "%s", duk_to_string(ctx, 0));
    return 0;
}
static duk_ret_t console_error_binding(duk_context *ctx)
{
    ESP_LOGE(tag, "%s", duk_to_string(ctx, 0));
    return 0;
}

void IRAM_ATTR el_add_event(js_eventlist_t *events, js_event_t *event)
{
    if (events->events_len >= MAX_EVENTS)
    {
        jslog(ERROR, "Event queue full. Max event number: %d => aborting.\n", MAX_EVENTS);
        abort();
    }
    events->events[events->events_len] = *event;
    events->events_len = events->events_len + 1;
}

void IRAM_ATTR el_fire_events(js_eventlist_t *events)
{
    if (DISABLE_EVENTS)
    {
        jslog(WARN, "Events are disabled. They will never be fired.\n");
    }
    else
    {
        if (events->events_len > 0)
        {
            jslog(DEBUG, "Send %d events to queue...\n", events->events_len);
            int ret = xQueueSendFromISR(el_event_queue, events, NULL);
            if (ret != pdTRUE)
            {
                jslog(ERROR, "Event queue is full... is something blocking the event loop?...aborting.\n");
                abort();
            }
        }
    }
}

void IRAM_ATTR el_create_event(js_event_t *event, int type, int status, void *fd)
{
    event->type = type;
    event->status = status;
    event->fd = fd;
}

void IRAM_ATTR vTimerCallback(TimerHandle_t xTimer)
{
    js_event_t event;
    js_eventlist_t events;

    xTimerDelete(xTimer, portMAX_DELAY);

    el_create_event(&event, EL_TIMER_EVENT_TYPE, (int)xTimer, 0);
    events.events_len = 0;
    el_add_event(&events, &event);
    el_fire_events(&events);
}

int createTimer(int timer_period_us)
{
    int interval = timer_period_us / portTICK_PERIOD_MS;

    TimerHandle_t tmr = xTimerCreate("", interval <= 0 ? 1 : interval, pdFALSE, NULL, vTimerCallback);

    if (interval <= 0)
    {
        // fire event immediatley without starting the timer
        vTimerCallback(tmr);
    }
    else
    {
        if (xTimerStart(tmr, portMAX_DELAY) != pdPASS)
        {
            jslog(ERROR, "Timer start error");
        }
    }
    return (int)tmr;
}

static duk_ret_t el_load(duk_context *ctx)
{
    int ret = 0;
    esp_err_t err;

    const char *key = duk_to_string(ctx, 0);

    nvs_handle my_handle;
    err = nvs_open("esp32js2", NVS_READONLY, &my_handle);
    if (err == ESP_ERR_NVS_NOT_FOUND)
    {
        duk_push_undefined(ctx);
        return 1;
    }
    else if (err != ESP_OK)
    {
        jslog(ERROR, "Error (%d) opening NVS!\n", err);
        return -1;
    }

    size_t string_size;
    err = nvs_get_blob(my_handle, key, NULL, &string_size);
    if (err == ESP_ERR_NVS_NOT_FOUND)
    {
        duk_push_undefined(ctx);
        ret = 1;
    }
    else if (err != ESP_OK)
    {
        jslog(ERROR, "Cannot get key %s from storage, err=%d\n", key, err);
        ret = -1;
    }
    else
    {
        char *value = (char *)malloc(string_size);
        err = nvs_get_blob(my_handle, key, value, &string_size);
        if (err != ESP_OK)
        {
            jslog(ERROR, "Cannot get key %s from storage, err=%d\n", key, err);
            ret = -1;
        }
        else
        {
            duk_push_string(ctx, value);
            ret = 1;
        }
        free(value);
    }
    nvs_close(my_handle);
    return ret;
}

static duk_ret_t el_store(duk_context *ctx)
{
    int ret = 0;
    esp_err_t err;

    const char *key = duk_to_string(ctx, 0);
    if (strlen(key) > 15)
    {
        jslog(ERROR, "Keys may not be longer than 15 chars. Key '%s' is longer.\n", key);
        return -1;
    }

    const char *value = duk_to_string(ctx, 1);
    int len = strlen(value);
    if (len > (1984 - 1))
    {
        jslog(ERROR, "Values may not be longer than 1984 chars (including zero-termination). Current string length is %d\n", len);
        return -1;
    }

    jslog(DEBUG, "Opening Non-Volatile Storage (NVS) ... ");
    nvs_handle my_handle;
    err = nvs_open("esp32js2", NVS_READWRITE, &my_handle);
    if (err != ESP_OK)
    {
        jslog(ERROR, "Error (%d) opening NVS!\n", err);
        return -1;
    }

    err = nvs_set_blob(my_handle, key, (void *)value, len + 1);
    if (err != ESP_OK)
    {
        jslog(ERROR, "Cannot set key %s and value %s from storage, err=%d\n", key, value, err);
        ret = -1;
    }

    err = nvs_commit(my_handle);
    if (err != ESP_OK)
    {
        jslog(ERROR, "Cannot commit changes, err=%d\n", err);
        ret = -1;
    }
    nvs_close(my_handle);
    return ret;
}

static duk_ret_t native_delay(duk_context *ctx)
{
    int delay = duk_to_int32(ctx, 0);
    jslog(DEBUG, "Waiting %dms...\n", delay);
    if (delay < 0)
    {
        delay = 0;
    }
    vTaskDelay(delay / portTICK_PERIOD_MS);
    return 0;
}

static duk_ret_t el_createTimer(duk_context *ctx)
{
    int delay = duk_to_int32(ctx, 0);
    if (delay < 0)
    {
        delay = 0;
    }
    jslog(DEBUG, "Install timer to notify in  %dms.\n", delay);
    int handle = createTimer(delay);
    duk_push_int(ctx, handle);
    return 1;
}

static duk_ret_t el_removeTimer(duk_context *ctx)
{
    int handle = duk_to_int32(ctx, 0);
    xTimerDelete((TimerHandle_t)handle, portMAX_DELAY);
    return 0;
}

static void createConsole(duk_context *ctx)
{
    duk_idx_t obj_idx = duk_push_object(ctx);

    duk_push_c_function(ctx, console_info_binding, 1);
    duk_put_prop_string(ctx, obj_idx, "log");
    duk_push_c_function(ctx, console_debug_binding, 1);
    duk_put_prop_string(ctx, obj_idx, "debug");
    duk_push_c_function(ctx, console_info_binding, 1);
    duk_put_prop_string(ctx, obj_idx, "info");
    duk_push_c_function(ctx, console_warn_binding, 1);
    duk_put_prop_string(ctx, obj_idx, "warn");
    duk_push_c_function(ctx, console_error_binding, 1);
    duk_put_prop_string(ctx, obj_idx, "error");

    duk_put_global_string(ctx, "console");
}

static duk_ret_t el_suspend(duk_context *ctx)
{
    // force garbage collection 2 times see duktape doc
    // greatly increases perfomance with external memory
    duk_gc(ctx, 0);
    duk_gc(ctx, 0);
    // feed watchdog
    //vTaskDelay(1);

    // jslog(INFO, "Free memory: %d bytes", esp_get_free_heap_size());
    js_eventlist_t events;

    jslog(DEBUG, "Waiting for events...\n");

    xQueueReceive(el_event_queue, &events, portMAX_DELAY);

    jslog(DEBUG, "Receiving %d events.\n", events.events_len);

    int arr_idx = duk_push_array(ctx);
    for (int i = 0; i < events.events_len; i++)
    {
        duk_idx_t obj_idx = duk_push_object(ctx);

        duk_push_int(ctx, events.events[i].type);
        duk_put_prop_string(ctx, obj_idx, "type");
        duk_push_int(ctx, events.events[i].status);
        duk_put_prop_string(ctx, obj_idx, "status");
        duk_push_int(ctx, (int)events.events[i].fd);
        duk_put_prop_string(ctx, obj_idx, "fd");

        duk_put_prop_index(ctx, arr_idx, i);
    }

    return 1;
}

static duk_ret_t el_pinMode(duk_context *ctx)
{
    int pin = duk_to_int(ctx, 0);
    int dir = duk_to_int(ctx, 1);

    jslog(DEBUG, "el_pinMode pin=%d dir=%d\n", pin, dir);

    pinMode(pin, dir);
    return 0;
}

static duk_ret_t el_digitalWrite(duk_context *ctx)
{
    int pin = duk_to_int(ctx, 0);
    int level = duk_to_int(ctx, 1);

    jslog(DEBUG, "el_digitalWrite pin=%d level=%d\n", pin, level);

    digitalWrite(pin, level);
    return 0;
}

static duk_ret_t el_digitalRead(duk_context *ctx)
{
    int pin = duk_to_int(ctx, 0);

    jslog(DEBUG, "el_digitalRead pin=%d\n", pin);

    int val = digitalRead(pin);
    duk_push_int(ctx, val);
    return 1;
}

static duk_ret_t el_ledcSetup(duk_context *ctx)
{
    int channel = duk_to_int(ctx, 0);
    int freq = duk_to_int(ctx, 1);
    int resolution = duk_to_int(ctx, 2);

    jslog(DEBUG, "el_ledcSetup channel=%d freq=%d resolution=%d \n", channel, freq, resolution);

    ledcSetup(channel, freq, resolution);
    return 0;
}

static duk_ret_t el_ledcAttachPin(duk_context *ctx)
{
    int pin = duk_to_int(ctx, 0);
    int channel = duk_to_int(ctx, 1);

    jslog(DEBUG, "el_ledcAttachPin pin=%d channel=%d\n", pin, channel);

    ledcAttachPin(pin, channel);
    return 0;
}

static duk_ret_t el_ledcWrite(duk_context *ctx)
{
    int channel = duk_to_int(ctx, 0);
    int dutyCycle = duk_to_int(ctx, 1);

    jslog(DEBUG, "el_ledcWrite channel=%d dutyCycle=%d \n", channel, dutyCycle);

    ledcWrite(channel, dutyCycle);
    return 0;
}

static duk_ret_t info(duk_context *ctx)
{
    size_t internal = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    size_t external = heap_caps_get_free_size(MALLOC_CAP_SPIRAM);

    jslog(INFO, "INTERNAL MEMORY HEAP INFO FREE: %d", internal);
    jslog(INFO, "EXTERNAL MEMORY HEAP INFO FREE: %d", external);

    return 0;
}

static duk_ret_t el_restart(duk_context *ctx)
{
    esp_restart();
    return 0;
}

static void my_fatal(void *udata, const char *msg)
{
    (void)udata; /* ignored in this case, silence warning */

    /* Note that 'msg' may be NULL. */
    jslog(ERROR, "*** FATAL ERROR: %s\n", (msg ? msg : "no message"));
    abort();
}

static duk_ret_t setDateTimeInMillis(duk_context *ctx)
{
    double timeInMillis = duk_to_number(ctx, 0);
    struct timeval tv;
    tv.tv_sec = (time_t)(timeInMillis / (double)1000.0);
    tv.tv_usec = 0;
    settimeofday(&tv, NULL);
    return 0;
}

static duk_ret_t setDateTimeZoneOffsetInHours(duk_context *ctx)
{
    uint16_t offset = duk_to_uint16(ctx, 0);
    duk_dateTimeZoneOffsetInHours = offset;
    return 0;
}

void loadJS(duk_context *ctx, const char *name, char *start, char *end)
{
    const unsigned int length = end - start - 1;
    jslog(INFO, "Loading %s ...\n", name);
    duk_eval_lstring_noresult(ctx, start, length);
}

void loadUrlPolyfill(duk_context *ctx)
{
    extern char _start[] asm("_binary_urlparse_js_start");
    extern char _end[] asm("_binary_urlparse_js_end");
    loadJS(ctx, "urlparse.js", _start, _end);
}

duk_ret_t btoa(duk_context *ctx)
{
    const char *str = duk_to_string(ctx, 0);
    int length = strlen(str);
    size_t size = base64_encode_expected_len(length) + 1;
    char *buffer = (char *)spiram_malloc(size * sizeof(char));
    if (buffer)
    {
        base64_encodestate _state;
        base64_init_encodestate(&_state);
        int len = base64_encode_block((const char *)&str[0], length, &buffer[0], &_state);
        base64_encode_blockend((buffer + len), &_state);

        duk_push_lstring(ctx, buffer, size - 1);
        free(buffer);
        return 1;
    }
    jslog(ERROR, "malloc returned NULL\n");
    return -1;
}

duk_ret_t atob(duk_context *ctx)
{
    const char *str = duk_to_string(ctx, 0);
    int length = strlen(str);
    size_t size = base64_decode_expected_len(length);
    char *buffer = (char *)spiram_malloc(size);
    if (buffer)
    {
        base64_decodestate _state;
        base64_init_decodestate(&_state);
        base64_decode_block((const char *)&str[0], length, &buffer[0], &_state);

        duk_push_lstring(ctx, buffer, size);
        return 1;
    }
    jslog(ERROR, "malloc returned NULL\n");
    return -1;
}

IRAM_ATTR void *duk_spiram_malloc(void *udata, size_t size)
{
    if (spiramAvailable)
    {
        return heap_caps_malloc(size, MALLOC_CAP_SPIRAM);
    }
    else
    {
        return malloc(size);
    }
}
IRAM_ATTR void *spiram_malloc(size_t size)
{
    return duk_spiram_malloc(NULL, size);
}

IRAM_ATTR void *duk_spiram_realloc(void *udata, void *ptr, size_t size)
{
    if (spiramAvailable)
    {
        return heap_caps_realloc(ptr, size, MALLOC_CAP_SPIRAM);
    }
    else
    {
        return realloc(ptr, size);
    }
}
IRAM_ATTR void *spiram_realloc(void *ptr, size_t size)
{
    return duk_spiram_realloc(NULL, ptr, size);
}

IRAM_ATTR void duk_spiram_free(void *udata, void *ptr)
{
    if (spiramAvailable)
    {
        heap_caps_free(ptr);
    }
    else
    {
        free(ptr);
    }
}
IRAM_ATTR void spiram_free(void *ptr)
{
    duk_spiram_free(NULL, ptr);
}

bool spiramAvail()
{
    void *ptr = heap_caps_malloc(1, MALLOC_CAP_SPIRAM);
    if (ptr != NULL)
    {
        heap_caps_free(ptr);
        return true;
    }
    return false;
}

void duktape_task(void *ignore)
{
    spiramAvailable = spiramAvail();
    ctx = duk_create_heap(duk_spiram_malloc, duk_spiram_realloc, duk_spiram_free, NULL, my_fatal);

    createConsole(ctx);

    duk_push_c_function(ctx, console_info_binding, 1 /*nargs*/);
    duk_put_global_string(ctx, "print");

    jslog(INFO, "Free memory: %d bytes", esp_get_free_heap_size());

    duk_push_int(ctx, INPUT);
    duk_put_global_string(ctx, "INPUT");

    duk_push_int(ctx, OUTPUT);
    duk_put_global_string(ctx, "OUTPUT");

#ifdef KEY_BUILTIN
    duk_push_int(ctx, KEY_BUILTIN);
#else
    duk_push_undefined(ctx);
#endif
    duk_put_global_string(ctx, "KEY_BUILTIN");

#ifdef LED_BUILTIN
    duk_push_int(ctx, LED_BUILTIN);
#else
    duk_push_undefined(ctx);
#endif
    duk_put_global_string(ctx, "LED_BUILTIN");

    duk_push_c_function(ctx, el_pinMode, 2 /*nargs*/);
    duk_put_global_string(ctx, "pinMode");

    duk_push_c_function(ctx, el_digitalRead, 1 /*nargs*/);
    duk_put_global_string(ctx, "digitalRead");

    duk_push_c_function(ctx, el_digitalWrite, 2 /*nargs*/);
    duk_put_global_string(ctx, "digitalWrite");

    duk_push_int(ctx, 1);
    duk_put_global_string(ctx, "HIGH");

    duk_push_int(ctx, 0);
    duk_put_global_string(ctx, "LOW");

    duk_push_c_function(ctx, info, 0 /*nargs*/);
    duk_put_global_string(ctx, "info");

    duk_push_c_function(ctx, el_suspend, 0 /*nargs*/);
    duk_put_global_string(ctx, "el_suspend");

    duk_push_c_function(ctx, el_createTimer, 1 /*nargs*/);
    duk_put_global_string(ctx, "el_createTimer");

    duk_push_c_function(ctx, el_removeTimer, 1 /*nargs*/);
    duk_put_global_string(ctx, "el_removeTimer");

    duk_push_c_function(ctx, el_load, 1 /*nargs*/);
    duk_put_global_string(ctx, "el_load");

    duk_push_c_function(ctx, el_store, 2 /*nargs*/);
    duk_put_global_string(ctx, "el_store");

    duk_push_c_function(ctx, el_restart, 0 /*nargs*/);
    duk_put_global_string(ctx, "restart");

    duk_push_c_function(ctx, el_ledcSetup, 3 /*nargs*/);
    duk_put_global_string(ctx, "ledcSetup");

    duk_push_c_function(ctx, el_ledcAttachPin, 2 /*nargs*/);
    duk_put_global_string(ctx, "ledcAttachPin");

    duk_push_c_function(ctx, el_ledcWrite, 2 /*nargs*/);
    duk_put_global_string(ctx, "ledcWrite");

    duk_push_c_function(ctx, setDateTimeInMillis, 1 /*nargs*/);
    duk_put_global_string(ctx, "setDateTimeInMillis");

    duk_push_c_function(ctx, setDateTimeZoneOffsetInHours, 1 /*nargs*/);
    duk_put_global_string(ctx, "setDateTimeZoneOffsetInHours");

    duk_push_c_function(ctx, btoa, 1 /*nargs*/);
    duk_put_global_string(ctx, "btoa");

    duk_push_c_function(ctx, atob, 1 /*nargs*/);
    duk_put_global_string(ctx, "atob");

#define ESP32_JAVASCRIPT_EXTERN ESP32_JAVASCRIPT_EXTERN_REGISTER
#include "esp32-javascript-config.h"
#undef ESP32_JAVASCRIPT_EXTERN

    loadUrlPolyfill(ctx);

    duk_eval_string_noresult(ctx, "require('esp32-javascript')");

#define ESP32_JAVASCRIPT_EXTERN ESP32_JAVASCRIPT_EXTERN_LOAD
#include "esp32-javascript-config.h"
#undef ESP32_JAVASCRIPT_EXTERN

    jslog(INFO, "Reaching end of event loop.\n");

    //Return from task is not allowed
    vTaskDelete(NULL);
}

int esp32_javascript_init()
{
    esp_log_level_set("*", ESP_LOG_ERROR);
    esp_log_level_set("wifi", ESP_LOG_WARN);
    esp_log_level_set("dhcpc", ESP_LOG_WARN);
    esp_log_level_set(tag, ESP_LOG_DEBUG);

    nvs_flash_init();
    tcpip_adapter_init();

    el_event_queue = xQueueCreate(256, sizeof(js_eventlist_t));
    jslog(INFO, "Free memory: %d bytes", esp_get_free_heap_size());

    xTaskCreatePinnedToCore(&duktape_task, "duktape_task", 24 * 1024, NULL, 5, &task, 0);
    return 0;
}
