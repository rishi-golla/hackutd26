// fw/xp: passive tap on the FPGA system-monitor UART (fed by main/fpga_rx.c) + raw command sender.

#include "xp_priv.h"

#include "esp_console.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#include <stdlib.h>
#include <string.h>

enum {
    kTapMaxAddrs = 32,
    kTapMaxRaw   = 32,
    kTapRawLen   = 16,
};

typedef struct {
    uint8_t hdr, addr;
    uint8_t min_len, max_len;
    uint32_t count;
    uint32_t first_ms, last_ms;
    uint8_t last_len;
    uint8_t last[kTapRawLen];
} TapAddr_t;

typedef struct {
    uint32_t t_ms;
    uint8_t len;
    uint8_t err;   // 0 = ok, 1 = crc fail, 2 = len error
    uint8_t b[kTapRawLen];
} TapRaw_t;

static volatile bool s_on = false;
static int64_t s_t0_us;
static uint32_t s_bytes, s_frames, s_crc_err, s_len_err, s_addr_overflow;
static uint32_t s_raw_max = 16;
static uint32_t s_nraw;
static uint32_t s_naddr;
static TapAddr_t s_addr[kTapMaxAddrs];
static TapRaw_t s_raw[kTapMaxRaw];

// Addresses the stock fpga_rx.c knows about (kRxCmd_*): 0x0..0x9.
static bool addr_known(uint8_t a) { return a <= 0x9; }

static uint32_t now_ms(void) { return (uint32_t)((esp_timer_get_time() - s_t0_us) / 1000); }

static void tap_reset(uint32_t raw_max)
{
    s_on = false;
    s_bytes = s_frames = s_crc_err = s_len_err = s_addr_overflow = 0;
    s_nraw = s_naddr = 0;
    s_raw_max = raw_max > kTapMaxRaw ? kTapMaxRaw : raw_max;
    memset(s_addr, 0, sizeof(s_addr));
    memset(s_raw, 0, sizeof(s_raw));
    s_t0_us = esp_timer_get_time();
}

static void store_raw(const uint8_t *raw, size_t len, uint8_t err)
{
    if (s_nraw >= s_raw_max)
    {
        return;
    }
    TapRaw_t *r = &s_raw[s_nraw++];
    r->t_ms = now_ms();
    r->err = err;
    r->len = (uint8_t)(len > kTapRawLen ? kTapRawLen : len);
    memcpy(r->b, raw, r->len);
}

void XP_TapBytes(size_t n)
{
    if (s_on)
    {
        s_bytes += n;
    }
}

// ---- msense stream ring (single producer = FPGA rx task, single consumer = console task) ----
enum { kStreamLen = 256 };
typedef struct {
    uint32_t t_ms;
    uint8_t hdr, addr, len;
    uint8_t p[4];
} StreamEnt_t;
static volatile bool s_stream_on = false;
static volatile uint32_t s_sw, s_sr, s_sdrop;
static int64_t s_stream_t0;
static StreamEnt_t s_stream[kStreamLen];

static void stream_push(const uint8_t *raw, size_t len)
{
    if ((s_sw - s_sr) >= kStreamLen)
    {
        s_sdrop++;
        return;
    }
    StreamEnt_t *e = &s_stream[s_sw % kStreamLen];
    e->t_ms = (uint32_t)((esp_timer_get_time() - s_stream_t0) / 1000);
    e->hdr = raw[0];
    e->addr = raw[1];
    memset(e->p, 0, sizeof(e->p));
    if (raw[0] == 0x8F && len >= 4)
    {
        e->len = raw[2];
        const size_t n = (len - 4) < 4 ? (len - 4) : 4;   // payload sits between len byte and crc
        memcpy(e->p, &raw[3], n);
    }
    else
    {
        e->len = 2;                                         // V1: 2 x 7-bit payload bytes
        e->p[0] = len > 2 ? raw[2] : 0;
        e->p[1] = len > 3 ? raw[3] : 0;
    }
    s_sw++;
}

