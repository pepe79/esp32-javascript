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
#include "duktape.h"
#include "duk_module_node.h"
#include "esp32-javascript.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

duk_ret_t cb_resolve_module(duk_context *ctx)
{
	duk_push_string(ctx, "resolveModule");
	duk_eval(ctx); /* -> [ ... func ] */
	duk_dup(ctx, 0);
	duk_dup(ctx, 1);
	duk_call(ctx, 2);
	return 1;
}

duk_ret_t cb_load_module(duk_context *ctx)
{
	// feed watchdog
	vTaskDelay(1);

	duk_push_string(ctx, "loadModule");
	duk_eval(ctx); /* -> [ ... func ] */
	duk_dup(ctx, 0);
	duk_dup(ctx, 1);
	duk_dup(ctx, 2);
	duk_call(ctx, 3);
	return 1;
}

void registerDukModuleBindings(duk_context *ctx)
{
	/* After initializing the Duktape heap or when creating a new
 * thread with a new global environment:
 */

	extern char _start[] asm("_binary_loader_js_start");
	extern char _end[] asm("_binary_loader_js_end");
	loadJS(ctx, "loader.js", _start, _end);

	duk_push_object(ctx);
	duk_push_c_function(ctx, cb_resolve_module, DUK_VARARGS);
	duk_put_prop_string(ctx, -2, "resolve");
	duk_push_c_function(ctx, cb_load_module, DUK_VARARGS);
	duk_put_prop_string(ctx, -2, "load");
	duk_module_node_init(ctx);
}