// fw/xp: "mwifi" - open softAP whose SSID carries a pre-alert text, plus an optional captive portal
// (DNS catch-all + tiny HTTP server) serving the medic handoff summary. Auto-stops after N seconds.
// Wi-Fi only: refuses while a per-command radio is up, and the other radio commands refuse while it runs.

#include "xp_priv.h"

#include "esp_console.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "lwip/sockets.h"

#include <stdlib.h>
#include <string.h>

static volatile bool s_active = false;
static esp_netif_t *s_netif = NULL;
static httpd_handle_t s_httpd = NULL;
static volatile bool s_dns_run = false;
static volatile TaskHandle_t s_dns_task = NULL;
static TaskHandle_t s_mgr_task = NULL;
static SemaphoreHandle_t s_mgr_done = NULL;
static esp_event_handler_instance_t s_evh_wifi = NULL, s_evh_ip = NULL;
static char s_ssid[33];
static int s_ch, s_secs;
static int64_t s_started_us;
static volatile uint32_t s_sta_conn, s_sta_disc, s_ip_assigned, s_dns_q, s_http_req;
static uint8_t s_last_sta[6];
static uint32_t s_ap_ip;   // network byte order

bool xp_mwifi_active(void) { return s_active; }

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED)
    {
        const wifi_event_ap_staconnected_t *e = data;
        s_sta_conn++;
        memcpy(s_last_sta, e->mac, 6);
    }
    else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STADISCONNECTED)
    {
        s_sta_disc++;
    }
    else if (base == IP_EVENT && id == IP_EVENT_AP_STAIPASSIGNED)
    {
        s_ip_assigned++;
    }
}

// ------------------------------------------------------------------------------------------- DNS catch-all
static void dns_task(void *arg)
{
    (void)arg;
    const int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (sock >= 0)
    {
        struct sockaddr_in a = {.sin_family = AF_INET, .sin_port = htons(53), .sin_addr.s_addr = htonl(INADDR_ANY)};
        struct timeval tv = {.tv_sec = 0, .tv_usec = 500000};
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
        if (bind(sock, (struct sockaddr *)&a, sizeof(a)) == 0)
        {
            uint8_t buf[512];
            while (s_dns_run)
            {
                struct sockaddr_in from;
                socklen_t fl = sizeof(from);
                const int n = recvfrom(sock, buf, sizeof(buf) - 16, 0, (struct sockaddr *)&from, &fl);
                if (n < 12 || (buf[2] & 0x80) != 0)
                {
                    continue;   // timeout, runt, or a response
                }
                // walk the first question name
                int q = 12;
                while (q < n && buf[q] != 0)
                {
                    if ((buf[q] & 0xC0) != 0) { q = n; break; }
                    q += buf[q] + 1;
                }
                if (q + 5 > n)
                {
                    continue;
                }
                const uint16_t qtype = (uint16_t)((buf[q + 1] << 8) | buf[q + 2]);
                const int qend = q + 5;
                s_dns_q++;
                buf[2] = (uint8_t)(0x84 | (buf[2] & 0x01));   // QR=1, AA=1, keep RD
                buf[3] = 0x80;                                  // RA=1, NOERROR
                buf[4] = 0; buf[5] = 1;                         // QDCOUNT=1
                buf[6] = 0; buf[7] = (qtype == 1) ? 1 : 0;      // ANCOUNT (A only; AAAA etc. get empty NOERROR)
                buf[8] = buf[9] = buf[10] = buf[11] = 0;        // drop NS/AR (EDNS OPT)
                int r = qend;
                if (qtype == 1)
                {
                    const uint8_t ans[16] = {0xC0, 0x0C, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3C, 0x00, 0x04,
                                             (uint8_t)(s_ap_ip), (uint8_t)(s_ap_ip >> 8), (uint8_t)(s_ap_ip >> 16), (uint8_t)(s_ap_ip >> 24)};
                    memcpy(&buf[r], ans, sizeof(ans));
                    r += sizeof(ans);
                }
                sendto(sock, buf, r, 0, (struct sockaddr *)&from, fl);
            }
        }
        close(sock);
    }
    s_dns_task = NULL;
    vTaskDelete(NULL);
}