void XP_TapFrame(const uint8_t *raw, size_t len)
{
    if (s_stream_on && raw != NULL && len >= 2)
    {
        stream_push(raw, len);
    }
    if (!s_on || raw == NULL || len < 2)
    {
        return;
    }
    s_frames++;
    const uint8_t hdr = raw[0], addr = raw[1];
    TapAddr_t *e = NULL;
    for (uint32_t i = 0; i < s_naddr; i++)
    {
        if (s_addr[i].hdr == hdr && s_addr[i].addr == addr)
        {
            e = &s_addr[i];
            break;
        }
    }
    if (e == NULL)
    {
        if (s_naddr >= kTapMaxAddrs)
        {
            s_addr_overflow++;
        }
        else
        {
            e = &s_addr[s_naddr++];
            e->hdr = hdr;
            e->addr = addr;
            e->min_len = 0xFF;
            e->first_ms = now_ms();
        }
    }
    if (e != NULL)
    {
        e->count++;
        e->last_ms = now_ms();
        if (len < e->min_len) e->min_len = (uint8_t)len;
        if (len > e->max_len) e->max_len = (uint8_t)len;
        e->last_len = (uint8_t)(len > kTapRawLen ? kTapRawLen : len);
        memcpy(e->last, raw, e->last_len);
    }
    store_raw(raw, len, 0);
}

void XP_TapError(int kind, const uint8_t *raw, size_t len)
{
    if (!s_on)
    {
        return;
    }
    if (kind == kXpTapErr_Crc) s_crc_err++;
    else s_len_err++;
    store_raw(raw, len, (uint8_t)(kind == kXpTapErr_Crc ? 1 : 2));
}

static void tap_print(const char *cmd, uint32_t window_ms)
{
    s_on = false;
    vTaskDelay(2);   // let an in-flight rx-task callback finish
    int out = printf("{\"cmd\":\"%s\",\"window_ms\":%lu,\"bytes\":%lu,\"frames\":%lu,\"crc_err\":%lu,\"len_err\":%lu,\"addrs\":%lu,\"addr_overflow\":%lu}\n",
                     cmd, (unsigned long)window_ms, (unsigned long)s_bytes, (unsigned long)s_frames, (unsigned long)s_crc_err,
                     (unsigned long)s_len_err, (unsigned long)s_naddr, (unsigned long)s_addr_overflow);
    for (uint32_t i = 0; i < s_naddr && out < XP_OUT_BUDGET - 600; i++)
    {
        const TapAddr_t *e = &s_addr[i];
        const float hz = window_ms ? (float)e->count * 1000.0f / (float)window_ms : 0;
        out += printf("{\"cmd\":\"%s\",\"hdr\":\"%02x\",\"addr\":\"0x%02x\",\"known\":%s,\"count\":%lu,\"hz\":%.2f,\"len\":[%u,%u],\"first_ms\":%lu,\"last\":\"",
                      cmd, e->hdr, e->addr, addr_known(e->addr) ? "true" : "false", (unsigned long)e->count, hz,
                      e->min_len, e->max_len, (unsigned long)e->first_ms);
        xp_print_hexstr(e->last, e->last_len);
        out += 2 * e->last_len + 3;
        printf("\"}\n");
    }
    for (uint32_t i = 0; i < s_nraw && out < XP_OUT_BUDGET; i++)
    {
        const TapRaw_t *r = &s_raw[i];
        out += printf("{\"cmd\":\"%s\",\"raw\":%lu,\"t_ms\":%lu,\"err\":%u,\"hex\":\"", cmd, (unsigned long)i, (unsigned long)r->t_ms, r->err);
        xp_print_hexstr(r->b, r->len);
        out += 2 * r->len + 3;
        printf("\"}\n");
    }
}

