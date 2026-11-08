// fw/xp2: "blehr <seconds> [log_every_s]" - BLE CENTRAL: find any standard Bluetooth Heart Rate sensor
// (service 0x180D), connect without pairing, subscribe to Heart Rate Measurement (0x2A37) and feed every
// reading to the medic UI (RATE page shows it live). A VITAL event (arg 1000+bpm) is appended to the
// hash-chained log on the first reading, then at most every log_every_s seconds, and immediately whenever
// the rate crosses a critical band (<50 or >130 bpm) or leaves it again.
// Stops after <seconds> or when the sensor disconnects. Wi-Fi is torn down first (BLE/Wi-Fi exclusive).

#include "xp_priv.h"

#include "esp_console.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"

#include <stdlib.h>
#include <string.h>

#define RING 64

typedef struct { int64_t t_us; uint16_t bpm; uint8_t flags; uint8_t len; uint8_t kind; } Hr_t;   // kind 1 HR bpm, 2 SpO2 %

static uint8_t s_own;
static SemaphoreHandle_t s_sync_sem;
static volatile bool s_synced, s_found, s_connected, s_had_conn, s_subscribed, s_scan_done;
static volatile uint16_t s_conn = BLE_HS_CONN_HANDLE_NONE, s_val_handle, s_cccd_handle, s_plx_handle;
static volatile bool s_plx_sub;
static volatile int s_stage_rc, s_disc_reason;
static ble_addr_t s_peer;
static char s_peer_name[32];
static volatile int8_t s_peer_rssi;
static Hr_t s_ring[RING];
static volatile uint32_t s_wr, s_notifies;
static volatile int64_t s_t_found, s_t_conn, s_t_sub;

static int gap_event(struct ble_gap_event *ev, void *arg);

static int scan_start(void)
{
    struct ble_gap_disc_params dp = {0};
    dp.passive = 0;             // active: get the scan response (name)
    dp.filter_duplicates = 0;
    dp.itvl = 0x50; dp.window = 0x30;
    return ble_gap_disc(s_own, BLE_HS_FOREVER, &dp, gap_event, NULL);
}

static int on_plx_cccd(uint16_t conn, const struct ble_gatt_error *err, struct ble_gatt_attr *attr, void *arg)
{
    if (err->status == 0) s_plx_sub = true;
    return 0;
}

// optional Pulse Oximeter (0x1822) PLX Continuous Measurement 0x2A5F: subscribe if the sensor has it
static int on_plx_chr(uint16_t conn, const struct ble_gatt_error *err, const struct ble_gatt_chr *chr, void *arg)
{
    if (err->status == 0 && chr != NULL) { if (!s_plx_handle) s_plx_handle = chr->val_handle; return 0; }
    if (s_plx_handle)
    {
        const uint8_t on[2] = {1, 0};
        (void)ble_gattc_write_flat(s_conn, (uint16_t)(s_plx_handle + 1), on, 2, on_plx_cccd, NULL);
    }
    return 0;
}

static int on_cccd_written(uint16_t conn, const struct ble_gatt_error *err, struct ble_gatt_attr *attr, void *arg)
{
    if (err->status == 0)
    {
        s_subscribed = true;
        s_t_sub = esp_timer_get_time();
        (void)ble_gattc_disc_chrs_by_uuid(s_conn, 1, 0xFFFF, BLE_UUID16_DECLARE(0x2A5F), on_plx_chr, NULL);
    }
    else s_stage_rc = 0x400 | err->status;
    return 0;
}

static int sfloat(const uint8_t *p)   // IEEE-11073 16-bit SFLOAT -> rounded int
{
    const uint16_t raw = (uint16_t)(p[0] | (p[1] << 8));
    int m = raw & 0x0FFF; if (m & 0x0800) m -= 0x1000;
    int e = (raw >> 12) & 0xF; if (e & 0x8) e -= 0x10;
    float v = (float)m;
    for (; e > 0; e--) v *= 10.0f;
    for (; e < 0; e++) v /= 10.0f;
    return (int)(v + (v >= 0 ? 0.5f : -0.5f));
}

