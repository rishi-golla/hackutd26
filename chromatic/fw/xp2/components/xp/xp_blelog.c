// fw/xp2: "blelog <seconds>" - serve the medic hash-chained log (Medic_DumpLog text) over a BLE GATT server.
//
// Advertises "CMX Record" (connectable, no pairing), service UUID 9c4e0001-6b1d-4c2a-9a5e-c3d1f0a7e101 in the
// scan response. The log text is snapshotted once when the command starts.
//   RECORD 9c4e0002-... read + notify. On subscribe (or CTRL 0xFFFE) the whole text is streamed as notifications:
//          [seq u16 LE][up to MTU-5 bytes of text], seq = 0,1,2,... and then an end marker
//          [0xFFFF][total_len u32 LE][sha256(text) 32 B] (sha omitted if MTU-5 < 36).
//          A read returns [seq u16 LE][chunk] for the chunk index last written to CTRL.
//   CTRL   9c4e0003-... write (with or without response): u16 LE chunk index for RECORD reads; 0xFFFE = re-stream.
//   META   9c4e0004-... read: {"len":..,"chunks":..,"mtu_chunk":..,"head":"<64 hex>","sha256":"<64 hex>","seq_bytes":2}
// Stops after <seconds> or once a connected client disconnects. Wi-Fi is torn down first (BLE/Wi-Fi exclusive).

#include "xp_priv.h"

#include "esp_console.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mbedtls/sha256.h"

#include "host/ble_att.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"

#include <stdlib.h>
#include <string.h>

#define LOG_NAME "CMX Record"
#define LOG_CAP 12288   // 160 events x <= 58 B + header/footer < 9.6 KB
#define SEQ_END 0xFFFF
#define CTRL_RESTREAM 0xFFFE

// 9c4e00XX-6b1d-4c2a-9a5e-c3d1f0a7e101, little-endian byte order for NimBLE
#define CMX_UUID(id) BLE_UUID128_INIT(0x01, 0xe1, 0xa7, 0xf0, 0xd1, 0xc3, 0x5e, 0x9a, 0x2a, 0x4c, 0x1d, 0x6b, (id), 0x00, 0x4e, 0x9c)
static const ble_uuid128_t kSvcUuid = CMX_UUID(0x01);
static const ble_uuid128_t kRecUuid = CMX_UUID(0x02);
static const ble_uuid128_t kCtrlUuid = CMX_UUID(0x03);
static const ble_uuid128_t kMetaUuid = CMX_UUID(0x04);
static const ble_uuid128_t kMsgUuid = CMX_UUID(0x05);   // xp2: write UTF-8 text -> crew banner
static const ble_uuid128_t kAckUuid = CMX_UUID(0x06);   // xp2: read/notify "ACK <ms>" when the medic presses A

enum { ID_REC = 1, ID_CTRL, ID_META, ID_MSG, ID_ACK };
static uint16_t s_h_ack;
static volatile bool s_ack_sub, s_msg_pending;
static char s_msg_in[96], s_ack_txt[32] = "NONE";
static volatile uint32_t s_msgs;

static char *s_txt;
static size_t s_len;
static uint8_t s_sha[32];
static char s_head[65];
static uint16_t s_h_rec;
static volatile uint16_t s_read_idx;
static volatile uint16_t s_conn = BLE_HS_CONN_HANDLE_NONE;
static volatile bool s_synced, s_connected, s_had_conn, s_subscribed, s_stream_req, s_done;
static volatile uint16_t s_mtu = 23;
static volatile uint32_t s_reads, s_ctrl_writes, s_disc_reason;
static uint8_t s_own;
static SemaphoreHandle_t s_sync_sem;

static size_t chunk_size(void)
{
    const uint16_t m = s_conn != BLE_HS_CONN_HANDLE_NONE ? ble_att_mtu(s_conn) : s_mtu;
    size_t c = (m > 5 ? m : 23) - 5;   // ATT notify header 3 + our seq 2
    if (c > 240) c = 240;
    return c;
}

static size_t num_chunks(size_t cs) { return cs ? (s_len + cs - 1) / cs : 0; }