static void wait_window(uint32_t ms)
{
    const int64_t end = esp_timer_get_time() + (int64_t)ms * 1000;
    while (esp_timer_get_time() < end)
    {
        vTaskDelay(pdMS_TO_TICKS(50));
    }
}

// fpgasniff <seconds> [raw_count=16]
static int cmd_fpgasniff(int argc, char **argv)
{
    int sec = (argc >= 2) ? atoi(argv[1]) : 5;
    int nraw = (argc >= 3) ? atoi(argv[2]) : 16;
    if (sec < 1) sec = 1;
    if (sec > 600) sec = 600;
    if (nraw < 0) nraw = 0;
    xp_awake((uint32_t)sec * 1000 + 15000);
    tap_reset((uint32_t)nraw);
    s_on = true;
    wait_window((uint32_t)sec * 1000);
    tap_print("fpgasniff", (uint32_t)sec * 1000);
    return 0;
}

// fpgacmd <hex id 0x0-0x1F> <hex payload16> [listen_ms=300]
static int cmd_fpgacmd(int argc, char **argv)
{
    if (argc < 3)
    {
        printf("{\"cmd\":\"fpgacmd\",\"error\":\"usage: fpgacmd <hex id 0-1F> <hex payload16> [listen_ms]\"}\n");
        return 1;
    }
    char *end = NULL;
    const unsigned long id = strtoul(argv[1], &end, 16);
    if (end == argv[1] || *end != 0 || id > 0x1F)
    {
        printf("{\"cmd\":\"fpgacmd\",\"error\":\"id must be hex 0x0..0x1F (guard)\"}\n");
        return 1;
    }
    const unsigned long pl = strtoul(argv[2], &end, 16);
    if (end == argv[2] || *end != 0 || pl > 0xFFFF)
    {
        printf("{\"cmd\":\"fpgacmd\",\"error\":\"payload must be hex 0x0..0xFFFF\"}\n");
        return 1;
    }
    int listen = (argc >= 4) ? atoi(argv[3]) : 300;
    if (listen < 0) listen = 0;
    if (listen > 10000) listen = 10000;
    if (g_xp_hooks.fpga_send_raw == NULL)
    {
        printf("{\"cmd\":\"fpgacmd\",\"error\":\"no send hook\"}\n");
        return 1;
    }
    xp_awake((uint32_t)listen + 15000);

    tap_reset(kTapMaxRaw);
    s_on = true;
    uint8_t frame[16] = {0};
    const size_t n = g_xp_hooks.fpga_send_raw((uint8_t)id, (uint16_t)pl, frame, sizeof(frame));
    printf("{\"cmd\":\"fpgacmd\",\"id\":\"0x%02lx\",\"payload16\":\"0x%04lx\",\"sent\":%u,\"frame\":\"", id, pl, (unsigned)n);
    xp_print_hexstr(frame, n);
    printf("\"}\n");
    if (n == 0)
    {
        s_on = false;
        return 1;
    }
    wait_window((uint32_t)listen);
    tap_print("fpgacmd_rx", (uint32_t)listen);
    return 0;
}

