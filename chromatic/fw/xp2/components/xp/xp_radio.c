// fw/xp: radio experiments (Wi-Fi passive scan / promiscuous counters, ESP-NOW, NimBLE scan/beacon).
//
// RAM policy: Wi-Fi and BLE are MUTUALLY EXCLUSIVE at runtime. Every command brings up only the
// stack it needs and tears it down again before returning (wifi_down/ble_down), so the medic app
// sees its normal heap between commands. Wi-Fi never touches NVS (nvs_enable=0, RAM storage,
// PHY calibration storage disabled in sdkconfig).

#include "xp_priv.h"

#include "esp_console.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_mac.h"
#include "esp_now.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "host/ble_gap.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"

#include <stdlib.h>
#include <string.h>

static bool s_wifi_on = false;
static bool s_ble_on = false;
static SemaphoreHandle_t s_sem = NULL;    // generic "done" signal for callbacks

static void sem_init(void)
{
    if (s_sem == NULL)
    {
        s_sem = xSemaphoreCreateBinary();
    }
    (void)xSemaphoreTake(s_sem, 0);
}

static void heap_line(const char *tag)
{
    printf("{\"cmd\":\"radio\",\"at\":\"%s\",\"free_internal\":%u,\"largest\":%u}\n", tag,
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL), (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL));
}

// ================================================================================================ Wi-Fi
static void ble_down(void);

static void wifi_down(void)
{
    if (!s_wifi_on)
    {
        return;
    }
    esp_wifi_set_promiscuous(false);
    esp_wifi_stop();
    esp_wifi_deinit();
    s_wifi_on = false;
}

static esp_err_t wifi_up(void)
{
    if (xp_mwifi_active())
    {
        return ESP_ERR_INVALID_STATE;   // softAP running: "mwifi off" first
    }
    ble_down();
    if (s_wifi_on)
    {
        return ESP_OK;
    }
    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE)
    {
        return err;
    }
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    cfg.nvs_enable = 0;
    err = esp_wifi_init(&cfg);
    if (err != ESP_OK)
    {
        return err;
    }
    esp_wifi_set_storage(WIFI_STORAGE_RAM);
    err = esp_wifi_set_mode(WIFI_MODE_STA);   // STA, never connects: no TX unless asked (espnow_tx)
    if (err == ESP_OK)
    {
        err = esp_wifi_start();
    }
    if (err != ESP_OK)
    {
        esp_wifi_deinit();
        return err;
    }
    s_wifi_on = true;
    return ESP_OK;
}

static const char *auth_name(int a)
{
    static const char *n[] = {"open", "wep", "wpa", "wpa2", "wpa/wpa2", "wpa2-ent", "wpa3", "wpa2/wpa3",
                              "wapi", "owe", "wpa3-ent192", "wpa3-ext", "wpa3-ext-mixed", "dpp"};
    return (a >= 0 && a < (int)(sizeof(n) / sizeof(n[0]))) ? n[a] : "?";
}

// wifiscan [dwell_ms=150]  (PASSIVE: listens for beacons only, no probe requests)
static int cmd_wifiscan(int argc, char **argv)
{
    int dwell = (argc >= 2) ? atoi(argv[1]) : 150;
    if (dwell < 50) dwell = 50;
    if (dwell > 1500) dwell = 1500;
    xp_awake(30000 + dwell * 14);

    esp_err_t err = wifi_up();
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"wifiscan\",\"error\":\"wifi_up %s\"}\n", esp_err_to_name(err));
        return 1;
    }
    heap_line("wifi_up");
    wifi_scan_config_t sc = {0};
    sc.show_hidden = true;
    sc.scan_type = WIFI_SCAN_TYPE_PASSIVE;
    sc.scan_time.passive = (uint32_t)dwell;
    const int64_t t0 = esp_timer_get_time();
    err = esp_wifi_scan_start(&sc, true);
    const int64_t dt = esp_timer_get_time() - t0;
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"wifiscan\",\"error\":\"scan %s\"}\n", esp_err_to_name(err));
        wifi_down();
        return 1;
    }
    uint16_t total = 0;
    esp_wifi_scan_get_ap_num(&total);
    uint16_t n = total > 40 ? 40 : total;
    wifi_ap_record_t *recs = calloc(n ? n : 1, sizeof(wifi_ap_record_t));
    if (recs == NULL)
    {
        esp_wifi_clear_ap_list();
        printf("{\"cmd\":\"wifiscan\",\"error\":\"no mem\"}\n");
        wifi_down();
        return 1;
    }
    esp_wifi_scan_get_ap_records(&n, recs);
    if (n < total)
    {
        esp_wifi_clear_ap_list();
    }
    int out = printf("{\"cmd\":\"wifiscan\",\"type\":\"passive\",\"dwell_ms\":%d,\"scan_ms\":%lld,\"aps\":%u}\n",
                     dwell, (long long)(dt / 1000), (unsigned)total);
    uint16_t printed = 0;
    for (uint16_t i = 0; i < n && out < XP_OUT_BUDGET - 200; i++)
    {
        out += printf("{\"cmd\":\"wifiscan\",\"ssid\":\"");
        const size_t sl = strnlen((const char *)recs[i].ssid, sizeof(recs[i].ssid));
        xp_print_escaped(recs[i].ssid, sl);
        out += (int)sl * 2;   // rough
        out += printf("\",\"bssid\":\"");
        xp_print_mac(recs[i].bssid);
        out += printf("\",\"ch\":%u,\"rssi\":%d,\"auth\":%d,\"auth_s\":\"%s\"}\n", recs[i].primary, recs[i].rssi,
                      (int)recs[i].authmode, auth_name((int)recs[i].authmode)) + 17;
        printed++;
    }
    if (printed < total)
    {
        printf("{\"cmd\":\"wifiscan\",\"truncated\":%u}\n", (unsigned)(total - printed));
    }
    free(recs);
    wifi_down();
    return 0;
}