static int access_cb(uint16_t conn, uint16_t attr, struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    (void)conn; (void)attr;
    const int id = (int)(intptr_t)arg;
    int rc = 0;
    if (id == ID_REC && ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR)
    {
        s_reads++;
        const size_t cs = chunk_size();
        const uint16_t idx = s_read_idx;
        const size_t off = (size_t)idx * cs;
        const size_t n = off < s_len ? ((s_len - off) < cs ? (s_len - off) : cs) : 0;
        const uint8_t seq[2] = {(uint8_t)idx, (uint8_t)(idx >> 8)};
        rc = os_mbuf_append(ctxt->om, seq, 2);
        if (rc == 0 && n) rc = os_mbuf_append(ctxt->om, s_txt + off, n);
    }
    else if (id == ID_CTRL && ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR)
    {
        uint8_t b[2] = {0};
        if (OS_MBUF_PKTLEN(ctxt->om) < 2) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        os_mbuf_copydata(ctxt->om, 0, 2, b);
        const uint16_t v = (uint16_t)(b[0] | (b[1] << 8));
        s_ctrl_writes++;
        if (v == CTRL_RESTREAM) s_stream_req = true;
        else s_read_idx = v;
    }
    else if (id == ID_MSG && ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR)
    {
        uint16_t n = OS_MBUF_PKTLEN(ctxt->om);
        if (n == 0 || n >= sizeof s_msg_in) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        if (s_msg_pending) return BLE_ATT_ERR_UNLIKELY;   // previous one not yet posted
        os_mbuf_copydata(ctxt->om, 0, n, s_msg_in);
        s_msg_in[n] = 0;
        for (uint16_t i = 0; i < n; i++) if ((uint8_t)s_msg_in[i] < 0x20) s_msg_in[i] = ' ';
        s_msg_pending = true;
    }
    else if (id == ID_ACK && ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR)
    {
        rc = os_mbuf_append(ctxt->om, s_ack_txt, (uint16_t)strlen(s_ack_txt));
    }
    else if (id == ID_META && ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR)
    {
        char m[220], sha[65];
        for (int i = 0; i < 32; i++) snprintf(sha + 2 * i, 3, "%02x", s_sha[i]);
        const size_t cs = chunk_size();
        const int n = snprintf(m, sizeof m, "{\"len\":%u,\"chunks\":%u,\"mtu_chunk\":%u,\"head\":\"%s\",\"sha256\":\"%s\",\"seq_bytes\":2}",
                               (unsigned)s_len, (unsigned)num_chunks(cs), (unsigned)cs, s_head, sha);
        rc = os_mbuf_append(ctxt->om, m, (uint16_t)(n > 0 ? n : 0));
    }
    else
    {
        return BLE_ATT_ERR_UNLIKELY;
    }
    return rc == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
}

static const struct ble_gatt_svc_def kSvcs[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &kSvcUuid.u,
        .characteristics = (struct ble_gatt_chr_def[]){
            {.uuid = &kRecUuid.u, .access_cb = access_cb, .arg = (void *)ID_REC,
             .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY, .val_handle = &s_h_rec},
            {.uuid = &kCtrlUuid.u, .access_cb = access_cb, .arg = (void *)ID_CTRL,
             .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP},
            {.uuid = &kMetaUuid.u, .access_cb = access_cb, .arg = (void *)ID_META, .flags = BLE_GATT_CHR_F_READ},
            {.uuid = &kMsgUuid.u, .access_cb = access_cb, .arg = (void *)ID_MSG, .flags = BLE_GATT_CHR_F_WRITE},
            {.uuid = &kAckUuid.u, .access_cb = access_cb, .arg = (void *)ID_ACK,
             .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY, .val_handle = &s_h_ack},
            {0},
        },
    },
    {0},
};

static int gap_event(struct ble_gap_event *ev, void *arg);