// msense <seconds> [max_lines=600]  every FPGA->MCU sysmon packet, one compact line each, incl. ones the
// stock code discards (0x3 volume/headphone, 0x5 PMIC, 0x7 temperature). Packets only flow while the menu is open.
static int cmd_msense(int argc, char **argv)
{
    int sec = (argc >= 2) ? atoi(argv[1]) : 10;
    int max_lines = (argc >= 3) ? atoi(argv[2]) : 600;
    if (sec < 1) sec = 1;
    if (sec > 600) sec = 600;
    if (max_lines < 0) max_lines = 0;
    xp_awake((uint32_t)sec * 1000 + 15000);

    static uint32_t cnt[256];
    memset(cnt, 0, sizeof(cnt));
    s_sr = s_sw = s_sdrop = 0;
    s_stream_t0 = esp_timer_get_time();
    s_stream_on = true;
    printf("{\"cmd\":\"msense\",\"sec\":%d,\"note\":\"packets flow only while the menu/overlay is open\"}\n", sec);

    int lines = 0;
    uint32_t total = 0;
    const int64_t end = esp_timer_get_time() + (int64_t)sec * 1000000;
    bool running = true;
    while (running)
    {
        if (esp_timer_get_time() >= end)
        {
            s_stream_on = false;
            vTaskDelay(2);
            running = false;   // drain what is left, then stop
        }
        while (s_sr != s_sw)
        {
            const StreamEnt_t e = s_stream[s_sr % kStreamLen];
            s_sr++;
            total++;
            cnt[e.addr]++;
            if (lines >= max_lines)
            {
                continue;
            }
            lines++;
            const bool v1 = (e.hdr == 0x8A);
            const unsigned x = v1 ? (((unsigned)e.p[0] << 7) | e.p[1]) : (((unsigned)e.p[0] << 8) | e.p[1]);
            printf("{\"t\":%lu,\"a\":%u,\"l\":%u,\"x\":\"%04x\",\"p\":\"%02x%02x%02x%02x\"", (unsigned long)e.t_ms, e.addr, e.len,
                   x, e.p[0], e.p[1], e.p[2], e.p[3]);
            switch (e.addr)
            {
                case 0x0: case 0x1: printf(",\"%s\":%u,\"pcb\":%u", e.addr ? "lipo" : "aa", x & 0x7FFF, x >> 15); break;
                case 0x2: printf(",\"btn\":\"%04x\"", x); break;
                case 0x3: printf(",\"vol\":%u,\"hp\":%u,\"bl\":%u", 127 - (x & 0x7F), (x >> 7) & 1, x >> 8); break;
                case 0x5: printf(",\"pmic\":\"%04x\",\"chg\":%u", x, ((x >> 4) & 3) == 2); break;
                case 0x6: printf(",\"fpga_ver\":\"%u.%u\",\"dbg\":%u", x & 0x3F, (x >> 6) & 0x3F, (x >> 12) & 1); break;
                case 0x7: printf(",\"temp_raw\":%u", x); break;
                default: break;
            }
            printf("}\n");
            if ((lines & 15) == 0)
            {
                vTaskDelay(1);
            }
        }
        if (running)
        {
            vTaskDelay(pdMS_TO_TICKS(20));
        }
    }
    printf("{\"cmd\":\"msense\",\"total\":%lu,\"printed\":%d,\"ring_drops\":%lu,\"counts\":{", (unsigned long)total, lines,
           (unsigned long)s_sdrop);
    bool first = true;
    for (int a = 0; a < 256; a++)
    {
        if (cnt[a])
        {
            printf("%s\"0x%02x\":%lu", first ? "" : ",", a, (unsigned long)cnt[a]);
            first = false;
        }
    }
    printf("}}\n");
    return 0;
}

// ---------------------------------------------------------------- backlight override + optical modem
void xp_bl_release(void);
static volatile bool s_bl_override = false;

bool XP_BacklightOverride(void) { return s_bl_override; }

static bool bl_send(int level)
{
    if (g_xp_hooks.fpga_send_raw == NULL)
    {
        return false;
    }
    return g_xp_hooks.fpga_send_raw(0x5, (uint16_t)level, NULL, 0) > 0;   // kTxCmd_BacklightCtl
}

// xp2: used by blehr pulse mode (the backlight beats with the live heart rate)
bool xp_bl_take(int level) { s_bl_override = true; return bl_send(level); }
void xp_bl_release(void);

static void bl_restore(void)
{
    s_bl_override = false;
    if (g_xp_hooks.backlight_restore != NULL)
    {
        g_xp_hooks.backlight_restore();   // stock TX task re-sends the saved level
    }
}

