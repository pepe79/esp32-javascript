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
#include "esp_ota_ops.h"
#include "esp_partition.h"

static const char *tag = "esp32-javascript";

// global task handle
TaskHandle_t task;
xQueueHandle el_event_queue;

bool flag = false;
bool spiramAvailable = false;
duk_context *ctx = NULL;

// only for debug purposes
bool DISABLE_EVENTS = false;

void fileLog(duk_context *ctx, log_level_t level, char *message)
{
    if (level >= INFO)
    {
        // append to logfile
        duk_eval_string(ctx, "typeof el_appendLogBuffer");
        if (strcmp(duk_get_string(ctx, -1), "function") == 0)
        {
            duk_push_string(ctx, "el_appendLogBuffer");
            duk_eval(ctx);
            duk_push_string(ctx, message);
            duk_push_uint(ctx, level);
            duk_call(ctx, 2);
        }
    }
}

void jslog(log_level_t level, const char *msg, ...)
{
    if (level < (5 - LOG_LOCAL_LEVEL))
    {
        return;
    }

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
        //clear stack
        duk_pop(ctx);
    }
    else
    {
        char *message = malloc(strlen(my_string) + 1);
        strcpy(message, my_string);

        js_event_t event;
        js_eventlist_t events;
        events.events_len = 0;

        el_create_event(&event, EL_LOG_EVENT_TYPE, level, message);
        el_add_event(&events, &event);
        el_fire_events(&events);
    }
    free(my_string);
}

static duk_ret_t console_debug_binding(duk_context *ctx)
{
    char *message = duk_to_string(ctx, 0);
    ESP_LOGD(tag, "%s", message);
    fileLog(ctx, DEBUG, message);
    return 0;
}
static duk_ret_t console_info_binding(duk_context *ctx)
{
    char *message = duk_to_string(ctx, 0);
    ESP_LOGI(tag, "%s", message);
    fileLog(ctx, INFO, message);
    return 0;
}
static duk_ret_t console_warn_binding(duk_context *ctx)
{
    char *message = duk_to_string(ctx, 0);
    ESP_LOGW(tag, "%s", message);
    fileLog(ctx, WARN, message);
    return 0;
}
static duk_ret_t console_error_binding(duk_context *ctx)
{
    char *message = duk_to_string(ctx, 0);
    ESP_LOGE(tag, "%s", message);
    fileLog(ctx, ERROR, message);
    return 0;
}

void IRAM_ATTR el_add_event(js_eventlist_t *events, js_event_t *event)
{
    if (events->events_len >= MAX_EVENTS)
    {
        ESP_LOGE(tag, "Event list is full. Max event list size: %d => aborting.", MAX_EVENTS);
        abort();
    }
    events->events[events->events_len] = *event;
    events->events_len = events->events_len + 1;
}

