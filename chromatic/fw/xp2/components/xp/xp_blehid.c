// fw/xp2: "blehid <text>" - BLE HID-over-GATT keyboard named "CMX Handoff".
//
// Connectable advertising (appearance 0x03C1 keyboard, service 0x1812). Just-works bonding (no IO, LE Secure
// Connections), bonds kept in RAM only (CONFIG_BT_NIMBLE_NVS_PERSIST=n). Once the host has encrypted the link
// and subscribed to the input report, the text is typed (US layout; "\n" = Enter, "\t" = Tab, "\\" = backslash),
// then the device disconnects and the whole NimBLE stack is torn down. Waits up to 90 s for a host.
// Own NimBLE bring-up because the GATT table must be registered between nimble_port_init() and host start.

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
#include "host/ble_store.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

#include <stdlib.h>
#include <string.h>

void ble_store_config_init(void);

#define HID_NAME "CMX Handoff"
#define HID_APPEARANCE 0x03C1   // keyboard
#define HID_WAIT_S 90
#define TEXT_MAX 256

enum {
    ID_HID_INFO = 1, ID_REPORT_MAP, ID_CTRL_POINT, ID_PROTO_MODE, ID_INPUT, ID_INPUT_REF, ID_OUTPUT, ID_OUTPUT_REF,
    ID_MFR, ID_PNP, ID_BATT,
};

static const uint8_t kReportMap[] = {
    0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, 0x01,       // Usage Page Generic Desktop, Keyboard, Collection, Report ID 1
    0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,   // 8 modifier bits
    0x95, 0x01, 0x75, 0x08, 0x81, 0x01,                   // reserved byte
    0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02,   // 5 LEDs (output)
    0x95, 0x01, 0x75, 0x03, 0x91, 0x01,                   // LED padding
    0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x81, 0x00,   // 6 keys
    0xC0,
};
static const uint8_t kHidInfo[4] = {0x11, 0x01, 0x00, 0x02};          // bcdHID 1.11, country 0, normally connectable
static const uint8_t kInRef[2] = {0x01, 0x01};                        // report id 1, input
static const uint8_t kOutRef[2] = {0x01, 0x02};                       // report id 1, output
static const uint8_t kPnp[7] = {0x02, 0x3A, 0x30, 0x01, 0x00, 0x00, 0x01};   // USB VID 0x303A (Espressif), PID 1, ver 1.0
static const char kMfr[] = "CMX research";

static uint16_t s_h_input;
static uint8_t s_proto = 1;    // report protocol
static uint8_t s_leds;
static volatile uint16_t s_conn = BLE_HS_CONN_HANDLE_NONE;
static volatile bool s_synced, s_connected, s_enc, s_subscribed, s_done;
static volatile uint32_t s_connects, s_disconnects, s_enc_fail, s_last_disc_reason;
static uint8_t s_own_addr_type;
static SemaphoreHandle_t s_sync_sem;