// bl <0-15> | bl restore
static int cmd_bl(int argc, char **argv)
{
    if (argc < 2)
    {
        printf("{\"cmd\":\"bl\",\"override\":%s}\n", s_bl_override ? "true" : "false");
        return 0;
    }
    if (strcmp(argv[1], "restore") == 0)
    {
        bl_restore();
        printf("{\"cmd\":\"bl\",\"restored\":true}\n");
        return 0;
    }
    const int lvl = atoi(argv[1]);
    if (lvl < 0 || lvl > 15)
    {
        printf("{\"cmd\":\"bl\",\"error\":\"level 0..15\"}\n");
        return 1;
    }
    s_bl_override = true;
    const bool ok = bl_send(lvl);
    printf("{\"cmd\":\"bl\",\"level\":%d,\"sent\":%s,\"override\":true,\"nvs\":false,\"hint\":\"bl restore\"}\n", lvl,
           ok ? "true" : "false");
    return ok ? 0 : 1;
}

// Manchester (IEEE 802.3): bit 1 = lo->hi, bit 0 = hi->lo, MSB first. Frame = AA AA + data.
// Sent from an esp_timer callback at the half-bit period, so timing does not depend on the 10 ms tick.
typedef struct {
    uint8_t bytes[2 + 32];
    int nbytes;
    int hi, lo;
    int lead, tail;            // idle half-bits at hi before/after
    int nhalf, k;
    int64_t t0, half_us;
    int64_t max_late_us;
    uint32_t send_fail;
    esp_timer_handle_t timer;
    SemaphoreHandle_t done;
    bool pam;                  // blpam: 4-level symbols, idle at L[0], sync 3,0,3,0
    int L[4];
} BlSeq_t;
static BlSeq_t s_seq;

static int seq_level(const BlSeq_t *s, int k)
{
    if (s->pam)
    {
        static const int sync[4] = {3, 0, 3, 0};
        if (k < s->lead) return s->L[0];
        k -= s->lead;
        if (k < 4) return s->L[sync[k]];
        k -= 4;
        if (k < s->nbytes * 4) return s->L[(s->bytes[k / 4] >> (6 - 2 * (k % 4))) & 3];
        return s->L[0];
    }
    if (k < s->lead) return s->hi;
    k -= s->lead;
    const int nbits = s->nbytes * 8;
    if (k >= nbits * 2) return s->hi;
    const int bit = k / 2, half = k % 2;
    const int v = (s->bytes[bit / 8] >> (7 - (bit % 8))) & 1;
    const bool high = v ? (half == 1) : (half == 0);
    return high ? s->hi : s->lo;
}

static void seq_cb(void *arg)
{
    BlSeq_t *s = (BlSeq_t *)arg;
    if (s->k >= s->nhalf)
    {
        esp_timer_stop(s->timer);
        xSemaphoreGive(s->done);
        return;
    }
    const int64_t late = esp_timer_get_time() - (s->t0 + s->k * s->half_us);
    if (late > s->max_late_us) s->max_late_us = late;
    if (!bl_send(seq_level(s, s->k))) s->send_fail++;
    s->k++;
}