static int adv_start(void)
{
    struct ble_hs_adv_fields f = {0};
    f.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    f.name = (const uint8_t *)LOG_NAME;
    f.name_len = sizeof(LOG_NAME) - 1;
    f.name_is_complete = 1;
    int rc = ble_gap_adv_set_fields(&f);   // 3 + 12 = 15 B
    if (rc != 0) return rc;
    struct ble_hs_adv_fields r = {0};
    r.uuids128 = &kSvcUuid;
    r.num_uuids128 = 1;
    r.uuids128_is_complete = 1;
    rc = ble_gap_adv_rsp_set_fields(&r);   // 18 B
    if (rc != 0) return rc;
    struct ble_gap_adv_params ap = {0};
    ap.conn_mode = BLE_GAP_CONN_MODE_UND;
    ap.disc_mode = BLE_GAP_DISC_MODE_GEN;
    ap.itvl_min = 48;   // 30 ms
    ap.itvl_max = 80;   // 50 ms
    return ble_gap_adv_start(s_own, NULL, BLE_HS_FOREVER, &ap, gap_event, NULL);
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
                s_connected = s_had_conn = true;
            }
            else if (!s_done)
            {
                (void)adv_start();
            }
            break;
        case BLE_GAP_EVENT_DISCONNECT:
            s_connected = s_subscribed = s_ack_sub = false;
            s_conn = BLE_HS_CONN_HANDLE_NONE;
            s_disc_reason = (uint32_t)ev->disconnect.reason;
            break;
        case BLE_GAP_EVENT_SUBSCRIBE:
            if (ev->subscribe.attr_handle == s_h_ack) s_ack_sub = ev->subscribe.cur_notify;
            if (ev->subscribe.attr_handle == s_h_rec)
            {
                if (ev->subscribe.cur_notify && !s_subscribed) s_stream_req = true;
                s_subscribed = ev->subscribe.cur_notify;
            }
            break;
        case BLE_GAP_EVENT_MTU:
            s_mtu = ev->mtu.value;
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
    // xp2: random static address, fixed per boot. macOS caches GATT by address and had cached this unit's public
    // address as a GAP-only peer (from blehr), hiding the CMX service; a fresh identity avoids stale caches.
    static ble_addr_t rnd;
    static bool have_rnd;
    if (!have_rnd && ble_hs_id_gen_rnd(0, &rnd) == 0) have_rnd = true;
    if (have_rnd && ble_hs_id_set_rnd(rnd.val) == 0)
    {
        s_own = BLE_OWN_ADDR_RANDOM;
        s_synced = true;
        xSemaphoreGive(s_sync_sem);
        return;
    }
    (void)ble_hs_util_ensure_addr(0);
    (void)ble_hs_id_infer_auto(0, &s_own);
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

static bool notify(const uint8_t *p, size_t n, uint32_t *retries)
{
    for (int tries = 0; tries < 300; tries++)
    {
        if (!s_connected || !s_subscribed) return false;
        struct os_mbuf *om = ble_hs_mbuf_from_flat(p, (uint16_t)n);
        if (om != NULL)
        {
            const int rc = ble_gatts_notify_custom(s_conn, s_h_rec, om);   // consumes om
            if (rc == 0) return true;
            if (rc != BLE_HS_ENOMEM && rc != BLE_HS_EBUSY) return false;
        }
        (*retries)++;
        vTaskDelay(1);
    }
    return false;
}

// Stream the snapshot as notifications. Returns chunks sent; prints one stats line.
static void stream(void)
{
    const size_t cs = chunk_size();
    const size_t nch = num_chunks(cs);
    uint8_t buf[2 + 240];
    uint32_t retries = 0;
    size_t sent = 0;
    bool ok = true;
    const int64_t t0 = esp_timer_get_time();
    for (size_t i = 0; i < nch && ok; i++)
    {
        const size_t off = i * cs;
        const size_t n = (s_len - off) < cs ? (s_len - off) : cs;
        buf[0] = (uint8_t)i;
        buf[1] = (uint8_t)(i >> 8);
        memcpy(buf + 2, s_txt + off, n);
        ok = notify(buf, 2 + n, &retries);
        if (ok) sent++;
        vTaskDelay(1);
    }
    if (ok)
    {
        buf[0] = 0xFF;
        buf[1] = 0xFF;
        const uint32_t L = (uint32_t)s_len;
        memcpy(buf + 2, &L, 4);
        size_t n = 6;
        if (cs >= 36) { memcpy(buf + 6, s_sha, 32); n = 38; }
        ok = notify(buf, n, &retries);
    }
    const int64_t us = esp_timer_get_time() - t0;
    printf("{\"cmd\":\"blelog\",\"ev\":\"streamed\",\"ok\":%d,\"chunks\":%u,\"of\":%u,\"mtu\":%u,\"chunk\":%u,\"bytes\":%u,\"ms\":%lld,"
           "\"kBps\":%.2f,\"retries\":%lu}\n",
           ok, (unsigned)sent, (unsigned)nch, s_conn != BLE_HS_CONN_HANDLE_NONE ? ble_att_mtu(s_conn) : 0, (unsigned)cs,
           (unsigned)s_len, (long long)(us / 1000), us > 0 ? (double)s_len * 1000.0 / (double)us : 0.0, (unsigned long)retries);
    fflush(stdout);
}