// ---- promiscuous counters (receive only; payloads are never stored or printed) ----
enum { kMacSet = 256, kRssiBins = 10 };
typedef struct {
    uint32_t by_type[4][16];   // [mgmt/ctrl/data/ext][subtype]
    uint32_t misc, total, bytes, no_addr2, mac_overflow, bcast_dst;
    uint32_t rssi_bins[kRssiBins];   // <-90, -90..-81, ..., >=-20
    int8_t rssi_min, rssi_max;
    uint32_t per_ch[15];
    uint16_t nmac;
    uint8_t macs[kMacSet][6];
} Sniff_t;
static Sniff_t *s_sn = NULL;

static void sniff_cb(void *buf, wifi_promiscuous_pkt_type_t type)
{
    Sniff_t *s = s_sn;
    if (s == NULL || buf == NULL)
    {
        return;
    }
    const wifi_promiscuous_pkt_t *p = (const wifi_promiscuous_pkt_t *)buf;
    const int rssi = p->rx_ctrl.rssi;
    const unsigned len = p->rx_ctrl.sig_len;
    s->total++;
    s->bytes += len;
    if (p->rx_ctrl.channel < 15) s->per_ch[p->rx_ctrl.channel]++;
    if (rssi < s->rssi_min) s->rssi_min = (int8_t)rssi;
    if (rssi > s->rssi_max) s->rssi_max = (int8_t)rssi;
    int bin = (rssi + 100) / 10;
    if (bin < 0) bin = 0;
    if (bin >= kRssiBins) bin = kRssiBins - 1;
    s->rssi_bins[bin]++;
    if (type == WIFI_PKT_MISC || len < 2)
    {
        s->misc++;
        return;
    }
    const uint8_t fc0 = p->payload[0];
    s->by_type[(fc0 >> 2) & 3][(fc0 >> 4) & 0xF]++;
    if (len >= 10 && p->payload[4] == 0xFF && p->payload[5] == 0xFF && p->payload[6] == 0xFF)
    {
        s->bcast_dst++;
    }
    if (len < 16)
    {
        s->no_addr2++;   // ACK/CTS etc. carry only addr1
        return;
    }
    const uint8_t *a2 = &p->payload[10];
    for (uint16_t i = 0; i < s->nmac; i++)
    {
        if (memcmp(s->macs[i], a2, 6) == 0)
        {
            return;
        }
    }
    if (s->nmac < kMacSet)
    {
        memcpy(s->macs[s->nmac++], a2, 6);
    }
    else
    {
        s->mac_overflow++;
    }
}

// wifisniff <seconds> <channel 1-13, 0 = hop 1..13>
static int cmd_wifisniff(int argc, char **argv)
{
    int sec = (argc >= 2) ? atoi(argv[1]) : 10;
    int ch = (argc >= 3) ? atoi(argv[2]) : 1;
    if (sec < 1) sec = 1;
    if (sec > 300) sec = 300;
    if (ch < 0 || ch > 13)
    {
        printf("{\"cmd\":\"wifisniff\",\"error\":\"channel 0..13\"}\n");
        return 1;
    }
    xp_awake((uint32_t)sec * 1000 + 30000);

    Sniff_t *s = calloc(1, sizeof(Sniff_t));
    if (s == NULL)
    {
        printf("{\"cmd\":\"wifisniff\",\"error\":\"no mem\"}\n");
        return 1;
    }
    s->rssi_min = 127;
    s->rssi_max = -128;
    esp_err_t err = wifi_up();
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"wifisniff\",\"error\":\"wifi_up %s\"}\n", esp_err_to_name(err));
        free(s);
        return 1;
    }
    heap_line("wifi_up");
    const wifi_promiscuous_filter_t f = {.filter_mask = WIFI_PROMIS_FILTER_MASK_ALL};
    const wifi_promiscuous_filter_t cf = {.filter_mask = WIFI_PROMIS_CTRL_FILTER_MASK_ALL};
    esp_wifi_set_promiscuous_filter(&f);
    esp_wifi_set_promiscuous_ctrl_filter(&cf);
    s_sn = s;
    esp_wifi_set_promiscuous_rx_cb(sniff_cb);
    esp_wifi_set_promiscuous(true);
    int cur = ch ? ch : 1;
    esp_wifi_set_channel((uint8_t)cur, WIFI_SECOND_CHAN_NONE);

    const int64_t end = esp_timer_get_time() + (int64_t)sec * 1000000;
    int64_t next_hop = esp_timer_get_time() + 250000;
    while (esp_timer_get_time() < end)
    {
        vTaskDelay(pdMS_TO_TICKS(20));
        if (ch == 0 && esp_timer_get_time() >= next_hop)
        {
            cur = (cur % 13) + 1;
            esp_wifi_set_channel((uint8_t)cur, WIFI_SECOND_CHAN_NONE);
            next_hop += 250000;
        }
    }
    esp_wifi_set_promiscuous(false);
    esp_wifi_set_promiscuous_rx_cb(NULL);
    vTaskDelay(2);
    s_sn = NULL;
    wifi_down();

    printf("{\"cmd\":\"wifisniff\",\"sec\":%d,\"ch\":%d,\"frames\":%lu,\"bytes\":%lu,\"misc\":%lu,\"unique_tx_macs\":%u,"
           "\"mac_overflow\":%lu,\"no_addr2\":%lu,\"bcast_dst\":%lu,\"rssi_min\":%d,\"rssi_max\":%d}\n",
           sec, ch, (unsigned long)s->total, (unsigned long)s->bytes, (unsigned long)s->misc, s->nmac,
           (unsigned long)s->mac_overflow, (unsigned long)s->no_addr2, (unsigned long)s->bcast_dst,
           s->total ? s->rssi_min : 0, s->total ? s->rssi_max : 0);
    static const char *tn[4] = {"mgmt", "ctrl", "data", "ext"};
    for (int t = 0; t < 4; t++)
    {
        printf("{\"cmd\":\"wifisniff\",\"type\":\"%s\",\"subtype_counts\":[", tn[t]);
        for (int st = 0; st < 16; st++)
        {
            printf("%s%lu", st ? "," : "", (unsigned long)s->by_type[t][st]);
        }
        printf("]}\n");
    }
    printf("{\"cmd\":\"wifisniff\",\"rssi_hist_10dB_from_-100\":[");
    for (int b = 0; b < kRssiBins; b++)
    {
        printf("%s%lu", b ? "," : "", (unsigned long)s->rssi_bins[b]);
    }
    printf("],\"per_ch\":[");
    for (int c = 1; c <= 14; c++)
    {
        printf("%s%lu", c > 1 ? "," : "", (unsigned long)s->per_ch[c]);
    }
    printf("],\"mgmt_names\":\"0=assoc_req 4=probe_req 5=probe_resp 8=beacon 10=disassoc 11=auth 12=deauth 13=action\"}\n");
    free(s);
    return 0;
}

