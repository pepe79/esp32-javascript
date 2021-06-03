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

#define ESP32_JAVASCRIPT_EXTERN_INCLUDE 1
#define ESP32_JAVASCRIPT_EXTERN_LOAD 2
#define ESP32_JAVASCRIPT_EXTERN_REGISTER 3

#define EL_TIMER_EVENT_TYPE 0
#define EL_WIFI_EVENT_TYPE 1
#define EL_SOCKET_EVENT_TYPE 2
#define EL_LOG_EVENT_TYPE 3
#define RADIO_RECEIVE_EVENT_TYPE 4
// define your custom event types here
// #define CUSTOM_XXX_EVENT_TYPE 4

#if ESP32_JAVASCRIPT_EXTERN == ESP32_JAVASCRIPT_EXTERN_INCLUDE
extern void initSpiffs(duk_context *ctx);
extern void registerDukModuleBindings(duk_context *ctx);
extern void initSocketFunctions(duk_context *ctx);
extern void loadSocketEvents(duk_context *ctx);
extern void registerWifiEventsBindings(duk_context *ctx);
extern void loadWifiEvents(duk_context *ctx);
extern void esp32_javascript_main(duk_context *ctx);
#endif

#if ESP32_JAVASCRIPT_EXTERN == ESP32_JAVASCRIPT_EXTERN_REGISTER
initSpiffs(ctx);
registerDukModuleBindings(ctx);
initSocketFunctions(ctx);
registerWifiEventsBindings(ctx);
esp32_javascript_main(ctx);
#endif
