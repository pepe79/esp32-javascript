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

#include "wifi-events.h"
#include "esp32-javascript.h"
#include "esp32-js-log.h"
#include "esp_wifi.h"
#include "esp_event_loop.h"
#include "freertos/event_groups.h"
#include "esp_log.h"

static EventGroupHandle_t wifi_event_group;
static const int CONNECTED_BIT = BIT0;
static const int SCANNING_BIT = BIT1;
static uint8_t *staticBssid = NULL;

void startScan()
{
	wifi_scan_config_t scanConf = {
		.ssid = NULL,
		.bssid = NULL,
		.channel = 0,
		.show_hidden = true};
	int ret = esp_wifi_scan_start(&scanConf, false);
	if (ret > 0)
	{
		jslog(WARN, "SCAN RETURNED %d", ret);
	}
	else
	{
		xEventGroupSetBits(wifi_event_group, SCANNING_BIT);
	}
}

bool bssidEquals(uint8_t *bssid1, uint8_t *bssid2)
{
	for (int i = 0; i < 6; i++)
	{
		if (bssid1[i] != bssid2[i])
		{
			return false;
		}
	}
	return true;
}

static IRAM_ATTR esp_err_t event_handler(void *ctx, system_event_t *sysevent)
{
	js_eventlist_t events;
	events.events_len = 0;

	js_event_t event;
	js_event_t event2;
	wifi_mode_t mode;

	jslog(DEBUG, "WIFI EVENT %d", sysevent->event_id);
	switch (sysevent->event_id)
	{
	case SYSTEM_EVENT_SCAN_DONE:
	{
		wifi_config_t wifi_config;
		ESP_ERROR_CHECK(esp_wifi_get_config(WIFI_IF_STA, &wifi_config));

		jslog(DEBUG, "Search for SSID %s ", wifi_config.sta.ssid);
		if (staticBssid != NULL)
		{
			jslog(DEBUG, "AND bssid=%02x:%02x:%02x:%02x:%02x:%02x", staticBssid[0], staticBssid[1], staticBssid[2], staticBssid[3], staticBssid[4], staticBssid[5]);
		}

		uint16_t apCount = 0;
		esp_wifi_scan_get_ap_num(&apCount);
		jslog(DEBUG, "Number of access points found: %d", sysevent->event_info.scan_done.number);
		uint8_t *selectedBssid = NULL;
		int8_t rssi = -127;
		wifi_ap_record_t *list = NULL;
		if (apCount > 0)
		{
			list = (wifi_ap_record_t *)spiram_malloc(sizeof(wifi_ap_record_t) * apCount);
			ESP_ERROR_CHECK(esp_wifi_scan_get_ap_records(&apCount, list));

			int i = 0;
			for (i = 0; i < apCount; i++)
			{
				bool ssidMatch = strcmp((const char *)list[i].ssid, (const char *)wifi_config.sta.ssid) == 0;
				bool bssidMatch = (staticBssid == NULL) || bssidEquals(staticBssid, list[i].bssid);

				jslog(DEBUG, "ssidmatch=%s, bssidmatch=%s", ssidMatch ? "true" : "false", bssidMatch ? "true" : "false");
				jslog(DEBUG, "SSID %s , bssid=%02x:%02x:%02x:%02x:%02x:%02x, rssi=%d,", list[i].ssid,
					  list[i].bssid[0], list[i].bssid[1], list[i].bssid[2], list[i].bssid[3], list[i].bssid[4], list[i].bssid[5], list[i].rssi);
				if (ssidMatch && bssidMatch)
				{
					if (list[i].rssi > rssi)
					{
						selectedBssid = list[i].bssid;
						rssi = list[i].rssi;
						jslog(DEBUG, "==> SELECTED!");
					}
				}
			}
		}
		esp_wifi_scan_stop();
		xEventGroupClearBits(wifi_event_group, SCANNING_BIT);
		if (selectedBssid != NULL)
		{
			jslog(INFO, "==> SSID %s found, bssid=%02x:%02x:%02x:%02x:%02x:%02x, rssi=%d,", wifi_config.sta.ssid,
				  selectedBssid[0], selectedBssid[1], selectedBssid[2], selectedBssid[3], selectedBssid[4], selectedBssid[5], rssi);
			memcpy(wifi_config.sta.bssid, selectedBssid, 6 * sizeof(uint8_t));
			ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
			esp_wifi_connect();
		}
		else
		{
			jslog(DEBUG, "SSID not found %s", wifi_config.sta.ssid);

			xEventGroupClearBits(wifi_event_group, CONNECTED_BIT);
			el_create_event(&event, EL_WIFI_EVENT_TYPE, EL_WIFI_STATUS_DISCONNECTED, 0);
			el_add_event(&events, &event);

			startScan();
		}

		if (list != NULL)
		{
			free(list);
		}
		break;
	}
	case SYSTEM_EVENT_STA_START:
		el_create_event(&event, EL_WIFI_EVENT_TYPE, EL_WIFI_STATUS_CONNECTING, 0);
		el_add_event(&events, &event);
		break;
	case SYSTEM_EVENT_STA_CONNECTED:
		// connected state will be handled by SYSTEM_EVENT_STA_GOT_IP, see below.
		break;
	case SYSTEM_EVENT_STA_GOT_IP:
		xEventGroupSetBits(wifi_event_group, CONNECTED_BIT);
		el_create_event(&event, EL_WIFI_EVENT_TYPE, EL_WIFI_STATUS_CONNECTED, sysevent->event_info.got_ip.ip_info.ip.addr);
		el_add_event(&events, &event);
		break;
	case SYSTEM_EVENT_STA_DISCONNECTED:
	{
		xEventGroupClearBits(wifi_event_group, CONNECTED_BIT);
		el_create_event(&event, EL_WIFI_EVENT_TYPE, EL_WIFI_STATUS_DISCONNECTED, 0);
		el_add_event(&events, &event);

		el_create_event(&event2, EL_WIFI_EVENT_TYPE, EL_WIFI_STATUS_CONNECTING, 0);
		el_add_event(&events, &event2);
		esp_wifi_disconnect();
		startScan();
	}
	break;
	case SYSTEM_EVENT_AP_START:
		xEventGroupSetBits(wifi_event_group, CONNECTED_BIT);
		el_create_event(&event, EL_WIFI_EVENT_TYPE, EL_WIFI_STATUS_CONNECTED, 0);
		el_add_event(&events, &event);
		break;
	case SYSTEM_EVENT_AP_STOP:
		xEventGroupClearBits(wifi_event_group, CONNECTED_BIT);
		el_create_event(&event, EL_WIFI_EVENT_TYPE, EL_WIFI_STATUS_DISCONNECTED, 0);
		el_add_event(&events, &event);
		break;
	default:
		jslog(ERROR, "UNKNOWN WIFI EVENT %d", sysevent->event_id);
		break;
	}

	el_fire_events(&events);

	return ESP_OK;
}