// ================================================================================================ ESP-NOW
static const uint8_t kBcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static const char kTag[7] = {'C', 'M', 'X', 'T', 'E', 'S', 'T'};
static volatile uint32_t s_tx_ok, s_tx_fail;

static void espnow_send_cb(const uint8_t *mac, esp_now_send_status_t st)
{
    (void)mac;
    if (st == ESP_NOW_SEND_SUCCESS) s_tx_ok++;
    else s_tx_fail++;
    xSemaphoreGive(s_sem);
}

static esp_err_t espnow_up(int ch)
{
    esp_err_t err = wifi_up();
    if (err != ESP_OK) return err;
    esp_wifi_set_promiscuous(true);   // needed for set_channel while unassociated; rx cb stays NULL
    err = esp_wifi_set_channel((uint8_t)ch, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    if (err != ESP_OK) return err;
    return esp_now_init();
}

static void espnow_down(void)
{
    esp_now_deinit();
    wifi_down();
}

// Shared by espnow_tx and espnow_lr. lr_kbps = 0: default protocol/rate (1 Mbps broadcast);
// 250 or 500: WIFI_PROTOCOL_LR only, peer rate WIFI_PHY_MODE_LR / LORA_250K or LORA_500K.
static int espnow_tx_run(const char *name, int argc, char **argv, int lr_kbps)
{
    int count = (argc >= 2) ? atoi(argv[1]) : 100;
    int bytes = (argc >= 3) ? atoi(argv[2]) : 64;
    int ch = (argc >= 4) ? atoi(argv[3]) : 1;
    if (count < 1) count = 1;
    if (count > 20000) count = 20000;
    if (bytes < 11) bytes = 11;
    if (bytes > ESP_NOW_MAX_DATA_LEN) bytes = ESP_NOW_MAX_DATA_LEN;
    if (ch < 1 || ch > 13) ch = 1;
    xp_awake((uint32_t)count * 20 + 30000);
    sem_init();

    esp_err_t err = espnow_up(ch);
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"%s\",\"error\":\"up %s\"}\n", name, esp_err_to_name(err));
        espnow_down();
        return 1;
    }
    esp_err_t proto_err = ESP_OK, rate_err = ESP_OK;
    uint8_t proto = 0;
    if (lr_kbps)
    {
        proto_err = esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_LR);
    }
    (void)esp_wifi_get_protocol(WIFI_IF_STA, &proto);
    esp_now_register_send_cb(espnow_send_cb);
    esp_now_peer_info_t peer = {0};
    memcpy(peer.peer_addr, kBcast, 6);
    peer.channel = 0;   // current channel
    peer.ifidx = WIFI_IF_STA;
    peer.encrypt = false;
    esp_now_add_peer(&peer);
    if (lr_kbps)
    {
        esp_now_rate_config_t rc = {.phymode = WIFI_PHY_MODE_LR,
                                    .rate = (lr_kbps == 500) ? WIFI_PHY_RATE_LORA_500K : WIFI_PHY_RATE_LORA_250K,
                                    .ersu = false, .dcm = false};
        rate_err = esp_now_set_peer_rate_config(kBcast, &rc);
    }

    uint8_t *buf = malloc((size_t)bytes);
    if (buf == NULL)
    {
        espnow_down();
        return 1;
    }
    for (int i = 0; i < bytes; i++) buf[i] = (uint8_t)i;
    memcpy(buf, kTag, sizeof(kTag));
    s_tx_ok = s_tx_fail = 0;
    uint32_t send_err = 0, cb_timeout = 0;
    const int64_t t0 = esp_timer_get_time();
    for (int i = 0; i < count; i++)
    {
        const uint32_t seq = (uint32_t)i;
        memcpy(&buf[7], &seq, 4);
        if (esp_now_send(kBcast, buf, (size_t)bytes) != ESP_OK)
        {
            send_err++;
            vTaskDelay(1);
            continue;
        }
        if (xSemaphoreTake(s_sem, pdMS_TO_TICKS(100)) != pdTRUE)
        {
            cb_timeout++;
        }
        if ((i & 31) == 31) vTaskDelay(1);
    }
    const int64_t us = esp_timer_get_time() - t0;
    free(buf);
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    espnow_down();
    const double fps = us > 0 ? (double)count * 1e6 / (double)us : 0;
    printf("{\"cmd\":\"%s\",\"src\":\"", name);
    xp_print_mac(mac);
    printf("\",\"ch\":%d,\"count\":%d,\"bytes\":%d,\"us\":%lld,\"fps\":%.1f,\"kbps\":%.1f,\"ok\":%lu,\"fail\":%lu,\"send_err\":%lu,\"cb_timeout\":%lu,"
           "\"protocol\":\"0x%02x\",\"lr\":%s,\"phy_kbps\":%d,\"proto_err\":\"%s\",\"rate_err\":\"%s\","
           "\"note\":\"broadcast has no ACK: ok = left the radio\"}\n",
           ch, count, bytes, (long long)us, fps, fps * bytes * 8 / 1000.0, (unsigned long)s_tx_ok, (unsigned long)s_tx_fail,
           (unsigned long)send_err, (unsigned long)cb_timeout, proto, lr_kbps ? "true" : "false", lr_kbps ? lr_kbps : 1000,
           esp_err_to_name(proto_err), esp_err_to_name(rate_err));
    return 0;
}

// espnow_tx <count> <bytes 11..250> [channel=1]
static int cmd_espnow_tx(int argc, char **argv) { return espnow_tx_run("espnow_tx", argc, argv, 0); }