void IRAM_ATTR el_fire_events(js_eventlist_t *events)
{
    if (DISABLE_EVENTS)
    {
        ESP_LOGW(tag, "Events are disabled. They will never be fired.");
    }
    else
    {
        if (events->events_len > 0)
        {
            ESP_LOGD(tag, "Send %d events to queue...", events->events_len);
            int ret = xQueueSendFromISR(el_event_queue, events, NULL);
            if (ret != pdTRUE)
            {
                ESP_LOGE(tag, "Event queue is full... is something blocking the event loop?...aborting.");
                js_eventlist_t devents;
                int num = 0;
                while (xQueueReceive(el_event_queue, &devents, 0))
                {
                    for (int i = 0; i < devents.events_len; i++)
                    {
                        ESP_LOGE(tag, "Events num %i, event idx %i, type %i, status %i", num, i, devents.events[i].type, devents.events[i].status);
                    }
                    num++;
                }

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
        jslog(ERROR, "Error (%d) opening NVS!", err);
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
        jslog(ERROR, "Cannot get key %s from storage, err=%d", key, err);
        ret = -1;
    }
    else
    {
        char *value = (char *)malloc(string_size);
        err = nvs_get_blob(my_handle, key, value, &string_size);
        if (err != ESP_OK)
        {
            jslog(ERROR, "Cannot get key %s from storage, err=%d", key, err);
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
        jslog(ERROR, "Keys may not be longer than 15 chars. Key '%s' is longer.", key);
        return -1;
    }

    const char *value = duk_to_string(ctx, 1);
    int len = strlen(value);
    if (len > (1984 - 1))
    {
        jslog(ERROR, "Values may not be longer than 1984 chars (including zero-termination). Current string length is %d", len);
        return -1;
    }

    jslog(DEBUG, "Opening Non-Volatile Storage (NVS) ... ");
    nvs_handle my_handle;
    err = nvs_open("esp32js2", NVS_READWRITE, &my_handle);
    if (err != ESP_OK)
    {
        jslog(ERROR, "Error (%d) opening NVS!", err);
        return -1;
    }

    err = nvs_set_blob(my_handle, key, (void *)value, len + 1);
    if (err != ESP_OK)
    {
        jslog(ERROR, "Cannot set key %s and value %s from storage, err=%d", key, value, err);
        ret = -1;
    }

    err = nvs_commit(my_handle);
    if (err != ESP_OK)
    {
        jslog(ERROR, "Cannot commit changes, err=%d", err);
        ret = -1;
    }
    nvs_close(my_handle);
    return ret;
}

static duk_ret_t native_delay(duk_context *ctx)
{
    int delay = duk_to_int32(ctx, 0);
    jslog(DEBUG, "Waiting %dms...", delay);
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
    jslog(DEBUG, "Install timer to notify in  %dms.", delay);
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
    duk_push_boolean(ctx, DEBUG >= (5 - LOG_LOCAL_LEVEL));
    duk_put_prop_string(ctx, obj_idx, "isDebug");
    duk_push_c_function(ctx, console_info_binding, 1);
    duk_put_prop_string(ctx, obj_idx, "info");
    duk_push_boolean(ctx, INFO >= (5 - LOG_LOCAL_LEVEL));
    duk_put_prop_string(ctx, obj_idx, "isInfo");
    duk_push_c_function(ctx, console_warn_binding, 1);
    duk_put_prop_string(ctx, obj_idx, "warn");
    duk_push_boolean(ctx, WARN >= (5 - LOG_LOCAL_LEVEL));
    duk_put_prop_string(ctx, obj_idx, "isWarn");
    duk_push_c_function(ctx, console_error_binding, 1);
    duk_put_prop_string(ctx, obj_idx, "error");
    duk_push_boolean(ctx, ERROR >= (5 - LOG_LOCAL_LEVEL));
    duk_put_prop_string(ctx, obj_idx, "isError");

    duk_put_global_string(ctx, "console");
}

static duk_ret_t el_suspend(duk_context *ctx)
{
    // feed watchdog
    vTaskDelay(1);

    // jslog(INFO, "Free memory: %d bytes", esp_get_free_heap_size());
    js_eventlist_t events;

    jslog(DEBUG, "Waiting for events...");
    int arr_idx = duk_push_array(ctx);
    int arrsize = 0;
    TickType_t timeout = portMAX_DELAY;

    // force garbage collection 2 times see duktape doc
    // greatly increases perfomance with external memory
    duk_gc(ctx, 0);
    if (uxQueueMessagesWaiting(el_event_queue) == 0)
    {
        // if no event is waiting also compact heap
        duk_gc(ctx, DUK_GC_COMPACT);
    }
    else
    {
        duk_gc(ctx, 0);
    }

    while (xQueueReceive(el_event_queue, &events, timeout) == pdTRUE)
    {
        timeout = 0; // set timeout to 0 to not wait in while loop if there are no more events available
        for (int i = 0; i < events.events_len; i++)
        {
            duk_idx_t obj_idx = duk_push_object(ctx);

            duk_push_int(ctx, events.events[i].type);
            duk_put_prop_string(ctx, obj_idx, "type");
            duk_push_int(ctx, events.events[i].status);
            duk_put_prop_string(ctx, obj_idx, "status");
            duk_push_int(ctx, (int)events.events[i].fd);
            duk_put_prop_string(ctx, obj_idx, "fd");

            duk_put_prop_index(ctx, arr_idx, arrsize);
            arrsize++;
        }
    }

    jslog(DEBUG, "Received %d events.", arrsize);

    return 1;
}

static duk_ret_t el_pinMode(duk_context *ctx)
{
    int pin = duk_to_int(ctx, 0);
    int dir = duk_to_int(ctx, 1);

    jslog(DEBUG, "el_pinMode pin=%d dir=%d", pin, dir);

    pinMode(pin, dir);
    return 0;
}

static duk_ret_t el_digitalWrite(duk_context *ctx)
{
    int pin = duk_to_int(ctx, 0);
    int level = duk_to_int(ctx, 1);

    jslog(DEBUG, "el_digitalWrite pin=%d level=%d", pin, level);

    digitalWrite(pin, level);
    return 0;
}

static duk_ret_t el_digitalRead(duk_context *ctx)
{
    int pin = duk_to_int(ctx, 0);

    jslog(DEBUG, "el_digitalRead pin=%d", pin);

    int val = digitalRead(pin);
    duk_push_int(ctx, val);
    return 1;
}

static duk_ret_t el_ledcSetup(duk_context *ctx)
{
    int channel = duk_to_int(ctx, 0);
    int freq = duk_to_int(ctx, 1);
    int resolution = duk_to_int(ctx, 2);

    jslog(DEBUG, "el_ledcSetup channel=%d freq=%d resolution=%d ", channel, freq, resolution);

    ledcSetup(channel, freq, resolution);
    return 0;
}

static duk_ret_t el_ledcAttachPin(duk_context *ctx)
{
    int pin = duk_to_int(ctx, 0);
    int channel = duk_to_int(ctx, 1);

    jslog(DEBUG, "el_ledcAttachPin pin=%d channel=%d", pin, channel);

    ledcAttachPin(pin, channel);
    return 0;
}

static duk_ret_t el_ledcWrite(duk_context *ctx)
{
    int channel = duk_to_int(ctx, 0);
    int dutyCycle = duk_to_int(ctx, 1);

    jslog(DEBUG, "el_ledcWrite channel=%d dutyCycle=%d ", channel, dutyCycle);

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
    jslog(ERROR, "*** FATAL ERROR: %s", (msg ? msg : "no message"));
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
    jslog(INFO, "Loading %s ...", name);
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
    jslog(ERROR, "malloc returned NULL");
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
    jslog(ERROR, "malloc returned NULL");
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

duk_ret_t el_ota_begin(duk_context *ctx)
{
    esp_partition_t *partition = esp_ota_get_next_update_partition(NULL);
    esp_ota_handle_t handle;
    esp_err_t err = esp_ota_begin(partition, OTA_SIZE_UNKNOWN, &handle);
    if (err == ESP_OK)
    {
        duk_push_uint(ctx, handle);
        return 1;
    }
    else
    {
        jslog(ERROR, "esp_ota_begin returned error %i", err);
        return -1;
    }
}

duk_ret_t el_ota_write(duk_context *ctx)
{
    duk_size_t size;
    esp_ota_handle_t handle = duk_to_uint32(ctx, 0);
    void *data = duk_get_buffer_data(ctx, 1, &size);

    esp_err_t err = esp_ota_write(handle, data, size);
    if (err == ESP_OK)
    {
        return 0;
    }
    else
    {
        jslog(ERROR, "Error while ota write: %i", err);
        return -1;
    }
}

duk_ret_t el_ota_end(duk_context *ctx)
{
    esp_ota_handle_t handle = duk_to_uint32(ctx, 0);

    esp_err_t err = esp_ota_end(handle);
    if (err == ESP_OK)
    {
        return 0;
    }
    else
    {
        jslog(ERROR, "Error while ota end: %i", err);
        return -1;
    }
}

duk_ret_t el_ota_switch_boot_partition(duk_context *ctx)
{
    esp_partition_t *partition = esp_ota_get_next_update_partition(NULL);
    esp_err_t err = esp_ota_set_boot_partition(partition);

    if (err == ESP_OK)
    {
        return 0;
    }
    else
    {
        jslog(ERROR, "Error while ota switching boot: %i", err);
        return -1;
    }
}

duk_ret_t el_ota_find_next_modules_partition(duk_context *ctx)
{
    esp_partition_t *partition = esp_ota_get_next_update_partition(NULL);
    const char *modulesLabel = strcmp(partition->label, "ota_1") == 0 ? "modules_1" : "modules";
    esp_partition_t *modulesPartition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, modulesLabel);
    if (modulesPartition != NULL)
    {
        duk_push_pointer(ctx, modulesPartition);
        return 1;
    }
    else
    {
        jslog(ERROR, "Next modules partition not found.");
        return -1;
    }
}

duk_ret_t el_find_partition(duk_context *ctx)
{
    char *label = duk_to_string(ctx, 0);
    esp_partition_t *partition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, label);
    if (partition != NULL)
    {
        duk_idx_t obj_idx = duk_push_object(ctx);

        duk_push_pointer(ctx, partition);
        duk_put_prop_string(ctx, obj_idx, "_ref");
        duk_push_uint(ctx, partition->size);
        duk_put_prop_string(ctx, obj_idx, "size");

        return 1;
    }
    else
    {
        jslog(ERROR, "Partition with label %s not found.", label);
        return -1;
    }
}

duk_ret_t el_partition_erase(duk_context *ctx)
{
    esp_partition_t *partition = duk_to_pointer(ctx, 0);
    esp_err_t err = esp_partition_erase_range(partition, 0, partition->size);
    if (err == ESP_OK)
    {
        return 0;
    }
    else
    {
        jslog(ERROR, "Error while erasing next modules partition: %i", err);
        return -1;
    }
}

duk_ret_t el_partition_write(duk_context *ctx)
{
    esp_partition_t *partition = duk_to_pointer(ctx, 0);
    size_t offset = duk_to_uint(ctx, 1);

    size_t size;
    void *data = duk_get_buffer_data(ctx, 2, &size);

    esp_err_t err = esp_partition_write(partition, offset, data, size);
    if (err == ESP_OK)
    {
        return 0;
    }
    else
    {
        jslog(ERROR, "Error while erasing next modules partition: %i", err);
        return -1;
    }
}

bool isNativeOtaSupported()
{
    if (esp_partition_find_first(ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_OTA, "otadata") == NULL)
    {
        return false;
    }
    else
    {
        return true;
    }
}

duk_ret_t el_is_native_ota_supported(duk_context *ctx)
{
    duk_push_boolean(ctx, isNativeOtaSupported());
    return 1;
}

duk_ret_t el_readAndFreeString(duk_context *ctx)
{
    char *str = duk_to_int(ctx, 0);
    duk_push_string(ctx, str);
    free(str);
    return 1;
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

    if (isNativeOtaSupported())
    {
        duk_push_c_function(ctx, el_ota_begin, 0 /*nargs*/);
        duk_put_global_string(ctx, "el_ota_begin");

        duk_push_c_function(ctx, el_ota_write, 2 /*nargs*/);
        duk_put_global_string(ctx, "el_ota_write");

        duk_push_c_function(ctx, el_ota_end, 1 /*nargs*/);
        duk_put_global_string(ctx, "el_ota_end");

        duk_push_c_function(ctx, el_ota_switch_boot_partition, 0 /*nargs*/);
        duk_put_global_string(ctx, "el_ota_switch_boot_partition");

        duk_push_c_function(ctx, el_ota_find_next_modules_partition, 0 /*nargs*/);
        duk_put_global_string(ctx, "el_ota_find_next_modules_partition");
    }

    duk_push_c_function(ctx, el_is_native_ota_supported, 0 /*nargs*/);
    duk_put_global_string(ctx, "el_is_native_ota_supported");

    duk_push_c_function(ctx, el_partition_erase, 1 /*nargs*/);
    duk_put_global_string(ctx, "el_partition_erase");

    duk_push_c_function(ctx, el_partition_write, 3 /*nargs*/);
    duk_put_global_string(ctx, "el_partition_write");

    duk_push_c_function(ctx, el_find_partition, 1 /*nargs*/);
    duk_put_global_string(ctx, "el_find_partition");

    duk_push_int(ctx, EL_TIMER_EVENT_TYPE);
    duk_put_global_string(ctx, "EL_TIMER_EVENT_TYPE");

    duk_push_int(ctx, EL_LOG_EVENT_TYPE);
    duk_put_global_string(ctx, "EL_LOG_EVENT_TYPE");

    duk_push_c_function(ctx, el_readAndFreeString, 1 /*nargs*/);
    duk_put_global_string(ctx, "el_readAndFreeString");

    loadUrlPolyfill(ctx);

#define ESP32_JAVASCRIPT_EXTERN ESP32_JAVASCRIPT_EXTERN_REGISTER
#include "esp32-javascript-config.h"
#undef ESP32_JAVASCRIPT_EXTERN

    duk_eval_string_noresult(ctx, "require('esp32-javascript')");

#define ESP32_JAVASCRIPT_EXTERN ESP32_JAVASCRIPT_EXTERN_LOAD
#include "esp32-javascript-config.h"
#undef ESP32_JAVASCRIPT_EXTERN

    jslog(INFO, "Reaching end of event loop.");

    //Return from task is not allowed
    vTaskDelete(NULL);
}

int esp32_javascript_init()
{
    esp_log_level_set("*", ESP_LOG_ERROR);
    esp_log_level_set("wifi", ESP_LOG_WARN);
    esp_log_level_set("dhcpc", ESP_LOG_WARN);
    esp_log_level_set(tag, LOG_LOCAL_LEVEL);

    nvs_flash_init();
    tcpip_adapter_init();

    el_event_queue = xQueueCreate(256, sizeof(js_eventlist_t));
    jslog(INFO, "Free memory: %d bytes", esp_get_free_heap_size());

    xTaskCreatePinnedToCore(&duktape_task, "duktape_task", 24 * 1024, NULL, 5, &task, 0);
    return 0;
}