static int chr_access(uint16_t conn, uint16_t attr, struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn; (void)attr;
    const int id = (int)(intptr_t)arg;
    const bool rd = (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR || ctxt->op == BLE_GATT_ACCESS_OP_READ_DSC);
    int rc = 0;
    switch (id)
    {
        case ID_HID_INFO: rc = os_mbuf_append(ctxt->om, kHidInfo, sizeof(kHidInfo)); break;
        case ID_REPORT_MAP: rc = os_mbuf_append(ctxt->om, kReportMap, sizeof(kReportMap)); break;
        case ID_CTRL_POINT: break;   // suspend / exit suspend: ignored
        case ID_PROTO_MODE:
            if (rd) rc = os_mbuf_append(ctxt->om, &s_proto, 1);
            else if (OS_MBUF_PKTLEN(ctxt->om) >= 1) os_mbuf_copydata(ctxt->om, 0, 1, &s_proto);
            break;
        case ID_INPUT: {
            static const uint8_t zero[8] = {0};
            rc = os_mbuf_append(ctxt->om, zero, sizeof(zero));
            break;
        }
        case ID_INPUT_REF: rc = os_mbuf_append(ctxt->om, kInRef, sizeof(kInRef)); break;
        case ID_OUTPUT:
            if (rd) rc = os_mbuf_append(ctxt->om, &s_leds, 1);
            else if (OS_MBUF_PKTLEN(ctxt->om) >= 1) os_mbuf_copydata(ctxt->om, 0, 1, &s_leds);
            break;
        case ID_OUTPUT_REF: rc = os_mbuf_append(ctxt->om, kOutRef, sizeof(kOutRef)); break;
        case ID_MFR: rc = os_mbuf_append(ctxt->om, kMfr, sizeof(kMfr) - 1); break;
        case ID_PNP: rc = os_mbuf_append(ctxt->om, kPnp, sizeof(kPnp)); break;
        case ID_BATT: {
            const uint8_t lvl = 100;
            rc = os_mbuf_append(ctxt->om, &lvl, 1);
            break;
        }
        default: return BLE_ATT_ERR_UNLIKELY;
    }
    return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

#define ENC_R (BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC)
static const ble_uuid16_t kUuidHid = BLE_UUID16_INIT(0x1812);
static const ble_uuid16_t kUuidDis = BLE_UUID16_INIT(0x180A);
static const ble_uuid16_t kUuidBas = BLE_UUID16_INIT(0x180F);
static const ble_uuid16_t kUuidReport = BLE_UUID16_INIT(0x2A4D);
static const ble_uuid16_t kUuidRepRef = BLE_UUID16_INIT(0x2908);

static struct ble_gatt_dsc_def s_in_dsc[] = {
    {.uuid = &kUuidRepRef.u, .att_flags = BLE_ATT_F_READ | BLE_ATT_F_READ_ENC, .access_cb = chr_access, .arg = (void *)ID_INPUT_REF},
    {0},
};
static struct ble_gatt_dsc_def s_out_dsc[] = {
    {.uuid = &kUuidRepRef.u, .att_flags = BLE_ATT_F_READ | BLE_ATT_F_READ_ENC, .access_cb = chr_access, .arg = (void *)ID_OUTPUT_REF},
    {0},
};
static const struct ble_gatt_svc_def kSvcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &kUuidHid.u,
        .characteristics = (struct ble_gatt_chr_def[]){
            {.uuid = BLE_UUID16_DECLARE(0x2A4A), .access_cb = chr_access, .arg = (void *)ID_HID_INFO, .flags = ENC_R},
            {.uuid = BLE_UUID16_DECLARE(0x2A4B), .access_cb = chr_access, .arg = (void *)ID_REPORT_MAP, .flags = ENC_R},
            {.uuid = BLE_UUID16_DECLARE(0x2A4C), .access_cb = chr_access, .arg = (void *)ID_CTRL_POINT,
             .flags = BLE_GATT_CHR_F_WRITE_NO_RSP | BLE_GATT_CHR_F_WRITE_ENC},
            {.uuid = BLE_UUID16_DECLARE(0x2A4E), .access_cb = chr_access, .arg = (void *)ID_PROTO_MODE,
             .flags = ENC_R | BLE_GATT_CHR_F_WRITE_NO_RSP | BLE_GATT_CHR_F_WRITE_ENC},
            {.uuid = &kUuidReport.u, .access_cb = chr_access, .arg = (void *)ID_INPUT, .descriptors = s_in_dsc,
             .flags = ENC_R | BLE_GATT_CHR_F_NOTIFY, .val_handle = &s_h_input},
            {.uuid = &kUuidReport.u, .access_cb = chr_access, .arg = (void *)ID_OUTPUT, .descriptors = s_out_dsc,
             .flags = ENC_R | BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP | BLE_GATT_CHR_F_WRITE_ENC},
            {0},
        },
    },
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &kUuidDis.u,
        .characteristics = (struct ble_gatt_chr_def[]){
            {.uuid = BLE_UUID16_DECLARE(0x2A29), .access_cb = chr_access, .arg = (void *)ID_MFR, .flags = BLE_GATT_CHR_F_READ},
            {.uuid = BLE_UUID16_DECLARE(0x2A50), .access_cb = chr_access, .arg = (void *)ID_PNP, .flags = BLE_GATT_CHR_F_READ},
            {0},
        },
    },
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &kUuidBas.u,
        .characteristics = (struct ble_gatt_chr_def[]){
            {.uuid = BLE_UUID16_DECLARE(0x2A19), .access_cb = chr_access, .arg = (void *)ID_BATT,
             .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY},
            {0},
        },
    },
    {0},
};

static int gap_event(struct ble_gap_event *ev, void *arg);