// espnow_lr <count> <bytes 11..250> [channel=1] [rate_kbps=250|500]  802.11 LR (Espressif long range) only
static int cmd_espnow_lr(int argc, char **argv)
{
    const int kbps = (argc >= 5 && atoi(argv[4]) == 500) ? 500 : 250;
    return espnow_tx_run("espnow_lr", argc, argv, kbps);
}

typedef struct {
    uint32_t total, tagged, bytes, seq_gaps;
    int rssi_min, rssi_max;
    int64_t rssi_sum;
    uint32_t last_seq;
    bool have_seq;
    uint8_t nsrc;
    uint8_t src[8][6];
    int64_t first_us, last_us;
} NowRx_t;
static NowRx_t *s_nr = NULL;

static void espnow_recv_cb(const esp_now_recv_info_t *info, const uint8_t *data, int len)
{
    NowRx_t *r = s_nr;
    if (r == NULL || info == NULL)
    {
        return;
    }
    const int64_t t = esp_timer_get_time();
    if (r->total == 0) r->first_us = t;
    r->last_us = t;
    r->total++;
    r->bytes += (uint32_t)len;
    const int rssi = info->rx_ctrl ? info->rx_ctrl->rssi : 0;
    r->rssi_sum += rssi;
    if (rssi < r->rssi_min) r->rssi_min = rssi;
    if (rssi > r->rssi_max) r->rssi_max = rssi;
    if (len >= 11 && memcmp(data, kTag, sizeof(kTag)) == 0)
    {
        r->tagged++;
        uint32_t seq;
        memcpy(&seq, &data[7], 4);
        if (r->have_seq && seq != r->last_seq + 1) r->seq_gaps++;
        r->last_seq = seq;
        r->have_seq = true;
    }
    bool found = false;
    for (uint8_t i = 0; i < r->nsrc; i++)
    {
        if (memcmp(r->src[i], info->src_addr, 6) == 0) { found = true; break; }
    }
    if (!found && r->nsrc < 8)
    {
        memcpy(r->src[r->nsrc++], info->src_addr, 6);
    }
}

// espnow_rx <seconds> [channel=1]
static int cmd_espnow_rx(int argc, char **argv)
{
    int sec = (argc >= 2) ? atoi(argv[1]) : 10;
    int ch = (argc >= 3) ? atoi(argv[2]) : 1;
    const bool lr = (argc >= 4 && strcmp(argv[3], "lr") == 0);
    if (sec < 1) sec = 1;
    if (sec > 600) sec = 600;
    if (ch < 1 || ch > 13) ch = 1;
    xp_awake((uint32_t)sec * 1000 + 30000);

    NowRx_t *r = calloc(1, sizeof(NowRx_t));
    if (r == NULL) return 1;
    r->rssi_min = 127;
    r->rssi_max = -128;
    esp_err_t err = espnow_up(ch);
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"espnow_rx\",\"error\":\"up %s\"}\n", esp_err_to_name(err));
        espnow_down();
        free(r);
        return 1;
    }
    if (lr)
    {
        (void)esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_LR);   // receive 802.11 LR frames (espnow_lr on a 2nd unit)
    }
    s_nr = r;
    esp_now_register_recv_cb(espnow_recv_cb);
    const int64_t end = esp_timer_get_time() + (int64_t)sec * 1000000;
    while (esp_timer_get_time() < end)
    {
        vTaskDelay(pdMS_TO_TICKS(50));
    }
    esp_now_unregister_recv_cb();
    vTaskDelay(2);
    s_nr = NULL;
    espnow_down();

    const double span = (r->total > 1) ? (double)(r->last_us - r->first_us) / 1e6 : 0;
    printf("{\"cmd\":\"espnow_rx\",\"lr\":%s,\"sec\":%d,\"ch\":%d,\"frames\":%lu,\"tagged_CMXTEST\":%lu,\"bytes\":%lu,\"seq_gaps\":%lu,"
           "\"fps\":%.1f,\"rssi_avg\":%.1f,\"rssi_min\":%d,\"rssi_max\":%d,\"srcs\":[",
           lr ? "true" : "false", sec, ch, (unsigned long)r->total, (unsigned long)r->tagged, (unsigned long)r->bytes, (unsigned long)r->seq_gaps,
           span > 0 ? (double)r->total / span : 0.0, r->total ? (double)r->rssi_sum / r->total : 0.0,
           r->total ? r->rssi_min : 0, r->total ? r->rssi_max : 0);
    for (uint8_t i = 0; i < r->nsrc; i++)
    {
        printf("%s\"", i ? "," : "");
        xp_print_mac(r->src[i]);
        printf("\"");
    }
    printf("]}\n");
    free(r);
    return 0;
}

// ================================================================================================ BLE (NimBLE)
static volatile bool s_ble_synced = false;

static void ble_on_sync(void)
{
    s_ble_synced = true;
    xSemaphoreGive(s_sem);
}

static void ble_on_reset(int reason)
{
    (void)reason;
    s_ble_synced = false;
}

static void ble_host_task(void *param)
{
    (void)param;
    nimble_port_run();            // returns after nimble_port_stop()
    nimble_port_freertos_deinit();
}

static void ble_down(void)
{
    if (!s_ble_on)
    {
        return;
    }
    if (nimble_port_stop() == 0)
    {
        vTaskDelay(2);
        nimble_port_deinit();
    }
    s_ble_on = false;
    s_ble_synced = false;
}

static esp_err_t ble_up(void)
{
    if (xp_mwifi_active())
    {
        return ESP_ERR_INVALID_STATE;   // softAP running: "mwifi off" first
    }
    wifi_down();
    if (s_ble_on)
    {
        return ESP_OK;
    }
    sem_init();
    s_ble_synced = false;
    esp_err_t err = nimble_port_init();
    if (err != ESP_OK)
    {
        return err;
    }
    ble_hs_cfg.sync_cb = ble_on_sync;
    ble_hs_cfg.reset_cb = ble_on_reset;
    s_ble_on = true;
    nimble_port_freertos_init(ble_host_task);
    if (xSemaphoreTake(s_sem, pdMS_TO_TICKS(3000)) != pdTRUE || !s_ble_synced)
    {
        ble_down();
        return ESP_ERR_TIMEOUT;
    }
    return ESP_OK;
}