static duk_ret_t getWifiConfig(duk_context *ctx)
{
	wifi_mode_t mode;
	esp_wifi_get_mode(&mode);
	if (mode == WIFI_MODE_STA)
	{
		wifi_config_t wifi_config;
		esp_wifi_get_config(WIFI_IF_STA, &wifi_config);

		duk_idx_t obj_idx = duk_push_object(ctx);

		int arr_idx = duk_push_array(ctx);
		for (int i = 0; i < 6; i++)
		{
			duk_push_int(ctx, wifi_config.sta.bssid[i]);
			duk_put_prop_index(ctx, arr_idx, i);
		}
		duk_put_prop_string(ctx, obj_idx, "bssid");
		duk_push_boolean(ctx, wifi_config.sta.bssid_set);
		duk_put_prop_string(ctx, obj_idx, "bssid_set");
		duk_push_int(ctx, wifi_config.sta.channel);
		duk_put_prop_string(ctx, obj_idx, "channel");
		duk_push_uint(ctx, wifi_config.sta.listen_interval);
		duk_put_prop_string(ctx, obj_idx, "listen_interval");
		duk_push_lstring(ctx, (const char *)wifi_config.sta.password, 64);
		duk_put_prop_string(ctx, obj_idx, "password");
		duk_push_lstring(ctx, (const char *)wifi_config.sta.ssid, 32);
		duk_put_prop_string(ctx, obj_idx, "ssid");
		return 1;
	}
	else
	{
		// undefined;
		return 0;
	}
}

