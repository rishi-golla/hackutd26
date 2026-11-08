// fw/xp2: "csi" - Wi-Fi Channel State Information time series from the owner's own devices.
//
//   csi <seconds> [ap [ch=6] [ping_hz=20]]            own WPA2 softAP "CMX-CSI" (random password printed)
//   csi <seconds> sta <ssid> <pass> [ping_hz=20]       join the owner's AP / phone hotspot
//
// CSI is taken only from frames sent by stations associated to our softAP (ap) or by the joined AP (sta).
// Frames from anyone else are counted, never stored or printed. To guarantee traffic the device pings the
// first associated station (ap) or the gateway (sta) at ping_hz; 0 disables that. Output: one line per
// 50 ms bin per station (20 Hz): t, mac tail, mean RSSI, mean |H| over LLTF subcarriers, mean across-subcarrier
// variance of |H|, packets in bin. Blocking command (console is busy for <seconds>), self-cleaning.

#include "xp_priv.h"

#include "esp_console.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/ip_addr.h"
#include "ping/ping_sock.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#define CSI_MAX_STA 4
#define CSI_BIN_MS 50
#define CSI_MAX_LINES 4000
#define CSI_MAX_SEC 300

typedef struct {
    bool used, connected;
    uint8_t mac[6];
    uint32_t ip;                  // network order, 0 = none yet
    // current 50 ms bin (written by the Wi-Fi task, swapped out by the console task)
    uint32_t n;
    int32_t rssi_sum;
    float amp_sum, var_sum;
    // totals
    uint32_t total, bins;
} CsiSta_t;

static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static CsiSta_t s_sta[CSI_MAX_STA];
static volatile bool s_on;
static volatile bool s_sta_mode;
static volatile uint32_t s_cb_total, s_cb_other, s_cb_empty, s_joins, s_leaves, s_sta_disc;
static volatile uint32_t s_gw_ip;
static volatile bool s_got_ip;
static volatile uint32_t s_ping_ok, s_ping_to;

static int find_sta(const uint8_t *mac)
{
    for (int i = 0; i < CSI_MAX_STA; i++)
    {
        if (s_sta[i].used && memcmp(s_sta[i].mac, mac, 6) == 0) return i;
    }
    return -1;
}

static int add_sta(const uint8_t *mac)
{
    int i = find_sta(mac);
    if (i >= 0) return i;
    for (i = 0; i < CSI_MAX_STA; i++)
    {
        if (!s_sta[i].used)
        {
            memset(&s_sta[i], 0, sizeof(s_sta[i]));
            s_sta[i].used = true;
            memcpy(s_sta[i].mac, mac, 6);
            return i;
        }
    }
    return -1;
}

static void csi_cb(void *ctx, wifi_csi_info_t *info)
{
    (void)ctx;
    if (!s_on || info == NULL || info->buf == NULL)
    {
        return;
    }
    s_cb_total++;
    portENTER_CRITICAL(&s_mux);
    const int idx = find_sta(info->mac);
    portEXIT_CRITICAL(&s_mux);
    if (idx < 0)
    {
        s_cb_other++;   // somebody else's frame: count only
        return;
    }
    // LLTF: first 128 bytes = 64 subcarriers x (imag, real) int8. Null/guard subcarriers read 0,0.
    const int len = info->len < 128 ? info->len : 128;
    const int8_t *b = info->buf;
    float sum = 0, sum2 = 0;
    int cnt = 0;
    for (int i = info->first_word_invalid ? 4 : 0; i + 1 < len; i += 2)
    {
        const int im = b[i], re = b[i + 1];
        if (im == 0 && re == 0) continue;
        const float a = sqrtf((float)(im * im + re * re));
        sum += a;
        sum2 += a * a;
        cnt++;
    }
    if (cnt == 0)
    {
        s_cb_empty++;
        return;
    }
    const float mean = sum / cnt;
    const float var = sum2 / cnt - mean * mean;
    portENTER_CRITICAL(&s_mux);
    CsiSta_t *s = &s_sta[idx];
    s->n++;
    s->rssi_sum += info->rx_ctrl.rssi;
    s->amp_sum += mean;
    s->var_sum += var;
    s->total++;
    portEXIT_CRITICAL(&s_mux);
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED)
    {
        const wifi_event_ap_staconnected_t *e = data;
        portENTER_CRITICAL(&s_mux);
        const int i = add_sta(e->mac);
        if (i >= 0) s_sta[i].connected = true;
        portEXIT_CRITICAL(&s_mux);
        s_joins++;
    }
    else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STADISCONNECTED)
    {
        const wifi_event_ap_stadisconnected_t *e = data;
        portENTER_CRITICAL(&s_mux);
        const int i = find_sta(e->mac);
        if (i >= 0) s_sta[i].connected = false;
        portEXIT_CRITICAL(&s_mux);
        s_leaves++;
    }
    else if (base == IP_EVENT && id == IP_EVENT_AP_STAIPASSIGNED)
    {
        const ip_event_ap_staipassigned_t *e = data;
        portENTER_CRITICAL(&s_mux);
        const int i = find_sta(e->mac);
        if (i >= 0) s_sta[i].ip = e->ip.addr;
        portEXIT_CRITICAL(&s_mux);
    }
    else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_CONNECTED)
    {
        const wifi_event_sta_connected_t *e = data;
        portENTER_CRITICAL(&s_mux);
        const int i = add_sta(e->bssid);
        if (i >= 0) s_sta[i].connected = true;
        portEXIT_CRITICAL(&s_mux);
        s_joins++;
    }
    else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED)
    {
        s_sta_disc++;
        s_got_ip = false;
        for (int i = 0; i < CSI_MAX_STA; i++) s_sta[i].connected = false;
        if (s_on && s_sta_disc <= 3)
        {
            esp_wifi_connect();   // a few retries to the owner's AP only
        }
    }
    else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP)
    {
        const ip_event_got_ip_t *e = data;
        s_gw_ip = e->ip_info.gw.addr;
        s_got_ip = true;
    }
}