static void subscribe(void)
{
    const uint8_t on[2] = {1, 0};
    uint16_t h = s_cccd_handle ? s_cccd_handle : (uint16_t)(s_val_handle + 1);
    int rc = ble_gattc_write_flat(s_conn, h, on, 2, on_cccd_written, NULL);
    if (rc) s_stage_rc = 0x300 | rc;
}

static int on_dsc(uint16_t conn, const struct ble_gatt_error *err, uint16_t chr_val_handle,
                  const struct ble_gatt_dsc *dsc, void *arg)
{
    if (err->status == 0 && dsc != NULL)
    {
        if (ble_uuid_cmp(&dsc->uuid.u, BLE_UUID16_DECLARE(BLE_GATT_DSC_CLT_CFG_UUID16)) == 0 && !s_cccd_handle)
            s_cccd_handle = dsc->handle;
        return 0;
    }
    subscribe();   // BLE_HS_EDONE or an error: write CCCD (found one, else value+1)
    return 0;
}

static int on_chr(uint16_t conn, const struct ble_gatt_error *err, const struct ble_gatt_chr *chr, void *arg)
{
    if (err->status == 0 && chr != NULL)
    {
        if (!s_val_handle) s_val_handle = chr->val_handle;
        return 0;
    }
    if (!s_val_handle) { s_stage_rc = 0x200 | err->status; return 0; }
    int rc = ble_gattc_disc_all_dscs(s_conn, s_val_handle, (uint16_t)(s_val_handle + 3), on_dsc, NULL);
    if (rc) subscribe();
    return 0;
}

static bool adv_is_hr(const struct ble_gap_disc_desc *d, char *name, size_t cap)
{
    struct ble_hs_adv_fields f;
    if (ble_hs_adv_parse_fields(&f, d->data, d->length_data) != 0) return false;
    if (f.name != NULL && f.name_len > 0)
    {
        size_t n = f.name_len < cap - 1 ? f.name_len : cap - 1;
        memcpy(name, f.name, n);
        name[n] = 0;
    }
    for (int i = 0; i < f.num_uuids16; i++)
        if (ble_uuid_u16(&f.uuids16[i].u) == 0x180D) return true;
    return false;
}

static int gap_event(struct ble_gap_event *ev, void *arg)
{
    switch (ev->type)
    {
    case BLE_GAP_EVENT_DISC:
        if (!s_found)
        {
            char nm[32] = "";
            if (adv_is_hr(&ev->disc, nm, sizeof nm))
            {
                s_found = true;
                s_t_found = esp_timer_get_time();
                s_peer = ev->disc.addr;
                s_peer_rssi = ev->disc.rssi;
                strncpy(s_peer_name, nm, sizeof s_peer_name - 1);
                (void)ble_gap_disc_cancel();
                int rc = ble_gap_connect(s_own, &s_peer, 10000, NULL, gap_event, NULL);
                if (rc) s_stage_rc = 0x100 | rc;
            }
        }
        return 0;
    case BLE_GAP_EVENT_DISC_COMPLETE:
        s_scan_done = true;
        return 0;
    case BLE_GAP_EVENT_CONNECT:
        if (ev->connect.status == 0)
        {
            s_conn = ev->connect.conn_handle;
            s_connected = s_had_conn = true;
            s_t_conn = esp_timer_get_time();
            int rc = ble_gattc_disc_chrs_by_uuid(s_conn, 1, 0xFFFF, BLE_UUID16_DECLARE(0x2A37), on_chr, NULL);
            if (rc) s_stage_rc = 0x200 | rc;
        }
        else
        {
            s_stage_rc = 0x500 | (ev->connect.status & 0xFF);
            s_found = false;   // retry scanning
            (void)scan_start();
        }
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        s_connected = false;
        s_disc_reason = ev->disconnect.reason;
        s_conn = BLE_HS_CONN_HANDLE_NONE;
        return 0;
    case BLE_GAP_EVENT_NOTIFY_RX:
    {
        uint8_t b[24];
        uint16_t n = OS_MBUF_PKTLEN(ev->notify_rx.om);
        if (n > sizeof b) n = sizeof b;
        if (os_mbuf_copydata(ev->notify_rx.om, 0, n, b) != 0 || n < 2) return 0;
        Hr_t h = {.t_us = esp_timer_get_time(), .flags = b[0], .len = (uint8_t)n, .kind = 1};
        if (s_plx_handle && ev->notify_rx.attr_handle == s_plx_handle)
        {
            if (n < 3) return 0;
            const int v = sfloat(b + 1);
            if (v < 0 || v > 100) return 0;
            h.kind = 2;
            h.bpm = (uint16_t)v;
        }
        else
        {
            h.bpm = (b[0] & 1) ? (uint16_t)(b[1] | (n >= 3 ? b[2] << 8 : 0)) : b[1];
        }
        s_ring[s_wr % RING] = h;
        s_wr++;
        s_notifies++;
        return 0;
    }
    default:
        return 0;
    }
}