static duk_ret_t el_stopWifi(duk_context *ctx)
{
	esp_wifi_stop();
	return 0;
}

static duk_ret_t el_startWifi(duk_context *ctx)
{
	esp_wifi_start();
	return 0;
}

static duk_ret_t setupWifi(duk_context *ctx, bool softap)
{
	const char *ssid = duk_to_string(ctx, 0);
	const char *pass = duk_to_string(ctx, 1);

	uint8_t *bssid = NULL;
	if (!softap && !duk_is_undefined(ctx, 2))
	{
		if (duk_is_array(ctx, 2) && duk_get_length(ctx, 2) == 6)
		{
			bssid = calloc(6, sizeof(uint8_t));

			for (int i = 0; i < 6; i++)
			{
				duk_get_prop_index(ctx, 2, i);
				bssid[i] = duk_to_int(ctx, -1);
				duk_pop(ctx);
			}
		}
		else
		{
			jslog(ERROR, "Provided bssid is invalid.");
			return -1;
		}
	}

	//try stopping
	//esp_wifi_stop();
	wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
	ESP_ERROR_CHECK(esp_wifi_init(&cfg));
	ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));

	ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
	if (softap)
	{
		ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
		wifi_config_t ap_config;
		ap_config.ap.ssid_len = 0;
		ap_config.ap.channel = 1;
		ap_config.ap.authmode = strlen(pass) > 0 ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
		ap_config.ap.ssid_hidden = false;
		ap_config.ap.max_connection = 10;
		ap_config.ap.beacon_interval = 100;

		strcpy((char *)ap_config.ap.ssid, ssid);
		strcpy((char *)ap_config.ap.password, "");
		ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
		ESP_ERROR_CHECK(esp_wifi_start());
	}
	else
	{
		wifi_config_t wifi_config = {
			.sta = {},
		};
		strcpy((char *)wifi_config.sta.ssid, ssid);
		strcpy((char *)wifi_config.sta.password, pass);
		wifi_config.sta.scan_method = WIFI_ALL_CHANNEL_SCAN;
		wifi_config.sta.bssid_set = true;

		ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
		jslog(INFO, "Setting WiFi configuration SSID %s and PASS ****. BSSID was provided: %s", wifi_config.sta.ssid, staticBssid != NULL ? "true" : "false");

		ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
		ESP_ERROR_CHECK(esp_wifi_start());

		if (staticBssid != NULL)
		{
			free(staticBssid);
			staticBssid = NULL;
		}
		if (bssid != NULL)
		{
			staticBssid = bssid;
		}

		startScan();
	}

	return 0;
}

static duk_ret_t el_connectWifi(duk_context *ctx)
{
	return setupWifi(ctx, false);
}

static duk_ret_t el_createSoftAp(duk_context *ctx)
{
	return setupWifi(ctx, true);
}

void registerWifiEventsBindings(duk_context *ctx)
{
	wifi_event_group = xEventGroupCreate();
	ESP_ERROR_CHECK(esp_event_loop_init(event_handler, NULL));

	duk_push_c_function(ctx, el_connectWifi, 3 /*nargs*/);
	duk_put_global_string(ctx, "el_connectWifi");

	duk_push_c_function(ctx, el_createSoftAp, 2 /*nargs*/);
	duk_put_global_string(ctx, "el_createSoftAp");

	duk_push_c_function(ctx, el_stopWifi, 0 /*nargs*/);
	duk_put_global_string(ctx, "stopWifi");

	duk_push_c_function(ctx, el_startWifi, 0 /*nargs*/);
	duk_put_global_string(ctx, "startWifi");

	duk_push_c_function(ctx, getWifiConfig, 0 /*nargs*/);
	duk_put_global_string(ctx, "getWifiConfig");

	duk_push_int(ctx, EL_WIFI_EVENT_TYPE);
	duk_put_global_string(ctx, "EL_WIFI_EVENT_TYPE");
}