// blseq <hexbytes> <bit_ms> <hi> <lo>
static int cmd_blseq(int argc, char **argv)
{
    if (argc < 5)
    {
        printf("{\"cmd\":\"blseq\",\"error\":\"usage: blseq <hexbytes> <bit_ms> <hi 0-15> <lo 0-15>\"}\n");
        return 1;
    }
    BlSeq_t *s = &s_seq;
    memset(s, 0, sizeof(*s));
    size_t n = 0;
    if (!xp_parse_hex_bytes(argv[1], &s->bytes[2], 32, &n))
    {
        printf("{\"cmd\":\"blseq\",\"error\":\"bad hex (max 32 bytes)\"}\n");
        return 1;
    }
    s->bytes[0] = 0xAA;
    s->bytes[1] = 0xAA;
    s->nbytes = (int)n + 2;
    const int bit_ms = atoi(argv[2]);
    s->hi = atoi(argv[3]);
    s->lo = atoi(argv[4]);
    if (bit_ms < 4 || bit_ms > 5000 || s->hi < 0 || s->hi > 15 || s->lo < 0 || s->lo > 15)
    {
        printf("{\"cmd\":\"blseq\",\"error\":\"bit_ms 4..5000, levels 0..15\"}\n");
        return 1;
    }
    s->half_us = (int64_t)bit_ms * 500;
    s->lead = (int)(1000000 / s->half_us) + 1;   // ~1 s idle at hi before and after
    s->tail = s->lead;
    s->nhalf = s->lead + s->nbytes * 16 + s->tail;
    const int64_t dur_ms = (int64_t)s->nhalf * s->half_us / 1000;
    if (dur_ms > 300000)
    {
        printf("{\"cmd\":\"blseq\",\"error\":\"sequence longer than 300 s\"}\n");
        return 1;
    }
    xp_awake((uint32_t)dur_ms + 15000);
    if (s->done == NULL)
    {
        s->done = xSemaphoreCreateBinary();
    }
    const esp_timer_create_args_t ta = {.callback = seq_cb, .arg = s, .name = "blseq"};
    if (esp_timer_create(&ta, &s->timer) != ESP_OK)
    {
        printf("{\"cmd\":\"blseq\",\"error\":\"timer\"}\n");
        return 1;
    }
    printf("{\"cmd\":\"blseq\",\"frame\":\"");
    xp_print_hexstr(s->bytes, (size_t)s->nbytes);
    printf("\",\"bit_ms\":%d,\"hi\":%d,\"lo\":%d,\"lead_half_bits\":%d,\"half_bits\":%d,\"expected_ms\":%lld,\"coding\":\"manchester_802.3_msb_first\"}\n",
           bit_ms, s->hi, s->lo, s->lead, s->nhalf, (long long)dur_ms);
    fflush(stdout);

    s_bl_override = true;
    vTaskDelay(2);   // let any in-flight stock brightness write go out first
    s->k = 0;
    s->t0 = esp_timer_get_time() + s->half_us;   // first periodic fire is one period after start
    esp_timer_start_periodic(s->timer, (uint64_t)s->half_us);
    const bool ok = xSemaphoreTake(s->done, pdMS_TO_TICKS(dur_ms + 5000)) == pdTRUE;
    const int64_t t_end = esp_timer_get_time();
    esp_timer_stop(s->timer);
    esp_timer_delete(s->timer);
    s->timer = NULL;
    bl_restore();
    printf("{\"cmd\":\"blseq\",\"done\":%s,\"sent_half_bits\":%d,\"elapsed_ms\":%lld,\"max_late_us\":%lld,\"send_fail\":%lu,\"restored\":true}\n",
           ok ? "true" : "false", s->k, (long long)((t_end - s->t0) / 1000), (long long)s->max_late_us,
           (unsigned long)s->send_fail);
    return ok ? 0 : 1;
}