// ------------------------------------------------------------------------------------------- HTTP
static size_t html_escape(char *out, size_t cap, const char *in)
{
    size_t n = 0;
    for (; *in && n + 6 < cap; in++)
    {
        const char c = *in;
        if (c == '<') { memcpy(out + n, "&lt;", 4); n += 4; }
        else if (c == '>') { memcpy(out + n, "&gt;", 4); n += 4; }
        else if (c == '&') { memcpy(out + n, "&amp;", 5); n += 5; }
        else if (c == '"') { memcpy(out + n, "&quot;", 6); n += 6; }
        else out[n++] = c;
    }
    out[n] = 0;
    return n;
}

static esp_err_t http_any(httpd_req_t *req)
{
    s_http_req++;
    char *page = malloc(3072);
    char *sum = malloc(400);
    char *esc = malloc(800);
    if (page == NULL || sum == NULL || esc == NULL)
    {
        free(page); free(sum); free(esc);
        return httpd_resp_send_500(req);
    }
    sum[0] = 0;
    if (g_xp_hooks.build_summary != NULL)
    {
        g_xp_hooks.build_summary(sum, 400);
    }
    char ssid_esc[200];
    html_escape(ssid_esc, sizeof(ssid_esc), s_ssid);
    html_escape(esc, 800, sum);
    // Pretty-print the CMX1|k=v|... summary as one row per field.
    char rows[1200];
    size_t rn = 0;
    rows[0] = 0;
    for (char *tok = strtok(esc, "|"); tok != NULL && rn + 80 < sizeof(rows); tok = strtok(NULL, "|"))
    {
        rn += (size_t)snprintf(rows + rn, sizeof(rows) - rn, "<tr><td>%s</td></tr>", tok);
    }
    const int len = snprintf(page, 3072,
        "<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>Chromatic MEDIC handoff</title><style>body{font-family:-apple-system,sans-serif;margin:16px;background:#111;color:#eee}"
        "h1{font-size:20px;color:#f0d000}td{font-family:monospace;font-size:16px;padding:2px 6px;border-bottom:1px solid #333}"
        "p{color:#aaa;font-size:12px}</style></head><body><h1>%s</h1><table>%s</table>"
        "<p>Research prototype, not a medical device. Served by the Chromatic ESP32 softAP (%s, ch %d), uptime %llds. Raw: %s</p></body></html>",
        ssid_esc, rows, ssid_esc, s_ch, (long long)(esp_timer_get_time() / 1000000), sum);
    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    const esp_err_t err = httpd_resp_send(req, page, len > 0 ? (len < 3072 ? len : 3071) : 0);
    free(page); free(sum); free(esc);
    return err;
}

static void portal_stop(void)
{
    if (s_httpd != NULL)
    {
        httpd_stop(s_httpd);
        s_httpd = NULL;
    }
    if (s_dns_task != NULL)
    {
        s_dns_run = false;
        for (int i = 0; i < 300 && s_dns_task != NULL; i++)
        {
            vTaskDelay(1);
        }
    }
}

static esp_err_t portal_start(void)
{
    if (s_httpd != NULL)
    {
        return ESP_OK;
    }
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.uri_match_fn = httpd_uri_match_wildcard;
    cfg.max_open_sockets = 4;
    cfg.lru_purge_enable = true;
    cfg.stack_size = 6144;
    esp_err_t err = httpd_start(&s_httpd, &cfg);
    if (err != ESP_OK)
    {
        s_httpd = NULL;
        return err;
    }
    const httpd_uri_t any = {.uri = "/*", .method = HTTP_GET, .handler = http_any, .user_ctx = NULL};
    httpd_register_uri_handler(s_httpd, &any);
    s_dns_run = true;
    TaskHandle_t t = NULL;
    if (xTaskCreate(dns_task, "xp_dns", 3072, NULL, 5, &t) != pdPASS)
    {
        s_dns_run = false;
        portal_stop();
        return ESP_ERR_NO_MEM;
    }
    s_dns_task = t;
    return ESP_OK;
}

// ------------------------------------------------------------------------------------------- AP lifecycle
static void ap_teardown(void)
{
    portal_stop();
    esp_wifi_stop();
    esp_wifi_deinit();
    if (s_evh_wifi) { esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, s_evh_wifi); s_evh_wifi = NULL; }
    if (s_evh_ip) { esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_AP_STAIPASSIGNED, s_evh_ip); s_evh_ip = NULL; }
    if (s_netif != NULL)
    {
        esp_netif_destroy_default_wifi(s_netif);
        s_netif = NULL;
    }
    s_active = false;
}