static void ping_ok_cb(esp_ping_handle_t h, void *a) { (void)h; (void)a; s_ping_ok++; }
static void ping_to_cb(esp_ping_handle_t h, void *a) { (void)h; (void)a; s_ping_to++; }

static esp_ping_handle_t ping_start(uint32_t ip, int hz)
{
    esp_ping_config_t pc = ESP_PING_DEFAULT_CONFIG();
    pc.count = ESP_PING_COUNT_INFINITE;
    pc.interval_ms = (uint32_t)(1000 / hz);
    pc.timeout_ms = 1000;
    pc.data_size = 32;
    pc.target_addr.type = IPADDR_TYPE_V4;
    pc.target_addr.u_addr.ip4.addr = ip;
    esp_ping_callbacks_t cbs = {.cb_args = NULL, .on_ping_success = ping_ok_cb, .on_ping_timeout = ping_to_cb, .on_ping_end = NULL};
    esp_ping_handle_t h = NULL;
    if (esp_ping_new_session(&pc, &cbs, &h) != ESP_OK)
    {
        return NULL;
    }
    if (esp_ping_start(h) != ESP_OK)
    {
        esp_ping_delete_session(h);
        return NULL;
    }
    return h;
}

static void print_ip(uint32_t ip) { printf(IPSTR, IP2STR((esp_ip4_addr_t *)&ip)); }

static int csi_usage(void)
{
    printf("{\"cmd\":\"csi\",\"error\":\"usage: csi <seconds> [ap [ch=6] [ping_hz=20]] | csi <seconds> sta <ssid> <pass> [ping_hz=20]\"}\n");
    return 1;
}