// blpam <hexbytes> <sym_ms> [l0 l1 l2 l3]: PAM-4 backlight modem (2 bits/symbol, MSB first),
// idle at l0 for ~1 s, sync symbols 3,0,3,0, then data, then idle. Best on a black overlay page.
static int cmd_blpam(int argc, char **argv)
{
    if (argc < 3)
    {
        printf("{\"cmd\":\"blpam\",\"error\":\"usage: blpam <hexbytes> <sym_ms> [l0 l1 l2 l3]\"}\n");
        return 1;
    }
    BlSeq_t *s = &s_seq;
    SemaphoreHandle_t keep = s->done;
    memset(s, 0, sizeof(*s));
    s->done = keep;
    size_t n = 0;
    if (!xp_parse_hex_bytes(argv[1], s->bytes, 32, &n))
    {
        printf("{\"cmd\":\"blpam\",\"error\":\"bad hex (max 32 bytes)\"}\n");
        return 1;
    }
    s->nbytes = (int)n;
    s->pam = true;
    const int def[4] = {0, 4, 8, 15};
    for (int i = 0; i < 4; i++) s->L[i] = (argc >= 7) ? atoi(argv[3 + i]) : def[i];
    const int sym_ms = atoi(argv[2]);
    if (sym_ms < 4 || sym_ms > 5000)
    {
        printf("{\"cmd\":\"blpam\",\"error\":\"sym_ms 4..5000\"}\n");
        return 1;
    }
    s->half_us = (int64_t)sym_ms * 1000;          // one timer tick per symbol
    s->lead = (int)(1000000 / s->half_us) + 1;
    s->tail = s->lead;
    s->nhalf = s->lead + 4 + s->nbytes * 4 + s->tail;
    const int64_t dur_ms = (int64_t)s->nhalf * s->half_us / 1000;
    xp_awake((uint32_t)dur_ms + 15000);
    if (s->done == NULL) s->done = xSemaphoreCreateBinary();
    const esp_timer_create_args_t ta = {.callback = seq_cb, .arg = s, .name = "blpam"};
    if (esp_timer_create(&ta, &s->timer) != ESP_OK)
    {
        printf("{\"cmd\":\"blpam\",\"error\":\"timer\"}\n");
        return 1;
    }
    printf("{\"cmd\":\"blpam\",\"bytes\":%d,\"sym_ms\":%d,\"levels\":[%d,%d,%d,%d],\"lead\":%d,\"symbols\":%d,\"expected_ms\":%lld}\n",
           s->nbytes, sym_ms, s->L[0], s->L[1], s->L[2], s->L[3], s->lead, s->nhalf, (long long)dur_ms);
    fflush(stdout);
    s_bl_override = true;
    vTaskDelay(2);
    s->k = 0;
    s->t0 = esp_timer_get_time() + s->half_us;
    esp_timer_start_periodic(s->timer, (uint64_t)s->half_us);
    const bool ok = xSemaphoreTake(s->done, pdMS_TO_TICKS(dur_ms + 5000)) == pdTRUE;
    esp_timer_stop(s->timer);
    esp_timer_delete(s->timer);
    s->timer = NULL;
    bl_restore();
    printf("{\"cmd\":\"blpam\",\"done\":%s,\"sent\":%d,\"max_late_us\":%lld,\"send_fail\":%lu}\n", ok ? "true" : "false",
           s->k, (long long)s->max_late_us, (unsigned long)s->send_fail);
    return ok ? 0 : 1;
}

void xp_register_fpga_cmds(void)
{
    const esp_console_cmd_t pm = {.command = "blpam", .help = "xp2: blpam <hex> <sym_ms> [l0 l1 l2 l3] - PAM-4 backlight modem", .func = cmd_blpam};
    esp_console_cmd_register(&pm);
    const esp_console_cmd_t c = {.command = "msense", .help = "xp: msense <seconds> [max_lines=600] - every FPGA->MCU packet w/ ms timestamps", .func = cmd_msense};
    esp_console_cmd_register(&c);
    const esp_console_cmd_t d = {.command = "bl", .help = "xp: bl <0-15>|restore - raw backlight (no NVS)", .func = cmd_bl};
    esp_console_cmd_register(&d);
    const esp_console_cmd_t e = {.command = "blseq", .help = "xp: blseq <hexbytes> <bit_ms> <hi> <lo> - Manchester backlight modem (AA AA preamble)", .func = cmd_blseq};
    esp_console_cmd_register(&e);
    const esp_console_cmd_t a = {.command = "fpgasniff", .help = "xp: fpgasniff <seconds> [raw_n=16] - tap FPGA sysmon UART", .func = cmd_fpgasniff};
    esp_console_cmd_register(&a);
    const esp_console_cmd_t b = {.command = "fpgacmd", .help = "xp: fpgacmd <hex id 0-1F> <hex payload16> [listen_ms=300]", .func = cmd_fpgacmd};
    esp_console_cmd_register(&b);
}

void xp_bl_release(void) { bl_restore(); }