enum { kBleMaxDev = 64 };
typedef struct {
    ble_addr_t addr;
    int8_t rssi, rssi_max;
    uint8_t evmask;   // bit per BLE_HCI_ADV_RPT_EVTYPE_*
    uint8_t has_mfg;
    uint16_t mfg;
    uint32_t count;
    char name[21];
} BleDev_t;
typedef struct {
    uint32_t events;
    uint32_t overflow;
    uint16_t n;
    BleDev_t d[kBleMaxDev];
} BleScan_t;
static BleScan_t *s_bs = NULL;

static void parse_adv(BleDev_t *d, const uint8_t *p, uint8_t len)
{
    uint8_t i = 0;
    while (i + 1 < len)
    {
        const uint8_t l = p[i];
        if (l == 0 || i + 1 + l > len) break;
        const uint8_t t = p[i + 1];
        const uint8_t *v = &p[i + 2];
        const uint8_t vl = l - 1;
        if ((t == 0x08 || t == 0x09) && (d->name[0] == 0 || t == 0x09))
        {
            const uint8_t n = vl < 20 ? vl : 20;
            memcpy(d->name, v, n);
            d->name[n] = 0;
        }
        else if (t == 0xFF && vl >= 2)
        {
            d->has_mfg = 1;
            d->mfg = (uint16_t)(v[0] | (v[1] << 8));
        }
        i += 1 + l;
    }
}

static int ble_scan_cb(struct ble_gap_event *ev, void *arg)
{
    (void)arg;
    BleScan_t *s = s_bs;
    if (ev->type == BLE_GAP_EVENT_DISC_COMPLETE)
    {
        xSemaphoreGive(s_sem);
        return 0;
    }
    if (ev->type != BLE_GAP_EVENT_DISC || s == NULL)
    {
        return 0;
    }
    const struct ble_gap_disc_desc *dd = &ev->disc;
    s->events++;
    BleDev_t *d = NULL;
    for (uint16_t i = 0; i < s->n; i++)
    {
        if (ble_addr_cmp(&s->d[i].addr, &dd->addr) == 0) { d = &s->d[i]; break; }
    }
    if (d == NULL)
    {
        if (s->n >= kBleMaxDev) { s->overflow++; return 0; }
        d = &s->d[s->n++];
        memset(d, 0, sizeof(*d));
        d->addr = dd->addr;
        d->rssi_max = -128;
    }
    d->count++;
    d->rssi = dd->rssi;
    if (dd->rssi > d->rssi_max) d->rssi_max = dd->rssi;
    if (dd->event_type < 8) d->evmask |= (uint8_t)(1u << dd->event_type);
    parse_adv(d, dd->data, dd->length_data);
    return 0;
}

static int cmp_dev(const void *a, const void *b)
{
    return ((const BleDev_t *)b)->rssi_max - ((const BleDev_t *)a)->rssi_max;
}

// blescan <seconds>  (passive: no SCAN_REQ is ever transmitted)
static int cmd_blescan(int argc, char **argv)
{
    int sec = (argc >= 2) ? atoi(argv[1]) : 5;
    if (sec < 1) sec = 1;
    if (sec > 120) sec = 120;
    xp_awake((uint32_t)sec * 1000 + 30000);

    BleScan_t *s = calloc(1, sizeof(BleScan_t));
    if (s == NULL)
    {
        printf("{\"cmd\":\"blescan\",\"error\":\"no mem\"}\n");
        return 1;
    }
    esp_err_t err = ble_up();
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"blescan\",\"error\":\"ble_up %s\"}\n", esp_err_to_name(err));
        free(s);
        return 1;
    }
    heap_line("ble_up");
    uint8_t own = BLE_OWN_ADDR_PUBLIC;
    own = BLE_OWN_ADDR_PUBLIC;   /* always public: blelog leaves a random static addr in the host */
    struct ble_gap_disc_params dp = {0};
    dp.itvl = 0x60;      // 60 ms
    dp.window = 0x50;    // 50 ms
    dp.passive = 1;
    dp.filter_duplicates = 0;
    s_bs = s;
    (void)xSemaphoreTake(s_sem, 0);
    int rc = ble_gap_disc(own, sec * 1000, &dp, ble_scan_cb, NULL);
    if (rc != 0)
    {
        printf("{\"cmd\":\"blescan\",\"error\":\"ble_gap_disc rc=%d\"}\n", rc);
    }
    else
    {
        (void)xSemaphoreTake(s_sem, pdMS_TO_TICKS(sec * 1000 + 3000));
        ble_gap_disc_cancel();
    }
    vTaskDelay(2);
    s_bs = NULL;
    ble_down();

    qsort(s->d, s->n, sizeof(BleDev_t), cmp_dev);
    int out = printf("{\"cmd\":\"blescan\",\"sec\":%d,\"passive\":true,\"events\":%lu,\"devices\":%u,\"overflow\":%lu,"
                     "\"evtype_bits\":\"0=ADV_IND 1=DIR_IND 2=SCAN_IND 3=NONCONN_IND 4=SCAN_RSP\"}\n",
                     sec, (unsigned long)s->events, s->n, (unsigned long)s->overflow);
    uint16_t i = 0;
    for (; i < s->n && out < XP_OUT_BUDGET - 150; i++)
    {
        const BleDev_t *d = &s->d[i];
        const uint8_t *a = d->addr.val;   // little-endian in NimBLE
        out += printf("{\"cmd\":\"blescan\",\"addr\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"atype\":%u,\"rssi\":%d,\"rssi_max\":%d,\"evmask\":%u,\"n\":%lu",
                      a[5], a[4], a[3], a[2], a[1], a[0], d->addr.type, d->rssi, d->rssi_max, d->evmask, (unsigned long)d->count);
        if (d->has_mfg) out += printf(",\"mfg\":\"0x%04x\"", d->mfg);
        if (d->name[0])
        {
            out += printf(",\"name\":\"");
            xp_print_escaped((const uint8_t *)d->name, strlen(d->name));
            out += (int)strlen(d->name) + 2;
            printf("\"");
        }
        printf("}\n");
    }
    if (i < s->n)
    {
        printf("{\"cmd\":\"blescan\",\"truncated\":%u}\n", (unsigned)(s->n - i));
    }
    free(s);
    return 0;
}