static int cmd_csi(int argc, char **argv)
{
    if (argc < 2) return csi_usage();
    int sec = atoi(argv[1]);
    if (sec < 1) sec = 1;
    if (sec > CSI_MAX_SEC) sec = CSI_MAX_SEC;
    const bool sta = (argc >= 3 && strcmp(argv[2], "sta") == 0);
    // mon: passive promiscuous CSI from ONE named transmitter (the owner's router), never associates
    const bool mon = (argc >= 5 && strcmp(argv[2], "mon") == 0);
    uint8_t mon_mac[6] = {0};
    if (mon && sscanf(argv[4], "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx", &mon_mac[0], &mon_mac[1], &mon_mac[2], &mon_mac[3], &mon_mac[4], &mon_mac[5]) != 6) return csi_usage();
    if (argc >= 3 && !sta && !mon && strcmp(argv[2], "ap") != 0) return csi_usage();
    if (sta && argc < 5) return csi_usage();
    int ch = 6, ping_hz = 20;
    if (mon)
    {
        ch = atoi(argv[3]);
        ping_hz = 0;
    }
    else if (!sta)
    {
        if (argc >= 4) ch = atoi(argv[3]);
        if (argc >= 5) ping_hz = atoi(argv[4]);
    }
    else if (argc >= 6)
    {
        ping_hz = atoi(argv[5]);
    }
    if (ch < 1 || ch > 13) ch = 6;
    if (ping_hz < 0) ping_hz = 0;
    if (ping_hz > 50) ping_hz = 50;
    if (xp_mwifi_active())
    {
        printf("{\"cmd\":\"csi\",\"error\":\"mwifi is running: mwifi off first\"}\n");
        return 1;
    }
    xp_awake((uint32_t)sec * 1000 + 30000);
    xp_radio_all_down();

    memset(s_sta, 0, sizeof(s_sta));
    s_cb_total = s_cb_other = s_cb_empty = s_joins = s_leaves = s_sta_disc = 0;
    s_ping_ok = s_ping_to = 0;
    s_gw_ip = 0;
    s_got_ip = false;
    s_sta_mode = sta;
    s_on = false;

    esp_err_t err = esp_netif_init();
    if (err == ESP_OK)
    {
        err = esp_event_loop_create_default();
        if (err == ESP_ERR_INVALID_STATE) err = ESP_OK;
    }
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"csi\",\"error\":\"netif/event %s\"}\n", esp_err_to_name(err));
        return 1;
    }
    esp_netif_t *netif = (sta || mon) ? esp_netif_create_default_wifi_sta() : esp_netif_create_default_wifi_ap();
    if (netif == NULL)
    {
        printf("{\"cmd\":\"csi\",\"error\":\"netif no mem\"}\n");
        return 1;
    }
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    cfg.nvs_enable = 0;
    err = esp_wifi_init(&cfg);
    if (err != ESP_OK)
    {
        esp_netif_destroy_default_wifi(netif);
        printf("{\"cmd\":\"csi\",\"error\":\"wifi_init %s\"}\n", esp_err_to_name(err));
        return 1;
    }
    esp_wifi_set_storage(WIFI_STORAGE_RAM);
    esp_event_handler_instance_t h_wifi = NULL, h_ip = NULL;
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, &h_wifi);
    esp_event_handler_instance_register(IP_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, &h_ip);

    char pass[16] = {0};
    wifi_config_t wc = {0};
    if (sta)
    {
        strlcpy((char *)wc.sta.ssid, argv[3], sizeof(wc.sta.ssid));
        strlcpy((char *)wc.sta.password, argv[4], sizeof(wc.sta.password));
        wc.sta.threshold.authmode = WIFI_AUTH_OPEN;
        err = esp_wifi_set_mode(WIFI_MODE_STA);
        if (err == ESP_OK) err = esp_wifi_set_config(WIFI_IF_STA, &wc);
    }
    else if (mon)
    {
        err = esp_wifi_set_mode(WIFI_MODE_STA);
    }
    else
    {
        const uint32_t r = esp_random();
        snprintf(pass, sizeof(pass), "cmx%08lx", (unsigned long)r);
        static const char kSsid[] = "CMX-CSI";
        memcpy(wc.ap.ssid, kSsid, sizeof(kSsid) - 1);
        wc.ap.ssid_len = sizeof(kSsid) - 1;
        strlcpy((char *)wc.ap.password, pass, sizeof(wc.ap.password));
        wc.ap.channel = (uint8_t)ch;
        wc.ap.authmode = WIFI_AUTH_WPA2_PSK;
        wc.ap.max_connection = 2;
        wc.ap.beacon_interval = 100;
        wc.ap.pmf_cfg.required = false;
        err = esp_wifi_set_mode(WIFI_MODE_AP);
        if (err == ESP_OK) err = esp_wifi_set_config(WIFI_IF_AP, &wc);
    }
    if (err == ESP_OK) err = esp_wifi_start();
    if (err == ESP_OK)
    {
        const wifi_csi_config_t cc = {
            .lltf_en = true, .htltf_en = false, .stbc_htltf2_en = false, .ltf_merge_en = false,
            .channel_filter_en = false, .manu_scale = false, .shift = 0, .dump_ack_en = false,
        };
        err = esp_wifi_set_csi_config(&cc);
        if (err == ESP_OK) err = esp_wifi_set_csi_rx_cb(csi_cb, NULL);
        if (err == ESP_OK) err = esp_wifi_set_csi(true);
        if (err == ESP_OK && mon)
        {
            err = esp_wifi_set_promiscuous(true);
            if (err == ESP_OK) err = esp_wifi_set_channel((uint8_t)ch, WIFI_SECOND_CHAN_NONE);
            portENTER_CRITICAL(&s_mux);
            add_sta(mon_mac);
            portEXIT_CRITICAL(&s_mux);
        }
    }
    uint32_t ap_ip = 0;
    if (err == ESP_OK)
    {
        s_on = true;
        if (sta)
        {
            err = esp_wifi_connect();
        }
        else if (mon)
        {
        }
        else
        {
            esp_netif_ip_info_t ip = {0};
            esp_netif_get_ip_info(netif, &ip);
            ap_ip = ip.ip.addr;
        }
    }
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"csi\",\"error\":\"setup %s\"}\n", esp_err_to_name(err));
    }
    else
    {
        uint8_t mac[6];
        esp_read_mac(mac, sta ? ESP_MAC_WIFI_STA : ESP_MAC_WIFI_SOFTAP);
        printf("{\"cmd\":\"csi\",\"mode\":\"%s\",\"sec\":%d,\"ping_hz\":%d,\"bin_ms\":%d,\"our_mac\":\"", sta ? "sta" : mon ? "mon" : "ap", sec,
               ping_hz, CSI_BIN_MS);
        xp_print_mac(mac);
        if (mon)
        {
            printf("\",\"ch\":%d,\"target\":\"", ch);
            xp_print_mac(mon_mac);
            printf("\"");
        }
        else if (sta)
        {
            printf("\",\"ssid\":\"");
            xp_print_escaped(wc.sta.ssid, strnlen((const char *)wc.sta.ssid, sizeof(wc.sta.ssid)));
            printf("\"");
        }
        else
        {
            printf("\",\"ssid\":\"CMX-CSI\",\"pass\":\"%s\",\"auth\":\"wpa2\",\"ch\":%d,\"ip\":\"", pass, ch);
            print_ip(ap_ip);
            printf("\",\"hint\":\"join, then: sudo ping -i 0.05 ");
            print_ip(ap_ip);
            printf("\"");
        }
        printf(",\"free_internal\":%u}\n", (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
        printf("{\"cmd\":\"csi\",\"fields\":\"t=ms since start, m=mac tail, r=mean rssi dBm, a=mean |H| over LLTF subcarriers, "
               "v=mean across-subcarrier variance of |H|, n=frames in the 50 ms bin\"}\n");
        fflush(stdout);
    }

    esp_ping_handle_t ping = NULL;
    uint32_t ping_ip = 0;
    int lines = 0;
    uint32_t lines_dropped = 0, joins_seen = 0, leaves_seen = 0;
    const int64_t t0 = esp_timer_get_time();
    const int64_t end = t0 + (int64_t)sec * 1000000;
    int64_t next = t0 + CSI_BIN_MS * 1000;
    while (err == ESP_OK && esp_timer_get_time() < end)
    {
        const int64_t now = esp_timer_get_time();
        if (now < next)
        {
            const int64_t wait_ms = (next - now) / 1000;
            vTaskDelay(wait_ms >= 10 ? pdMS_TO_TICKS(wait_ms) : 1);
            continue;
        }
        next += CSI_BIN_MS * 1000;
        const uint32_t t_ms = (uint32_t)((now - t0) / 1000);

        // join/leave notices (MACs here are the owner's own devices that joined our AP / the joined AP)
        if (s_joins != joins_seen || s_leaves != leaves_seen)
        {
            joins_seen = s_joins;
            leaves_seen = s_leaves;
            for (int i = 0; i < CSI_MAX_STA; i++)
            {
                if (!s_sta[i].used) continue;
                printf("{\"cmd\":\"csi\",\"t\":%lu,\"ev\":\"sta\",\"mac\":\"", (unsigned long)t_ms);
                xp_print_mac(s_sta[i].mac);
                printf("\",\"connected\":%d,\"ip\":\"", s_sta[i].connected);
                print_ip(s_sta[i].ip);
                printf("\"}\n");
            }
        }
        // traffic generator toward the owner's device
        if (ping == NULL && ping_hz > 0)
        {
            uint32_t target = 0;
            if (sta)
            {
                if (s_got_ip) target = s_gw_ip;
            }
            else
            {
                portENTER_CRITICAL(&s_mux);
                for (int i = 0; i < CSI_MAX_STA && target == 0; i++)
                {
                    if (s_sta[i].used && s_sta[i].connected && s_sta[i].ip) target = s_sta[i].ip;
                }
                portEXIT_CRITICAL(&s_mux);
            }
            if (target)
            {
                ping = ping_start(target, ping_hz);
                ping_ip = target;
                printf("{\"cmd\":\"csi\",\"t\":%lu,\"ev\":\"ping\",\"target\":\"", (unsigned long)t_ms);
                print_ip(target);
                printf("\",\"ok\":%d}\n", ping != NULL);
            }
        }
        // one line per station with frames in this bin
        for (int i = 0; i < CSI_MAX_STA; i++)
        {
            portENTER_CRITICAL(&s_mux);
            CsiSta_t snap = s_sta[i];
            s_sta[i].n = 0;
            s_sta[i].rssi_sum = 0;
            s_sta[i].amp_sum = 0;
            s_sta[i].var_sum = 0;
            if (snap.n) s_sta[i].bins++;
            portEXIT_CRITICAL(&s_mux);
            if (!snap.used || snap.n == 0) continue;
            if (lines >= CSI_MAX_LINES)
            {
                lines_dropped++;
                continue;
            }
            lines++;
            printf("{\"t\":%lu,\"m\":\"%02x%02x\",\"r\":%.1f,\"a\":%.2f,\"v\":%.2f,\"n\":%lu}\n", (unsigned long)t_ms, snap.mac[4],
                   snap.mac[5], (double)snap.rssi_sum / snap.n, (double)(snap.amp_sum / snap.n), (double)(snap.var_sum / snap.n),
                   (unsigned long)snap.n);
        }
    }

    // ---- teardown
    if (ping != NULL)
    {
        esp_ping_stop(ping);
        esp_ping_delete_session(ping);
    }
    s_on = false;
    if (mon) esp_wifi_set_promiscuous(false);
    esp_wifi_set_csi(false);
    esp_wifi_set_csi_rx_cb(NULL, NULL);
    vTaskDelay(2);
    const uint32_t heap_up = (uint32_t)heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    if (sta) esp_wifi_disconnect();
    esp_wifi_stop();
    esp_wifi_deinit();
    if (h_wifi) esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, h_wifi);
    if (h_ip) esp_event_handler_instance_unregister(IP_EVENT, ESP_EVENT_ANY_ID, h_ip);
    esp_netif_destroy_default_wifi(netif);

    const double el = (esp_timer_get_time() - t0) / 1e6;
    for (int i = 0; i < CSI_MAX_STA; i++)
    {
        if (!s_sta[i].used) continue;
        printf("{\"cmd\":\"csi\",\"sta\":\"");
        xp_print_mac(s_sta[i].mac);
        printf("\",\"frames\":%lu,\"fps\":%.1f,\"bins_with_data\":%lu}\n", (unsigned long)s_sta[i].total,
               el > 0 ? s_sta[i].total / el : 0.0, (unsigned long)s_sta[i].bins);
    }
    printf("{\"cmd\":\"csi\",\"done\":true,\"err\":\"%s\",\"elapsed_s\":%.1f,\"lines\":%d,\"lines_dropped\":%lu,\"cb_total\":%lu,"
           "\"cb_other_tx_ignored\":%lu,\"cb_empty\":%lu,\"joins\":%lu,\"leaves\":%lu,\"sta_disc\":%lu,\"ping_target\":\"",
           esp_err_to_name(err), el, lines, (unsigned long)lines_dropped, (unsigned long)s_cb_total, (unsigned long)s_cb_other,
           (unsigned long)s_cb_empty, (unsigned long)s_joins, (unsigned long)s_leaves, (unsigned long)s_sta_disc);
    print_ip(ping_ip);
    printf("\",\"ping_ok\":%lu,\"ping_timeout\":%lu,\"free_internal_while_up\":%lu,\"free_internal_after\":%u}\n",
           (unsigned long)s_ping_ok, (unsigned long)s_ping_to, (unsigned long)heap_up,
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    return err == ESP_OK ? 0 : 1;
}

void xp_register_csi_cmds(void)
{
    const esp_console_cmd_t c = {
        .command = "csi",
        .help = "xp2: csi <s> [ap [ch=6] [ping_hz=20]] | csi <s> sta <ssid> <pass> [ping_hz] | csi <s> mon <ch> <bssid> - CSI series from own devices",
        .func = cmd_csi,
    };
    esp_console_cmd_register(&c);
}