static void on_sync(void)
{
    (void)ble_hs_util_ensure_addr(0);
    s_own = BLE_OWN_ADDR_PUBLIC;   /* always public: blelog leaves a random static addr in the host */
    s_synced = true;
    xSemaphoreGive(s_sync_sem);
}

static void on_reset(int reason) { (void)reason; s_synced = false; }

static void host_task(void *p)
{
    (void)p;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

static int band(int bpm) { return bpm < 50 ? -1 : (bpm > 130 ? 1 : 0); }

static volatile bool s_active, s_stop;
static int s_bg_sec, s_bg_every;
static bool s_bg_pulse;
bool xp_blehr_active(void) { return s_active; }

static int blehr_run(int sec, int every, bool pulse);

static void blehr_task(void *arg)
{
    (void)arg;
    (void)blehr_run(s_bg_sec, s_bg_every, s_bg_pulse);
    vTaskDelete(NULL);
}

static int cmd_blehr(int argc, char **argv)
{
    if (argc >= 2 && strcmp(argv[1], "stop") == 0)
    {
        s_stop = true;
        printf("{\"cmd\":\"blehr\",\"stop\":%s}\n", s_active ? "true" : "false");
        return 0;
    }
    int sec = (argc >= 2) ? atoi(argv[1]) : 60;
    int every = (argc >= 3) ? atoi(argv[2]) : 15;
    bool pulse = false, bg = false;
    for (int i = 3; i < argc; i++)
    {
        if (strcmp(argv[i], "pulse") == 0) pulse = true;   // backlight beats at the live HR
        if (strcmp(argv[i], "bg") == 0) bg = true;         // run in a task; console stays free
    }
    if (sec != 0 && sec < 5) sec = 5;   // 0 = forever (standalone)
    if (sec > 3600) sec = 3600;
    if (every < 1) every = 1;
    if (xp_mwifi_active() || s_active)
    {
        printf("{\"cmd\":\"blehr\",\"error\":\"busy (mwifi or blehr running)\"}\n");
        return 1;
    }
    if (bg)
    {
        s_bg_sec = sec; s_bg_every = every; s_bg_pulse = pulse;
        s_active = true;
        xTaskCreatePinnedToCore(blehr_task, "xp_blehr", 6144, NULL, 3, NULL, 0);
        printf("{\"cmd\":\"blehr\",\"bg\":true,\"sec\":%d}\n", sec);
        return 0;
    }
    return blehr_run(sec, every, pulse);
}

static int blehr_run(int sec, int every, bool pulse)
{
    s_active = true;
    s_stop = false;
    const bool forever = sec <= 0;     // standalone mode: run until `blehr stop`, rescan after every disconnect
    xp_awake(forever ? 0xFFFFFFFFu : (uint32_t)sec * 1000 + 30000);
    xp_radio_all_down();
    if (s_sync_sem == NULL) s_sync_sem = xSemaphoreCreateBinary();
    (void)xSemaphoreTake(s_sync_sem, 0);
    s_synced = s_found = s_connected = s_had_conn = s_subscribed = s_scan_done = false;
    s_conn = BLE_HS_CONN_HANDLE_NONE;
    s_val_handle = s_cccd_handle = s_plx_handle = 0;
    s_plx_sub = false;
    s_stage_rc = s_disc_reason = 0;
    s_wr = s_notifies = 0;
    s_t_found = s_t_conn = s_t_sub = 0;
    s_peer_name[0] = 0;

    const struct ble_hs_cfg saved = ble_hs_cfg;
    esp_err_t err = nimble_port_init();
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"blehr\",\"error\":\"nimble_port_init %s\"}\n", esp_err_to_name(err));
        s_active = false;
        return 1;
    }
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sm_bonding = 0;
    ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_NO_IO;
    ble_svc_gap_init();
    int rc = ble_svc_gap_device_name_set("CMX Monitor");
    nimble_port_freertos_init(host_task);
    if (xSemaphoreTake(s_sync_sem, pdMS_TO_TICKS(3000)) != pdTRUE || !s_synced) rc = -1;
    if (rc == 0) rc = scan_start();

    const int64_t t0 = esp_timer_get_time();
    const char *result = "setup_failed";
    uint32_t rd = 0, logged = 0;
    int64_t last_log = -1;
    int last_band = 0, last_bpm = 0, last_band2 = 0;
    int64_t last_log2 = -1;
    int64_t next_beat = 0, beat_off = 0;
    uint32_t beats = 0;
    bool lost = false;
    int last_link = -1, last_contact = -2;   // forwarded to the UI (note_vital kinds 10 / 11)
    if (rc == 0)
    {
        printf("{\"cmd\":\"blehr\",\"scanning\":true,\"svc\":\"0x180D\",\"sec\":%d,\"log_every_s\":%d}\n", sec, every);
        fflush(stdout);
        result = "timeout";
        bool said_found = false, said_conn = false, said_sub = false;
        const int64_t deadline = forever ? INT64_MAX : t0 + (int64_t)sec * 1000000;
        while (esp_timer_get_time() < deadline && !s_stop)
        {
            {
                const int link = s_subscribed ? 2 : (s_connected ? 1 : 0);
                if (link != last_link)
                {
                    last_link = link;
                    if (g_xp_hooks.note_vital != NULL) g_xp_hooks.note_vital(10, link, false);
                }
            }
            if (s_found && !said_found && s_t_found)
            {
                said_found = true;
                printf("{\"cmd\":\"blehr\",\"ev\":\"found\",\"name\":\"%s\",\"addr\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"type\":%u,\"rssi\":%d,\"t_ms\":%lld}\n",
                       s_peer_name, s_peer.val[5], s_peer.val[4], s_peer.val[3], s_peer.val[2], s_peer.val[1], s_peer.val[0],
                       s_peer.type, s_peer_rssi, (long long)((s_t_found - t0) / 1000));
            }
            if (s_had_conn && !said_conn)
            {
                said_conn = true;
                printf("{\"cmd\":\"blehr\",\"ev\":\"connected\",\"t_ms\":%lld}\n", (long long)((s_t_conn - t0) / 1000));
            }
            if (s_subscribed && !said_sub)
            {
                said_sub = true;
                printf("{\"cmd\":\"blehr\",\"ev\":\"subscribed\",\"val_handle\":%u,\"cccd\":%u,\"t_ms\":%lld}\n",
                       s_val_handle, s_cccd_handle, (long long)((s_t_sub - t0) / 1000));
            }
            while (rd != s_wr)
            {
                if (s_wr - rd > RING) rd = s_wr - RING;
                Hr_t h = s_ring[rd % RING];
                rd++;
                if (h.kind == 2)
                {
                    const int b2 = h.bpm < 90 ? -1 : 0;   // desaturation
                    const bool lg = last_log2 < 0 || (h.t_us - last_log2) >= (int64_t)every * 1000000 || b2 != last_band2;
                    const char *why = last_log2 < 0 ? "first" : (b2 != last_band2 ? (b2 ? "critical" : "normal_again") : (lg ? "periodic" : ""));
                    if (g_xp_hooks.note_vital != NULL) g_xp_hooks.note_vital(2, h.bpm, lg);
                    if (lg) { last_log2 = h.t_us; logged++; }
                    printf("{\"cmd\":\"blehr\",\"spo2\":%u,\"t_ms\":%lld%s%s%s}\n", h.bpm, (long long)((h.t_us - t0) / 1000),
                           lg ? ",\"logged\":\"" : "", why, lg ? "\"" : "");
                    last_band2 = b2;
                    continue;
                }
                {
                    // HR flags bit2 = contact supported, bit1 = contact detected. Sent with every packet so the
                    // UI also knows data is flowing. HR 0 = "no valid reading yet" (finger settling / absent).
                    const int contact = (h.flags & 0x04) ? ((h.flags & 0x02) ? 1 : 0) : -1;
                    if (g_xp_hooks.note_vital != NULL) g_xp_hooks.note_vital(11, contact, false);
                    if (contact != last_contact)
                    {
                        last_contact = contact;
                        printf("{\"cmd\":\"blehr\",\"ev\":\"contact\",\"contact\":%d}\n", contact);
                    }
                    if (h.bpm == 0 || contact == 0) continue;
                }
                const int b = band(h.bpm);
                const int64_t now = h.t_us;
                bool log = last_log < 0 || (now - last_log) >= (int64_t)every * 1000000 || b != last_band;
                const char *why = last_log < 0 ? "first" : (b != last_band ? (b ? "critical" : "normal_again") : (log ? "periodic" : ""));
                if (g_xp_hooks.note_vital != NULL) g_xp_hooks.note_vital(1, h.bpm, log);
                if (log) { last_log = now; logged++; }
                printf("{\"cmd\":\"blehr\",\"hr\":%u,\"flags\":\"0x%02x\",\"t_ms\":%lld%s%s%s}\n", h.bpm, h.flags,
                       (long long)((now - t0) / 1000), log ? ",\"logged\":\"" : "", why, log ? "\"" : "");
                last_band = b;
                last_bpm = h.bpm;
            }
            fflush(stdout);
            {
                // sensor-lost watchdog: silence > 5 s or a disconnect is itself logged (VITAL arg 9000 + seconds)
                const int64_t now = esp_timer_get_time();
                int64_t last = s_wr ? s_ring[(s_wr - 1) % RING].t_us : 0;
                if (s_t_sub > last) last = s_t_sub;   // a fresh (re)subscription restarts the silence clock
                const bool silent = s_subscribed && last && now - last > 5000000;
                const bool gone = s_had_conn && !s_connected;
                if ((silent || gone) && !lost)
                {
                    lost = true;
                    const int secs = last ? (int)((now - last) / 1000000) : 0;
                    if (g_xp_hooks.note_vital != NULL) g_xp_hooks.note_vital(9, secs > 999 ? 999 : secs, true);
                    logged++;
                    printf("{\"cmd\":\"blehr\",\"ev\":\"sensor_lost\",\"why\":\"%s\",\"silent_s\":%d,\"t_ms\":%lld}\n",
                           gone ? "disconnected" : "silent", secs, (long long)((now - t0) / 1000));
                    fflush(stdout);
                }
                if (!silent && !gone) lost = false;
                // standalone: the sensor sends every second, so > 6 s of silence on a live link means the link is
                // stale (e.g. the sensor app restarted under it). Hang up; the disconnect path below rescans.
                static int64_t s_kick_at = 0;
                if (forever && s_subscribed && s_connected && last && now - last > 6000000 && now - s_kick_at > 5000000
                    && s_conn != BLE_HS_CONN_HANDLE_NONE)
                {
                    s_kick_at = now;
                    const int trc = ble_gap_terminate(s_conn, BLE_ERR_REM_USER_CONN_TERM);
                    printf("{\"cmd\":\"blehr\",\"ev\":\"stale_link_hangup\",\"rc\":%d}\n", trc);
                    fflush(stdout);
                }
            }
            if (s_had_conn && !s_connected)
            {
                if (!forever) { result = "sensor_disconnected"; break; }
                // standalone: forget the peer and look for a sensor again (the same one coming back, or another)
                s_had_conn = s_found = s_subscribed = false;
                s_val_handle = s_cccd_handle = s_plx_handle = 0;
                s_plx_sub = false;
                s_t_found = s_t_sub = 0;
                said_found = said_conn = said_sub = false;
                last_bpm = 0;
                vTaskDelay(pdMS_TO_TICKS(500));
                const int r2 = scan_start();
                printf("{\"cmd\":\"blehr\",\"ev\":\"rescan\",\"rc\":%d}\n", r2);
                fflush(stdout);
            }
            if (pulse && last_bpm >= 20 && last_bpm <= 250)
            {
                const int64_t now = esp_timer_get_time();
                if (beat_off && now >= beat_off) { xp_bl_take(2); beat_off = 0; }
                if (now >= next_beat)
                {
                    xp_bl_take(15);
                    beat_off = now + 150000;
                    beats++;
                    const int64_t period = 60000000LL / last_bpm;
                    next_beat = (next_beat && now - next_beat < period) ? next_beat + period : now + period;
                }
                vTaskDelay(1);
            }
            else
            {
                vTaskDelay(pdMS_TO_TICKS(50));
            }
        }
    }

    if (pulse) xp_bl_release();
    if (g_xp_hooks.note_vital != NULL) g_xp_hooks.note_vital(10, 0, false);
    if (s_connected && s_conn != BLE_HS_CONN_HANDLE_NONE)
    {
        (void)ble_gap_terminate(s_conn, BLE_ERR_REM_USER_CONN_TERM);
        for (int i = 0; i < 200 && s_connected; i++) vTaskDelay(1);
    }
    (void)ble_gap_disc_cancel();
    if (nimble_port_stop() == 0)
    {
        vTaskDelay(2);
        nimble_port_deinit();
    }
    ble_hs_cfg = saved;
    printf("{\"cmd\":\"blehr\",\"done\":true,\"result\":\"%s\",\"rc\":%d,\"stage_rc\":\"0x%x\",\"notifies\":%lu,\"logged\":%lu,"
           "\"last_hr\":%d,\"beats\":%lu,\"disc_reason\":\"0x%03x\",\"ms\":%lld,\"free_internal\":%u}\n",
           result, rc, s_stage_rc, (unsigned long)s_notifies, (unsigned long)logged, last_bpm, (unsigned long)beats, s_disc_reason,
           (long long)((esp_timer_get_time() - t0) / 1000), (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    fflush(stdout);
    s_active = false;
    return rc == 0 ? 0 : 1;
}

void xp_register_blehr_cmds(void)
{
    const esp_console_cmd_t c = {
        .command = "blehr",
        .help = "xp2: blehr <seconds> [log_every_s=15] [pulse] [bg] | stop - BLE central: subscribe to any Heart Rate sensor (0x180D), log VITAL events",
        .func = cmd_blehr,
    };
    esp_console_cmd_register(&c);
}