static int ble_adv_cb(struct ble_gap_event *ev, void *arg)
{
    (void)arg;
    if (ev->type == BLE_GAP_EVENT_ADV_COMPLETE)
    {
        xSemaphoreGive(s_sem);
    }
    return 0;
}

// bleadv <name|-> <hex payload|-> <seconds>  non-connectable beacon, mfg data with company 0xFFFF (test)
static int cmd_bleadv(int argc, char **argv)
{
    if (argc < 4)
    {
        printf("{\"cmd\":\"bleadv\",\"error\":\"usage: bleadv <name|-> <hexpayload|-> <seconds>\"}\n");
        return 1;
    }
    const char *name = (strcmp(argv[1], "-") == 0) ? "" : argv[1];
    uint8_t pl[24];
    size_t pl_len = 0;
    if (!xp_parse_hex_bytes(argv[2], pl, sizeof(pl), &pl_len))
    {
        printf("{\"cmd\":\"bleadv\",\"error\":\"bad hex payload (max 24 bytes)\"}\n");
        return 1;
    }
    int sec = atoi(argv[3]);
    if (sec < 1) sec = 1;
    if (sec > 600) sec = 600;

    // AD: flags(3) + mfg(4+pl) + name(2+n) <= 31
    uint8_t adv[31];
    size_t n = 0;
    adv[n++] = 2; adv[n++] = 0x01; adv[n++] = 0x06;   // LE general discoverable, BR/EDR not supported
    if (3 + 4 + pl_len > 31)
    {
        printf("{\"cmd\":\"bleadv\",\"error\":\"payload too long\"}\n");
        return 1;
    }
    adv[n++] = (uint8_t)(3 + pl_len); adv[n++] = 0xFF; adv[n++] = 0xFF; adv[n++] = 0xFF;
    memcpy(&adv[n], pl, pl_len);
    n += pl_len;
    size_t nl = strlen(name);
    bool shortened = false;
    if (nl > 0)
    {
        const size_t room = 31 - n;
        if (room < 3)
        {
            nl = 0;
            shortened = true;
        }
        else
        {
            if (nl > room - 2) { nl = room - 2; shortened = true; }
            adv[n++] = (uint8_t)(1 + nl);
            adv[n++] = shortened ? 0x08 : 0x09;
            memcpy(&adv[n], name, nl);
            n += nl;
        }
    }
    xp_awake((uint32_t)sec * 1000 + 30000);

    esp_err_t err = ble_up();
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"bleadv\",\"error\":\"ble_up %s\"}\n", esp_err_to_name(err));
        return 1;
    }
    uint8_t own = BLE_OWN_ADDR_PUBLIC;
    (void)ble_hs_util_ensure_addr(0);
    own = BLE_OWN_ADDR_PUBLIC;   /* always public: blelog leaves a random static addr in the host */
    uint8_t a[6] = {0};
    (void)ble_hs_id_copy_addr(own == BLE_OWN_ADDR_RANDOM ? BLE_ADDR_RANDOM : BLE_ADDR_PUBLIC, a, NULL);

    int rc = ble_gap_adv_set_data(adv, (int)n);
    if (rc == 0)
    {
        struct ble_gap_adv_params ap = {0};
        ap.conn_mode = BLE_GAP_CONN_MODE_NON;
        ap.disc_mode = BLE_GAP_DISC_MODE_GEN;
        ap.itvl_min = 160;   // 100 ms
        ap.itvl_max = 160;
        (void)xSemaphoreTake(s_sem, 0);
        rc = ble_gap_adv_start(own, NULL, sec * 1000, &ap, ble_adv_cb, NULL);
    }
    printf("{\"cmd\":\"bleadv\",\"rc\":%d,\"addr\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"own_type\":%u,\"name\":\"", rc,
           a[5], a[4], a[3], a[2], a[1], a[0], own);
    xp_print_escaped((const uint8_t *)name, nl);
    printf("\",\"name_shortened\":%s,\"company\":\"0xFFFF\",\"payload\":\"", shortened ? "true" : "false");
    xp_print_hexstr(pl, pl_len);
    printf("\",\"adv\":\"");
    xp_print_hexstr(adv, n);
    printf("\",\"sec\":%d}\n", sec);
    fflush(stdout);
    if (rc == 0)
    {
        (void)xSemaphoreTake(s_sem, pdMS_TO_TICKS(sec * 1000 + 3000));
        ble_gap_adv_stop();
    }
    ble_down();
    printf("{\"cmd\":\"bleadv\",\"done\":true}\n");
    return rc == 0 ? 0 : 1;
}

// ---- mauto: RED-tag auto pre-alert. A background watcher notices each new RED triage and, with no further
// input, builds a PA1 record (unit, seq, triage=RED, live BLE HR if any, UTC minute) and broadcasts it as a
// non-connectable BLE beacon (mfg 0xFFFF, name "CMX PA") for <adv_sec> seconds.
static volatile bool s_auto_run;
static int s_auto_unit = 2501, s_auto_sec = 60;
static uint8_t s_auto_seq;

static void bits_put(uint8_t *b, int *pos, uint32_t v, int n)
{
    for (int i = n - 1; i >= 0; i--, (*pos)++)
        if ((v >> i) & 1) b[*pos / 8] |= (uint8_t)(0x80 >> (*pos % 8));
}

static uint16_t crc16_ccitt(const uint8_t *d, size_t n)
{
    uint16_t c = 0xFFFF;
    for (size_t i = 0; i < n; i++)
    {
        c ^= (uint16_t)d[i] << 8;
        for (int k = 0; k < 8; k++) c = (c & 0x8000) ? (uint16_t)((c << 1) ^ 0x1021) : (uint16_t)(c << 1);
    }
    return c;
}