static void mgr_task(void *arg)
{
    (void)arg;
    (void)ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS((uint32_t)s_secs * 1000));   // "mwifi off" or timeout
    ap_teardown();
    s_mgr_task = NULL;
    xSemaphoreGive(s_mgr_done);
    vTaskDelete(NULL);
}

static esp_err_t ap_start(const char *ssid, int secs, int ch)
{
    static bool netif_inited = false;
    xp_radio_all_down();
    if (!netif_inited)
    {
        esp_err_t e = esp_netif_init();
        if (e != ESP_OK) return e;
        netif_inited = true;
    }
    esp_err_t err = esp_event_loop_create_default();
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) return err;
    s_netif = esp_netif_create_default_wifi_ap();
    if (s_netif == NULL) return ESP_ERR_NO_MEM;

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    cfg.nvs_enable = 0;
    err = esp_wifi_init(&cfg);
    if (err != ESP_OK)
    {
        esp_netif_destroy_default_wifi(s_netif);
        s_netif = NULL;
        return err;
    }
    s_active = true;   // from here on ap_teardown() cleans up
    esp_wifi_set_storage(WIFI_STORAGE_RAM);
    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, &s_evh_wifi);
    esp_event_handler_instance_register(IP_EVENT, IP_EVENT_AP_STAIPASSIGNED, on_event, NULL, &s_evh_ip);

    wifi_config_t wc = {0};
    const size_t sl = strlen(ssid) > 32 ? 32 : strlen(ssid);
    memcpy(wc.ap.ssid, ssid, sl);
    wc.ap.ssid_len = (uint8_t)sl;
    wc.ap.channel = (uint8_t)ch;
    wc.ap.authmode = WIFI_AUTH_OPEN;
    wc.ap.max_connection = 2;
    wc.ap.beacon_interval = 100;
    err = esp_wifi_set_mode(WIFI_MODE_AP);
    if (err == ESP_OK) err = esp_wifi_set_config(WIFI_IF_AP, &wc);
    if (err == ESP_OK) err = esp_wifi_start();
    if (err != ESP_OK)
    {
        ap_teardown();
        return err;
    }

    // DHCP: hand out our own IP as DNS so the catch-all can answer (captive portal).
    esp_netif_ip_info_t ip = {0};
    esp_netif_get_ip_info(s_netif, &ip);
    s_ap_ip = ip.ip.addr;
    esp_netif_dhcps_stop(s_netif);
    uint8_t offer = 0x02;   // OFFER_DNS (lwip dhcpserver.h)
    esp_netif_dhcps_option(s_netif, ESP_NETIF_OP_SET, ESP_NETIF_DOMAIN_NAME_SERVER, &offer, sizeof(offer));
    esp_netif_dns_info_t dns = {0};
    dns.ip.u_addr.ip4.addr = ip.ip.addr;
    dns.ip.type = ESP_IPADDR_TYPE_V4;
    esp_netif_set_dns_info(s_netif, ESP_NETIF_DNS_MAIN, &dns);
    esp_netif_dhcps_start(s_netif);

    memcpy(s_ssid, ssid, sl);
    s_ssid[sl] = 0;
    s_ch = ch;
    s_secs = secs;
    s_started_us = esp_timer_get_time();
    s_sta_conn = s_sta_disc = s_ip_assigned = s_dns_q = s_http_req = 0;
    if (s_mgr_done == NULL) s_mgr_done = xSemaphoreCreateBinary();
    (void)xSemaphoreTake(s_mgr_done, 0);
    if (xTaskCreate(mgr_task, "xp_mwifi", 4096, NULL, 3, &s_mgr_task) != pdPASS)
    {
        ap_teardown();
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

static void print_status(const char *what)
{
    const int64_t up = s_active ? (esp_timer_get_time() - s_started_us) / 1000000 : 0;
    printf("{\"cmd\":\"mwifi\",\"at\":\"%s\",\"active\":%s,\"ssid\":\"", what, s_active ? "true" : "false");
    xp_print_escaped((const uint8_t *)s_ssid, strlen(s_ssid));
    printf("\",\"ch\":%d,\"up_s\":%lld,\"left_s\":%lld,\"portal\":%s,\"sta_conn\":%lu,\"sta_disc\":%lu,\"ip_assigned\":%lu,"
           "\"dns_q\":%lu,\"http_req\":%lu,\"last_sta\":\"",
           s_ch, (long long)up, (long long)(s_active ? s_secs - up : 0), s_httpd ? "true" : "false",
           (unsigned long)s_sta_conn, (unsigned long)s_sta_disc, (unsigned long)s_ip_assigned, (unsigned long)s_dns_q,
           (unsigned long)s_http_req);
    xp_print_mac(s_last_sta);
    printf("\",\"free_internal\":%u,\"largest\":%u,\"min_free\":%u}\n", (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
           (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL), (unsigned)esp_get_minimum_free_heap_size());
}

// mwifi ap <ssid-text> [secs=120] [ch=6] | portal on|off | off | status | heap
static int cmd_mwifi(int argc, char **argv)
{
    if (argc < 2 || strcmp(argv[1], "status") == 0 || strcmp(argv[1], "heap") == 0)
    {
        print_status(argc < 2 ? "status" : argv[1]);
        return 0;
    }
    if (strcmp(argv[1], "ap") == 0)
    {
        if (argc < 3)
        {
            printf("{\"cmd\":\"mwifi\",\"error\":\"usage: mwifi ap \\\"<ssid text>\\\" [secs=120] [ch=6]\"}\n");
            return 1;
        }
        if (s_active)
        {
            printf("{\"cmd\":\"mwifi\",\"error\":\"already active, mwifi off first\"}\n");
            return 1;
        }
        int secs = (argc >= 4) ? atoi(argv[3]) : 120;
        int ch = (argc >= 5) ? atoi(argv[4]) : 6;
        if (secs < 5) secs = 5;
        if (secs > 3600) secs = 3600;
        if (ch < 1 || ch > 13) ch = 6;
        xp_awake((uint32_t)secs * 1000 + 15000);
        const esp_err_t err = ap_start(argv[2], secs, ch);
        if (err != ESP_OK)
        {
            printf("{\"cmd\":\"mwifi\",\"error\":\"ap_start %s\"}\n", esp_err_to_name(err));
            return 1;
        }
        uint8_t mac[6];
        esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
        printf("{\"cmd\":\"mwifi\",\"ap\":true,\"bssid\":\"");
        xp_print_mac(mac);
        printf("\",\"ip\":\"" IPSTR "\",\"auto_stop_s\":%d,\"open\":true}\n", IP2STR((esp_ip4_addr_t *)&s_ap_ip), secs);
        print_status("ap");
        return 0;
    }
    if (strcmp(argv[1], "portal") == 0)
    {
        const bool on = (argc < 3) || (strcmp(argv[2], "on") == 0);
        if (!s_active)
        {
            printf("{\"cmd\":\"mwifi\",\"error\":\"start the AP first: mwifi ap <ssid>\"}\n");
            return 1;
        }
        if (on)
        {
            const esp_err_t err = portal_start();
            printf("{\"cmd\":\"mwifi\",\"portal\":%s,\"err\":\"%s\",\"url\":\"http://" IPSTR "/\"}\n", err == ESP_OK ? "true" : "false",
                   esp_err_to_name(err), IP2STR((esp_ip4_addr_t *)&s_ap_ip));
        }
        else
        {
            portal_stop();
            printf("{\"cmd\":\"mwifi\",\"portal\":false}\n");
        }
        return 0;
    }
    if (strcmp(argv[1], "off") == 0)
    {
        if (s_active && s_mgr_task != NULL)
        {
            xTaskNotifyGive(s_mgr_task);
            (void)xSemaphoreTake(s_mgr_done, pdMS_TO_TICKS(5000));
        }
        print_status("off");
        return 0;
    }
    printf("{\"cmd\":\"mwifi\",\"error\":\"mwifi ap <ssid> [secs] [ch] | portal on|off | off | status | heap\"}\n");
    return 1;
}

void xp_register_mwifi_cmds(void)
{
    const esp_console_cmd_t c = {.command = "mwifi", .help = "xp: mwifi ap \"<ssid>\" [secs=120] [ch=6] | portal on|off | off | status | heap", .func = cmd_mwifi};
    esp_console_cmd_register(&c);
}
