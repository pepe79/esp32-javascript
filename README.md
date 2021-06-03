# esp32-javascript

![](https://github.com/marcelkottmann/esp32-javascript/workflows/Build/badge.svg)

"Lightweight" JS interpreter for ESP32. Provides JS-based eventloop implementation
and native asynchronous network and timer functions.
Because of the limited memory on ESP32-WROOM modules, the full functionality is currently only realizable on ESP32-WROVER and ESP32-S2-WROVER modules, that came with at least 2MB integrated SPIRAM.

## Content

[Getting started](#getting-started)

[API](#api)

[Compatibility](#compatibility)

## Getting started

### Prerequisites

Install [esp-idf 4.2](https://docs.espressif.com/projects/esp-idf/en/release-v4.2/esp32/get-started/index.html) on your system.

### First install

Clone esp32-javascript inside your esp directory (normally ~/esp):

```shell
    cd ~/esp
    git clone https://github.com/pepe79/esp32-javascript.git
```

Change into ~/esp/esp32-javascript

```shell
    cd ~/esp/esp32-javascript
```

Maybe you want to change the BOARD_VARIANT in the ./CMakeLists.txt file 
for the integrated arduino-esp32 bindings.

First build the project with

```shell
    #for ESP32 devices
    idf.py build

    #for ESP32-S2 devices
    idf.py -DIDF_TARGET=esp32s2 build
```

Connect your ESP32 Dev Board via USB and run

```shell
    idf.py flash monitor
```

Use the keyboard shortcut `AltGr + ]` to leave serial monitor.

Now you have installed the pre-configured boot script.

If this is your first install, your onboard LED should blink now. Blinking signals that your board has started a soft ap with the ssid "esp32". With your mobile or desktop connect to the WLAN SSID "esp32" and open http://192.168.4.1/setup (if you have not changed the default credentials your username / password is esp32 / esp32 ). You can change the default password in
[firmware-config.ts](./components/esp32-javascript/modules/esp32-javascript/firmware-config.ts) by changing the value of key `password`.

On the Setup page you can configure your WLAN settings and an URL to download your JS main script from.

Please note that the script, does not need to have a main function, because its evaluated entirely.
That means, to print out "Hello World", you only have to include one line in your script on the webserver:

```js
console.log("Hello world!");
```

### C/C++bindings

If you need to create your own C/C++ bindings for your JS code, this are the steps to perform:

1. Create a file named `project.cpp` in the `./main` directory
2. Implement the esp32_javascript_main callback function inside this `project.ccp`:

```c
   #include "esp32-javascript.h"

   extern void esp32_javascript_main(duk_context *ctx)
   {
     // do your own duktape bindings here
   }
```

See [Duktape Programmer's Guide](https://duktape.org/guide.html) for more information regarding Duktape bindings.

If you need more than this, you can create your own esp-idf component below `./components`. Then delegate the `esp32_javascript_main` function to this component.
Additionally you have to set your component name in the top level `./CMakeLists.txt`. Refer to the documentation next to the setting `ESP32_JS_PROJECT_NAME`.
See [ESP Build System](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/build-system.html) for information on how to create a component with the esp-idf build system.

### Native OTA

You can perform a native firmware OTA upgrade by calling the URL /setup . There is a section called "Native OTA" where you can provide two urls to the new images: One for the actual firmware image (normally named esp32-javascript.bin in your build directory) and the other for the JS modules image (normally named modules.bin in your build directory).

The upgrade is performed in the background. You can check the upgrade status either by staying on the upgrade page, which is reloaded automatically every ~20 seconds or click on "Upgrade status" in the setup page.

After upgrade has finished you have to restart the device to load the new firmware.
### Clean

You can clean the project by executing

```shell
    idf.py fullclean
```

If you want to use all the esp32-javascript defaults for your sdkconfig. Remove `./sdkconfig` file. This file will be recreated the next build with all the defaults. 
### Factory reset

You can erase the persistent flash memory, which will be equivalent to a factory reset, by executing

```shell
    idf.py erase_flash
```

## Compatibility

### Device Requirements
* Supported chips ESP32 and ESP32-S2
* 2 MB Minimum Flash Size
* 2 MB Minimum external SPI RAM (WROVER)

### ESP-IDF

| Version                                                           |       Compatible       |
| ----------------------------------------------------------------- | :--------------------: |
| [4.2](https://github.com/espressif/esp-idf/releases/tag/v4.2)     | :heavy_check_mark:[^1] |
| [4.2.1](https://github.com/espressif/esp-idf/releases/tag/v4.2.1) | :heavy_check_mark:[^1] |

[^1]: SSL client connections currently not working properly for ESP32-S2 devices due to esp-idf bug in 4.2.x:
https://github.com/espressif/esp-idf/pull/6998 , but can be fixed manually (see changes in PR).

## API

[API documentation](docs/README.md)

### Update docs

Update documentation by executing

```shell
    npm run doc
```

## License

See source files.
