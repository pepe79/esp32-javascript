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

#if !defined(ESP32_JAVASCRIPT_H_INCLUDED)
#define ESP32_JAVASCRIPT_H_INCLUDED

#include <stdbool.h>
#include <esp_attr.h>
#include <duktape.h>
#include "esp32-javascript-config.h"

#ifdef __cplusplus
extern "C"
{
#endif

    extern bool DISABLE_EVENTS;

    typedef struct
    {
        int type;
        int status;
        void *fd;
    } js_event_t;

#define MAX_EVENTS 8
    typedef struct
    {
        js_event_t events[MAX_EVENTS];
        int events_len;
    } js_eventlist_t;

    void IRAM_ATTR el_add_event(js_eventlist_t *events, js_event_t *event);

    void IRAM_ATTR el_fire_events(js_eventlist_t *events);

    void IRAM_ATTR el_create_event(js_event_t *event, int type, int status, void *fd);

    IRAM_ATTR void *spiram_malloc(size_t size);
    IRAM_ATTR void spiram_free(void *ptr);

#define ESP32_JAVASCRIPT_EXTERN ESP32_JAVASCRIPT_EXTERN_INCLUDE
#include "esp32-javascript-config.h"
#undef ESP32_JAVASCRIPT_EXTERN

    void loadJS(duk_context *ctx, const char *name, char *start, char *end);

    int esp32_javascript_init();
    bool isNativeOtaSupported();

#ifdef __cplusplus
}
#endif

#endif