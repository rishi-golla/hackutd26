// xp2 standalone mode ("MVP"): no host needed. When enabled (`mboot on`, stored in NVS xpboot/on), every power-on
// starts, a few seconds after boot:
//   * light-sleep inhibit (radio stays up with the menu closed),
//   (mauto is NOT started: vitals-only MVP)
//   * `blehr 0 15 bg`       - connect to any BLE heart-rate / pulse-ox sensor forever, reconnect after drop-outs.
// `mboot off` disables it (takes effect next boot); `mboot` shows the setting.
#include "xp_priv.h"

#include "esp_console.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int s_unit = 2501;

static bool load(int *unit)
{
    nvs_handle_t h;
    uint8_t on = 0;
    int32_t u = 2501;
    if (nvs_open("xpboot", NVS_READONLY, &h) != ESP_OK) return false;
    (void)nvs_get_u8(h, "on", &on);
    (void)nvs_get_i32(h, "unit", &u);
    nvs_close(h);
    *unit = (int)u;
    return on != 0;
}

static esp_err_t save(bool on, int unit)
{
    nvs_handle_t h;
    esp_err_t e = nvs_open("xpboot", NVS_READWRITE, &h);
    if (e != ESP_OK) return e;
    e = nvs_set_u8(h, "on", on ? 1 : 0);
    if (e == ESP_OK) e = nvs_set_i32(h, "unit", unit);
    if (e == ESP_OK) e = nvs_commit(h);
    nvs_close(h);
    return e;
}

static void boot_task(void *arg)
{
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(4000));          // let the medic UI, FPGA link and console settle
    xp_awake(0xFFFFFFFFu);
    int ret = 0;
    (void)esp_console_run("blehr 0 15 bg", &ret);   // vitals only (kept simple: no auto pre-alert)
    printf("{\"cmd\":\"mboot\",\"ev\":\"standalone_started\",\"unit\":%d}\n", s_unit);
    fflush(stdout);
    vTaskDelete(NULL);
}

static int cmd_mboot(int argc, char **argv)
{
    int unit = 2501;
    bool on = load(&unit);
    if (argc >= 2 && (strcmp(argv[1], "on") == 0 || strcmp(argv[1], "off") == 0))
    {
        on = strcmp(argv[1], "on") == 0;
        if (argc >= 3) unit = atoi(argv[2]);
        esp_err_t e = save(on, unit);
        printf("{\"cmd\":\"mboot\",\"on\":%s,\"unit\":%d,\"saved\":%s,\"note\":\"takes effect at next power-on\"}\n",
               on ? "true" : "false", unit, e == ESP_OK ? "true" : "false");
        return e == ESP_OK ? 0 : 1;
    }
    printf("{\"cmd\":\"mboot\",\"on\":%s,\"unit\":%d}\n", on ? "true" : "false", unit);
    return 0;
}

void xp_register_boot_cmds(void)
{
    const esp_console_cmd_t c = {
        .command = "mboot",
        .help = "xp2: mboot [on [unit] | off] - standalone at power-on: BLE vitals sensor (forever, auto-reconnect) + overlay auto-open",
        .func = cmd_mboot,
    };
    esp_console_cmd_register(&c);
}

bool XP_BootEnabled(void)
{
    int u;
    return load(&u);
}

void XP_BootAuto(void)
{
    if (load(&s_unit)) xTaskCreatePinnedToCore(boot_task, "xp_boot", 4096, NULL, 2, NULL, 0);
}