static int adv_start(void)
{
    struct ble_hs_adv_fields f = {0};
    static const ble_uuid16_t u = BLE_UUID16_INIT(0x1812);
    f.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    f.name = (const uint8_t *)HID_NAME;
    f.name_len = sizeof(HID_NAME) - 1;
    f.name_is_complete = 1;
    f.appearance = HID_APPEARANCE;
    f.appearance_is_present = 1;
    f.uuids16 = &u;
    f.num_uuids16 = 1;
    f.uuids16_is_complete = 1;
    int rc = ble_gap_adv_set_fields(&f);
    if (rc != 0) return rc;
    struct ble_gap_adv_params ap = {0};
    ap.conn_mode = BLE_GAP_CONN_MODE_UND;
    ap.disc_mode = BLE_GAP_DISC_MODE_GEN;
    ap.itvl_min = 48;   // 30 ms
    ap.itvl_max = 80;   // 50 ms
    return ble_gap_adv_start(s_own_addr_type, NULL, BLE_HS_FOREVER, &ap, gap_event, NULL);
}

static int gap_event(struct ble_gap_event *ev, void *arg)
{
    (void)arg;
    switch (ev->type)
    {
        case BLE_GAP_EVENT_CONNECT:
            if (ev->connect.status == 0)
            {
                s_conn = ev->connect.conn_handle;
                s_connected = true;
                s_connects++;
                (void)ble_gap_security_initiate(s_conn);   // ask for just-works pairing / encryption
            }
            else if (!s_done)
            {
                (void)adv_start();
            }
            break;
        case BLE_GAP_EVENT_DISCONNECT:
            s_connected = false;
            s_enc = false;
            s_subscribed = false;
            s_conn = BLE_HS_CONN_HANDLE_NONE;
            s_disconnects++;
            s_last_disc_reason = (uint32_t)ev->disconnect.reason;
            if (!s_done) (void)adv_start();
            break;
        case BLE_GAP_EVENT_ENC_CHANGE:
            if (ev->enc_change.status == 0) s_enc = true;
            else s_enc_fail++;
            break;
        case BLE_GAP_EVENT_SUBSCRIBE:
            if (ev->subscribe.attr_handle == s_h_input) s_subscribed = ev->subscribe.cur_notify;
            break;
        case BLE_GAP_EVENT_REPEAT_PAIRING: {
            struct ble_gap_conn_desc d;
            if (ble_gap_conn_find(ev->repeat_pairing.conn_handle, &d) == 0) ble_store_util_delete_peer(&d.peer_id_addr);
            return BLE_GAP_REPEAT_PAIRING_RETRY;
        }
        case BLE_GAP_EVENT_PASSKEY_ACTION:
            if (ev->passkey.params.action == BLE_SM_IOACT_NUMCMP)
            {
                struct ble_sm_io io = {.action = BLE_SM_IOACT_NUMCMP, .numcmp_accept = 1};
                (void)ble_sm_inject_io(ev->passkey.conn_handle, &io);
            }
            break;
        case BLE_GAP_EVENT_ADV_COMPLETE:
            if (!s_done && !s_connected) (void)adv_start();
            break;
        default:
            break;
    }
    return 0;
}