static int cmd_blelog(int argc, char **argv);
static char s_bg_sec[12];
static volatile bool s_bg_running;
static void blelog_task(void *arg)
{
    (void)arg;
    char *av[2] = {(char *)"blelog", s_bg_sec};
    (void)cmd_blelog(2, av);
    s_bg_running = false;
    vTaskDelete(NULL);
}

// xp2: start the GATT record server in the background (used by mwatch on arrival)
bool xp_blelog_start_bg(int sec)
{
    if (s_bg_running) return false;
    snprintf(s_bg_sec, sizeof s_bg_sec, "%d", sec);
    s_bg_running = true;
    return xTaskCreatePinnedToCore(blelog_task, "xp_blelog", 6144, NULL, 3, NULL, 0) == pdPASS;
}

static int cmd_blelog(int argc, char **argv)
{
    if (argc >= 3 && strcmp(argv[2], "bg") == 0)   // xp2: run in a task so the console stays free (mbtn etc.)
    {
        if (s_bg_running) { printf("{\"cmd\":\"blelog\",\"error\":\"already running\"}\n"); return 1; }
        strlcpy(s_bg_sec, argv[1], sizeof s_bg_sec);
        s_bg_running = true;
        xTaskCreatePinnedToCore(blelog_task, "xp_blelog", 6144, NULL, 3, NULL, 0);
        printf("{\"cmd\":\"blelog\",\"bg\":true}\n");
        return 0;
    }
    int sec = (argc >= 2) ? atoi(argv[1]) : 60;
    if (sec < 5) sec = 5;
    if (sec > 600) sec = 600;
    if (xp_mwifi_active())
    {
        printf("{\"cmd\":\"blelog\",\"error\":\"mwifi is running: mwifi off first\"}\n");
        return 1;
    }
    if (g_xp_hooks.dump_log == NULL)
    {
        printf("{\"cmd\":\"blelog\",\"error\":\"no dump_log hook\"}\n");
        return 1;
    }
    s_txt = malloc(LOG_CAP);
    if (s_txt == NULL)
    {
        printf("{\"cmd\":\"blelog\",\"error\":\"no mem\"}\n");
        return 1;
    }
    const int L = g_xp_hooks.dump_log(s_txt, LOG_CAP);
    s_len = L > 0 ? (size_t)L : 0;
    mbedtls_sha256((const unsigned char *)s_txt, s_len, s_sha, 0);
    memset(s_head, '0', 64);
    s_head[64] = 0;
    s_txt[s_len < LOG_CAP ? s_len : LOG_CAP - 1] = 0;
    const char *h = strstr(s_txt, "MLOG END head=");
    if (h != NULL && strlen(h + 14) >= 64) memcpy(s_head, h + 14, 64);

    xp_awake((uint32_t)sec * 1000 + 30000);
    xp_radio_all_down();
    if (s_sync_sem == NULL) s_sync_sem = xSemaphoreCreateBinary();
    (void)xSemaphoreTake(s_sync_sem, 0);
    s_synced = s_connected = s_had_conn = s_subscribed = s_stream_req = s_done = false;
    s_conn = BLE_HS_CONN_HANDLE_NONE;
    s_mtu = 23;
    s_read_idx = 0;
    s_reads = s_ctrl_writes = s_disc_reason = 0;
    s_h_rec = 0;
    s_h_ack = 0;
    s_ack_sub = s_msg_pending = false;
    s_msgs = 0;
    strcpy(s_ack_txt, "NONE");

    const struct ble_hs_cfg saved = ble_hs_cfg;
    esp_err_t err = nimble_port_init();
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"blelog\",\"error\":\"nimble_port_init %s\"}\n", esp_err_to_name(err));
        free(s_txt);
        s_txt = NULL;
        return 1;
    }
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sm_bonding = 0;   // no pairing: nothing here needs encryption
    ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_NO_IO;

    ble_svc_gap_init();
    ble_svc_gatt_init();
    int rc = ble_gatts_count_cfg(kSvcs);
    if (rc == 0) rc = ble_gatts_add_svcs(kSvcs);
    if (rc == 0) rc = ble_svc_gap_device_name_set(LOG_NAME);
    bool host_started = false;
    if (rc == 0)
    {
        nimble_port_freertos_init(host_task);
        host_started = true;
        if (xSemaphoreTake(s_sync_sem, pdMS_TO_TICKS(3000)) != pdTRUE || !s_synced) rc = -1;
    }
    if (rc == 0) rc = adv_start();

    const int64_t t0 = esp_timer_get_time();
    const char *result = "setup_failed";
    int streams = 0;
    if (rc == 0)
    {
        uint8_t a[6] = {0};
        (void)ble_hs_id_copy_addr(s_own == BLE_OWN_ADDR_RANDOM ? BLE_ADDR_RANDOM : BLE_ADDR_PUBLIC, a, NULL);
        printf("{\"cmd\":\"blelog\",\"adv\":true,\"name\":\"" LOG_NAME "\",\"addr\":\"%02x:%02x:%02x:%02x:%02x:%02x\","
               "\"svc\":\"9c4e0001-6b1d-4c2a-9a5e-c3d1f0a7e101\",\"sec\":%d,\"len\":%u,\"head\":\"%s\",\"free_internal\":%u}\n",
               a[5], a[4], a[3], a[2], a[1], a[0], sec, (unsigned)s_len, s_head,
               (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
        fflush(stdout);
        result = "timeout";
        bool said = false, waiting_ack = false;
        const int64_t deadline = t0 + (int64_t)sec * 1000000;
        while (esp_timer_get_time() < deadline)
        {
            if (s_connected && !said)
            {
                said = true;
                printf("{\"cmd\":\"blelog\",\"ev\":\"connected\",\"t_ms\":%lld}\n", (long long)((esp_timer_get_time() - t0) / 1000));
                fflush(stdout);
            }
            if (s_had_conn && !s_connected) { result = "client_disconnected"; break; }
            if (s_msg_pending)
            {
                const int64_t tm = esp_timer_get_time();
                const int n = g_xp_hooks.post_msg != NULL ? g_xp_hooks.post_msg(s_msg_in) : 0;
                s_msg_pending = false;
                s_msgs++;
                waiting_ack = true;
                strcpy(s_ack_txt, "PENDING");
                printf("{\"cmd\":\"blelog\",\"ev\":\"msg_rx\",\"len\":%d,\"t_ms\":%lld}\n", n, (long long)((tm - t0) / 1000));
                fflush(stdout);
            }
            if (waiting_ack && g_xp_hooks.msg_ack_ms != NULL)
            {
                const int ms = g_xp_hooks.msg_ack_ms();
                if (ms >= 0)
                {
                    waiting_ack = false;
                    snprintf(s_ack_txt, sizeof s_ack_txt, "ACK %d", ms);
                    if (s_connected && s_ack_sub)
                    {
                        struct os_mbuf *om = ble_hs_mbuf_from_flat(s_ack_txt, (uint16_t)strlen(s_ack_txt));
                        if (om != NULL) (void)ble_gatts_notify_custom(s_conn, s_h_ack, om);
                    }
                    printf("{\"cmd\":\"blelog\",\"ev\":\"ack\",\"ms\":%d,\"notified\":%d}\n", ms, (int)(s_connected && s_ack_sub));
                    fflush(stdout);
                }
            }
            if (s_stream_req && s_connected && s_subscribed)
            {
                s_stream_req = false;
                vTaskDelay(pdMS_TO_TICKS(100));   // let the client finish its CCCD write handling
                stream();
                streams++;
            }
            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }

    // ---- teardown (restore: BLE fully down, ble_hs_cfg as before)
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
    printf("{\"cmd\":\"blelog\",\"done\":true,\"result\":\"%s\",\"rc\":%d,\"streams\":%d,\"reads\":%lu,\"ctrl_writes\":%lu,"
           "\"disc_reason\":\"0x%03lx\",\"ms\":%lld,\"free_internal\":%u}\n",
           result, rc, streams, (unsigned long)s_reads, (unsigned long)s_ctrl_writes, (unsigned long)s_disc_reason,
           (long long)((esp_timer_get_time() - t0) / 1000), (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
    free(s_txt);
    s_txt = NULL;
    s_len = 0;
    return rc == 0 ? 0 : 1;
}

void xp_register_blelog_cmds(void)
{
    const esp_console_cmd_t c = {
        .command = "blelog",
        .help = "xp2: blelog <seconds> [bg] - BLE GATT (+MSG/ACK) \"CMX Record\": streams the mlog text (notify, 2-byte seq) to a subscriber",
        .func = cmd_blelog,
    };
    esp_console_cmd_register(&c);
}