static void pa1_build(uint8_t out[15], uint8_t seq, int unit, int hr, int spo2, uint32_t unix_now)
{
    memset(out, 0, 15);
    int p = 0;
    bits_put(out, &p, 1, 4);                 // ver
    bits_put(out, &p, seq & 63, 6);
    bits_put(out, &p, (uint32_t)unit & 0xFFFF, 16);
    bits_put(out, &p, 0, 4);                 // age unknown
    bits_put(out, &p, 0, 2);                 // sex U
    bits_put(out, &p, 0, 6);                 // complaint unknown
    bits_put(out, &p, 3, 3);                 // triage RED
    bits_put(out, &p, (hr >= 0 && hr <= 254) ? (uint32_t)hr : 255, 8);
    bits_put(out, &p, 255, 8);               // sbp unknown
    bits_put(out, &p, (spo2 >= 0 && spo2 <= 100) ? (uint32_t)spo2 : 127, 7);   // spo2 (127 = unknown)
    bits_put(out, &p, 63, 6);                // rr unknown
    bits_put(out, &p, 0, 4);                 // gcs unknown
    bits_put(out, &p, 127, 7);               // eta unknown
    bits_put(out, &p, 0, 8);                 // flags
    bits_put(out, &p, unix_now ? (unix_now / 60) % 1440 : 2047, 11);
    bits_put(out, &p, 0, 4);
    const uint16_t c = crc16_ccitt(out, 13);
    out[13] = (uint8_t)(c >> 8);
    out[14] = (uint8_t)c;
}

static void auto_task(void *arg)
{
    (void)arg;
    int red0 = 0, hr = -1, spo2 = -1;
    uint32_t un = 0;
    g_xp_hooks.auto_status(&red0, &hr, &spo2, &un);
    while (s_auto_run)
    {
        vTaskDelay(pdMS_TO_TICKS(50));
        int red = 0;
        g_xp_hooks.auto_status(&red, &hr, &spo2, &un);
        if (red < red0) red0 = red;
        if (red <= red0) continue;
        const int64_t t_det = esp_timer_get_time();
        red0 = red;
        uint8_t pa[15];
        pa1_build(pa, s_auto_seq++, s_auto_unit, hr, spo2, un);
        uint8_t adv[31];
        size_t n = 0;
        adv[n++] = 2; adv[n++] = 0x01; adv[n++] = 0x06;
        adv[n++] = 3 + 15; adv[n++] = 0xFF; adv[n++] = 0xFF; adv[n++] = 0xFF;
        memcpy(&adv[n], pa, 15); n += 15;
        adv[n++] = 7; adv[n++] = 0x09; memcpy(&adv[n], "CMX PA", 6); n += 6;   // 31 B total
        xp_awake((uint32_t)s_auto_sec * 1000 + 30000);
        const bool shared = xp_blehr_active();   // blehr's NimBLE is up: advertise on it (central + broadcaster)
        esp_err_t err = shared ? ESP_OK : ble_up();
        int rc = -1;
        if (err == ESP_OK)
        {
            uint8_t own = BLE_OWN_ADDR_PUBLIC;
            own = BLE_OWN_ADDR_PUBLIC;   /* always public: blelog leaves a random static addr in the host */
            (void)ble_gap_adv_stop();
            rc = ble_gap_adv_set_data(adv, (int)n);
            if (rc == 0)
            {
                struct ble_gap_adv_params ap = {0};
                ap.conn_mode = BLE_GAP_CONN_MODE_NON;
                ap.disc_mode = BLE_GAP_DISC_MODE_GEN;
                ap.itvl_min = 48;   // 30 ms: fast first discovery
                ap.itvl_max = 48;
                rc = ble_gap_adv_start(own, NULL, s_auto_sec * 1000, &ap, ble_adv_cb, NULL);
            }
        }
        printf("\n{\"cmd\":\"mauto\",\"ev\":\"red_prealert\",\"red\":%d,\"hr\":%d,\"spo2\":%d,\"rc\":%d,\"err\":\"%s\",\"shared\":%d,\"react_ms\":%lld,\"pa1\":\"",
               red, hr, spo2, rc, esp_err_to_name(err), (int)shared, (long long)((esp_timer_get_time() - t_det) / 1000));
        xp_print_hexstr(pa, 15);
        printf("\"}\n");
        fflush(stdout);
    }
    vTaskDelete(NULL);
}

static int cmd_mauto(int argc, char **argv)
{
    if (argc >= 2 && strcmp(argv[1], "off") == 0)
    {
        s_auto_run = false;
        vTaskDelay(pdMS_TO_TICKS(150));
        if (s_ble_on) { (void)ble_gap_adv_stop(); ble_down(); }
        else if (xp_blehr_active()) (void)ble_gap_adv_stop();
        printf("{\"cmd\":\"mauto\",\"on\":false}\n");
        return 0;
    }
    if (argc >= 3) s_auto_unit = atoi(argv[2]);
    if (argc >= 4) s_auto_sec = atoi(argv[3]);
    if (s_auto_sec < 5) s_auto_sec = 5;
    if (s_auto_sec > 600) s_auto_sec = 600;
    if (g_xp_hooks.auto_status == NULL) { printf("{\"cmd\":\"mauto\",\"error\":\"no hook\"}\n"); return 1; }
    if (!s_auto_run)
    {
        s_auto_run = true;
        xTaskCreatePinnedToCore(auto_task, "xp_auto", 4096, NULL, 3, NULL, 0);
    }
    printf("{\"cmd\":\"mauto\",\"on\":true,\"unit\":%d,\"adv_sec\":%d}\n", s_auto_unit, s_auto_sec);
    return 0;
}

// ---- mwatch: arrival auto-detect. Scans (active, owner's devices answer scan requests) for a destination beacon
// named "ED-<n>"; once heard at >= thr dBm it logs ARRIVED(n) in the hash chain, stops scanning and starts the
// BLE record server (blelog) so the ED laptop can pull the record with no taps. One-shot.
static volatile bool s_watch_run;
static int s_watch_thr = -75, s_watch_serve = 60;
static volatile int s_watch_site = -1, s_watch_rssi, s_watch_seen;