static void on_sync(void)
{
    (void)ble_hs_util_ensure_addr(0);
    s_own_addr_type = BLE_OWN_ADDR_PUBLIC;   /* always public (see blelog) */
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

// ASCII -> (modifier, usage) on a US layout. Returns false for characters it cannot type.
static bool map_us(char c, uint8_t *mod, uint8_t *key)
{
    static const char kShiftNum[] = ")!@#$%^&*(";
    static const struct { char c, s; uint8_t k; } kPunct[] = {
        {'-', '_', 0x2D}, {'=', '+', 0x2E}, {'[', '{', 0x2F}, {']', '}', 0x30}, {'\\', '|', 0x31},
        {';', ':', 0x33}, {'\'', '"', 0x34}, {'`', '~', 0x35}, {',', '<', 0x36}, {'.', '>', 0x37}, {'/', '?', 0x38},
    };
    *mod = 0;
    if (c >= 'a' && c <= 'z') { *key = (uint8_t)(0x04 + (c - 'a')); return true; }
    if (c >= 'A' && c <= 'Z') { *mod = 0x02; *key = (uint8_t)(0x04 + (c - 'A')); return true; }
    if (c >= '1' && c <= '9') { *key = (uint8_t)(0x1E + (c - '1')); return true; }
    if (c == '0') { *key = 0x27; return true; }
    if (c == '\n') { *key = 0x28; return true; }
    if (c == '\t') { *key = 0x2B; return true; }
    if (c == ' ') { *key = 0x2C; return true; }
    for (int i = 0; i < 10; i++)
    {
        if (c == kShiftNum[i]) { *mod = 0x02; *key = (i == 0) ? 0x27 : (uint8_t)(0x1E + i - 1); return true; }
    }
    for (size_t i = 0; i < sizeof(kPunct) / sizeof(kPunct[0]); i++)
    {
        if (c == kPunct[i].c) { *key = kPunct[i].k; return true; }
        if (c == kPunct[i].s) { *mod = 0x02; *key = kPunct[i].k; return true; }
    }
    return false;
}

static bool send_report(uint8_t mod, uint8_t key)
{
    const uint8_t r[8] = {mod, 0, key, 0, 0, 0, 0, 0};
    for (int tries = 0; tries < 40; tries++)
    {
        if (!s_connected) return false;
        struct os_mbuf *om = ble_hs_mbuf_from_flat(r, sizeof(r));
        if (om != NULL)
        {
            const int rc = ble_gatts_notify_custom(s_conn, s_h_input, om);   // consumes om
            if (rc == 0) return true;
            if (rc != BLE_HS_ENOMEM && rc != BLE_HS_EBUSY) return false;
        }
        vTaskDelay(1);
    }
    return false;
}

static int cmd_blehid(int argc, char **argv)
{
    if (argc < 2)
    {
        printf("{\"cmd\":\"blehid\",\"error\":\"usage: blehid <text>  (\\\\n = Enter, \\\\t = Tab; quote spaces or they join with one space)\"}\n");
        return 1;
    }
    char *text = calloc(1, TEXT_MAX + 1);
    if (text == NULL) return 1;
    size_t n = 0;
    for (int i = 1; i < argc && n < TEXT_MAX; i++)
    {
        if (i > 1 && n < TEXT_MAX) text[n++] = ' ';
        for (const char *p = argv[i]; *p && n < TEXT_MAX; p++)
        {
            if (p[0] == '\\' && p[1] == 'n') { text[n++] = '\n'; p++; }
            else if (p[0] == '\\' && p[1] == 't') { text[n++] = '\t'; p++; }
            else if (p[0] == '\\' && p[1] == '\\') { text[n++] = '\\'; p++; }
            else text[n++] = *p;
        }
    }
    if (xp_mwifi_active())
    {
        printf("{\"cmd\":\"blehid\",\"error\":\"mwifi is running: mwifi off first\"}\n");
        free(text);
        return 1;
    }
    xp_awake((HID_WAIT_S + 30) * 1000);
    xp_radio_all_down();

    if (s_sync_sem == NULL) s_sync_sem = xSemaphoreCreateBinary();
    (void)xSemaphoreTake(s_sync_sem, 0);
    s_synced = s_connected = s_enc = s_subscribed = s_done = false;
    s_connects = s_disconnects = s_enc_fail = s_last_disc_reason = 0;
    s_conn = BLE_HS_CONN_HANDLE_NONE;
    s_h_input = 0;

    const struct ble_hs_cfg saved = ble_hs_cfg;
    esp_err_t err = nimble_port_init();
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"blehid\",\"error\":\"nimble_port_init %s\"}\n", esp_err_to_name(err));
        free(text);
        return 1;
    }
    // RAM bond store: init once per boot so a bond made earlier in this boot survives a second run
    static bool store_inited = false;
    static ble_store_read_fn *st_rd;
    static ble_store_write_fn *st_wr;
    static ble_store_delete_fn *st_del;
    if (!store_inited)
    {
        ble_store_config_init();
        st_rd = ble_hs_cfg.store_read_cb;
        st_wr = ble_hs_cfg.store_write_cb;
        st_del = ble_hs_cfg.store_delete_cb;
        store_inited = true;
    }
    ble_hs_cfg.store_read_cb = st_rd;
    ble_hs_cfg.store_write_cb = st_wr;
    ble_hs_cfg.store_delete_cb = st_del;
    ble_hs_cfg.store_status_cb = ble_store_util_status_rr;
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_NO_IO;   // just works
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_mitm = 0;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;

    ble_svc_gap_init();
    ble_svc_gatt_init();
    int rc = ble_gatts_count_cfg(kSvcs);
    if (rc == 0) rc = ble_gatts_add_svcs(kSvcs);
    if (rc == 0) rc = ble_svc_gap_device_name_set(HID_NAME);
    if (rc == 0) rc = ble_svc_gap_device_appearance_set(HID_APPEARANCE);
    bool host_started = false;
    if (rc == 0)
    {
        nimble_port_freertos_init(host_task);
        host_started = true;
        if (xSemaphoreTake(s_sync_sem, pdMS_TO_TICKS(3000)) != pdTRUE || !s_synced) rc = -1;
    }
    if (rc == 0) rc = adv_start();

    const int64_t t0 = esp_timer_get_time();
    int typed = 0, skipped = 0, send_fail = 0;
    const char *result = "setup_failed";
    if (rc == 0)
    {
        uint8_t a[6] = {0};
        (void)ble_hs_id_copy_addr(s_own_addr_type == BLE_OWN_ADDR_RANDOM ? BLE_ADDR_RANDOM : BLE_ADDR_PUBLIC, a, NULL);
        printf("{\"cmd\":\"blehid\",\"adv\":true,\"name\":\"" HID_NAME "\",\"addr\":\"%02x:%02x:%02x:%02x:%02x:%02x\","
               "\"wait_s\":%d,\"text_len\":%u,\"input_handle\":%u,\"free_internal\":%u,"
               "\"hint\":\"Mac: Bluetooth settings > CMX Handoff > Connect\"}\n",
               a[5], a[4], a[3], a[2], a[1], a[0], HID_WAIT_S, (unsigned)n, s_h_input,
               (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
        fflush(stdout);
        result = "timeout_no_host";
        const int64_t deadline = t0 + (int64_t)HID_WAIT_S * 1000000;
        bool ready = false;
        int64_t sub_at = 0;
        bool said_conn = false;
        while (esp_timer_get_time() < deadline)
        {
            if (s_connected && !said_conn)
            {
                said_conn = true;
                printf("{\"cmd\":\"blehid\",\"ev\":\"connected\",\"t_ms\":%lld}\n", (long long)((esp_timer_get_time() - t0) / 1000));
            }
            if (!s_connected) said_conn = false;
            if (s_connected && s_subscribed)
            {
                if (sub_at == 0) sub_at = esp_timer_get_time();
                if (esp_timer_get_time() - sub_at > 1000000) { ready = true; break; }   // let the host finish setup
            }
            else
            {
                sub_at = 0;
            }
            vTaskDelay(pdMS_TO_TICKS(50));
        }
        if (ready)
        {
            printf("{\"cmd\":\"blehid\",\"ev\":\"typing\",\"enc\":%d,\"t_ms\":%lld}\n", s_enc,
                   (long long)((esp_timer_get_time() - t0) / 1000));
            fflush(stdout);
            result = "typed";
            for (size_t i = 0; i < n; i++)
            {
                uint8_t mod, key;
                if (!map_us(text[i], &mod, &key)) { skipped++; continue; }
                if (!send_report(mod, key) || !send_report(0, 0))
                {
                    send_fail++;
                    if (!s_connected) { result = "disconnected_while_typing"; break; }
                }
                else
                {
                    typed++;
                }
                vTaskDelay(2);   // ~2 reports per 20 ms: within one or two connection events on macOS
            }
            vTaskDelay(pdMS_TO_TICKS(500));
        }
    }

    // ---- teardown
    s_done = true;
    if (host_started)
    {
        if (s_connected && s_conn != BLE_HS_CONN_HANDLE_NONE)
        {
            (void)ble_gap_terminate(s_conn, BLE_ERR_REM_USER_CONN_TERM);
            for (int i = 0; i < 200 && s_connected; i++) vTaskDelay(1);
        }
        (void)ble_gap_adv_stop();
        if (nimble_port_stop() == 0)
        {
            vTaskDelay(2);
            nimble_port_deinit();
        }
    }
    else
    {
        nimble_port_deinit();
    }
    ble_hs_cfg = saved;

    printf("{\"cmd\":\"blehid\",\"done\":true,\"result\":\"%s\",\"rc\":%d,\"typed\":%d,\"skipped\":%d,\"send_fail\":%d,"
           "\"connects\":%lu,\"disconnects\":%lu,\"last_disc_reason\":\"0x%03lx\",\"enc_fail\":%lu,\"leds\":%u,\"ms\":%lld}\n",
           result, rc, typed, skipped, send_fail, (unsigned long)s_connects, (unsigned long)s_disconnects,
           (unsigned long)s_last_disc_reason, (unsigned long)s_enc_fail, s_leds,
           (long long)((esp_timer_get_time() - t0) / 1000));
    free(text);
    return rc == 0 ? 0 : 1;
}

void xp_register_blehid_cmds(void)
{
    const esp_console_cmd_t c = {
        .command = "blehid",
        .help = "xp2: blehid <text> - BLE HID keyboard \"CMX Handoff\": types text (\\n=Enter) once a host connects",
        .func = cmd_blehid,
    };
    esp_console_cmd_register(&c);
}