static int watch_cb(struct ble_gap_event *ev, void *arg)
{
    (void)arg;
    if (ev->type == BLE_GAP_EVENT_DISC_COMPLETE) { xSemaphoreGive(s_sem); return 0; }
    if (ev->type != BLE_GAP_EVENT_DISC) return 0;
    struct ble_hs_adv_fields f;
    if (ble_hs_adv_parse_fields(&f, ev->disc.data, ev->disc.length_data) != 0 || f.name == NULL || f.name_len < 4) return 0;
    if (memcmp(f.name, "ED-", 3) != 0) return 0;
    s_watch_seen++;
    char num[8] = {0};
    memcpy(num, f.name + 3, f.name_len - 3 < 7 ? f.name_len - 3 : 7);
    if (ev->disc.rssi >= s_watch_thr && s_watch_site < 0) { s_watch_rssi = ev->disc.rssi; s_watch_site = atoi(num); }
    return 0;
}

static void watch_task(void *arg)
{
    (void)arg;
    const int64_t t0 = esp_timer_get_time();
    int scans = 0;
    s_watch_site = -1; s_watch_seen = 0;
    while (s_watch_run && s_watch_site < 0)
    {
        xp_awake(120000);
        if (ble_up() != ESP_OK) { vTaskDelay(pdMS_TO_TICKS(1000)); continue; }
        uint8_t own = BLE_OWN_ADDR_PUBLIC;
        own = BLE_OWN_ADDR_PUBLIC;   /* always public: blelog leaves a random static addr in the host */
        struct ble_gap_disc_params dp = {0};
        dp.passive = 0; dp.filter_duplicates = 0; dp.itvl = 0x30; dp.window = 0x30;
        (void)xSemaphoreTake(s_sem, 0);
        if (ble_gap_disc(own, 1200, &dp, watch_cb, NULL) == 0)
        {
            for (int i = 0; i < 150 && s_watch_site < 0; i++)
                if (xSemaphoreTake(s_sem, pdMS_TO_TICKS(10)) == pdTRUE) break;
            (void)ble_gap_disc_cancel();
        }
        scans++;
    }
    if (s_watch_site >= 0)
    {
        const int64_t t_hit = esp_timer_get_time();
        ble_down();
        if (g_xp_hooks.log_arrival != NULL) g_xp_hooks.log_arrival(s_watch_site);
        const bool srv = xp_blelog_start_bg(s_watch_serve);
        printf("\n{\"cmd\":\"mwatch\",\"ev\":\"arrived\",\"site\":%d,\"rssi\":%d,\"scans\":%d,\"beacons_seen\":%d,\"t_ms\":%lld,\"serving\":%s}\n",
               s_watch_site, s_watch_rssi, scans, s_watch_seen, (long long)((t_hit - t0) / 1000), srv ? "true" : "false");
    }
    else
    {
        ble_down();
    }
    fflush(stdout);
    s_watch_run = false;
    vTaskDelete(NULL);
}

static int cmd_mwatch(int argc, char **argv)
{
    if (argc >= 2 && strcmp(argv[1], "off") == 0)
    {
        s_watch_run = false;
        printf("{\"cmd\":\"mwatch\",\"on\":false}\n");
        return 0;
    }
    if (argc >= 3) s_watch_thr = atoi(argv[2]);
    if (argc >= 4) s_watch_serve = atoi(argv[3]);
    if (xp_mwifi_active() || xp_blehr_active()) { printf("{\"cmd\":\"mwatch\",\"error\":\"radio busy\"}\n"); return 1; }
    if (!s_watch_run)
    {
        s_watch_run = true;
        xTaskCreatePinnedToCore(watch_task, "xp_watch", 4096, NULL, 3, NULL, 0);
    }
    printf("{\"cmd\":\"mwatch\",\"on\":true,\"thr_dbm\":%d,\"serve_s\":%d}\n", s_watch_thr, s_watch_serve);
    return 0;
}

void xp_radio_all_down(void)
{
    wifi_down();
    ble_down();
}

// radiooff: force both stacks down (normally every command already does this)
static int cmd_radiooff(int argc, char **argv)
{
    (void)argc; (void)argv;
    wifi_down();
    ble_down();
    heap_line("radiooff");
    return 0;
}

void xp_register_radio_cmds(void)
{
    const esp_console_cmd_t cmds[] = {
        {.command = "wifiscan", .help = "xp: wifiscan [dwell_ms=150] - PASSIVE scan all channels", .func = cmd_wifiscan},
        {.command = "wifisniff", .help = "xp: wifisniff <seconds> <channel|0=hop> - promiscuous counters (rx only)", .func = cmd_wifisniff},
        {.command = "blescan", .help = "xp: blescan <seconds> - passive BLE scan (NimBLE)", .func = cmd_blescan},
        {.command = "mwatch", .help = "xp2: mwatch on [thr_dbm=-75] [serve_s=60] | off - arrival: hear ED-<n> beacon -> ARRIVED + blelog", .func = cmd_mwatch},
        {.command = "mauto", .help = "xp2: mauto on [unit] [adv_sec] | off - auto BLE PA1 pre-alert on every new RED triage", .func = cmd_mauto},
        {.command = "bleadv", .help = "xp: bleadv <name|-> <hexpayload|-> <seconds> - nonconn beacon, mfg 0xFFFF", .func = cmd_bleadv},
        {.command = "espnow_tx", .help = "xp: espnow_tx <count> <bytes> [ch=1] - broadcast CMXTEST frames", .func = cmd_espnow_tx},
        {.command = "espnow_rx", .help = "xp: espnow_rx <seconds> [ch=1] [lr] - count received ESP-NOW frames", .func = cmd_espnow_rx},
        {.command = "espnow_lr", .help = "xp2: espnow_lr <count> <bytes> [ch=1] [250|500] - broadcast CMXTEST frames in 802.11 LR mode", .func = cmd_espnow_lr},
        {.command = "radiooff", .help = "xp: deinit Wi-Fi and BLE", .func = cmd_radiooff},
    };
    for (size_t i = 0; i < sizeof(cmds) / sizeof(cmds[0]); i++)
    {
        esp_console_cmd_register(&cmds[i]);
    }
}
