#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "driver/uart.h"
#include "esp_console.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_vfs.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "gfx.h"
#include "board.h"
#include "brightness.h"
#include "color_correct_lcd.h"
#include "color_correct_usb.h"
#include "dpad_ctl.h"
#include "fpga_rx.h"
#include "fpga_tx.h"
#include "frameblend.h"
#include "fw.h"
#include "gbc_color_temp.h"
#include "osd.h"
#include "medic.h"
#include "xp.h"
#include "mbedtls/base64.h"
#include "osd_default.h"
#include "low_batt_icon_ctl.h"
#include "style.h"
#include "player_num.h"
#include "screen_transit_ctl.h"
#include "mutex.h"
#include "serial_num.h"
#include "settings.h"
#include "silent.h"
#include "pwrmgr.h"

enum {
    kLVGL_TickPeriod_us = 1000u, // 1 millisecond
};

enum {
    kFPGATxTask_StackDepth = 8*1024,   // [bytes]
    kFPGARxTask_StackDepth = 8*1024,   // [bytes]
    kSleepTask_StackDepth  = 4*1024,   // [bytes]
    kTimerTask_StackDepth  = 8*1024,   // [bytes]

    kFPGATxTask_Priority = configMAX_PRIORITIES - 10,
    kFPGARxTask_Priority = configMAX_PRIORITIES - 10,
    kSleepTask_Priority  = configMAX_PRIORITIES - 9,
};

static const char *TAG = "main";
static volatile uint8_t fpga_hsync = 0;

static void lvgl_tick(void *arg);

static void persist_storage_init(void);
static void example_lvgl_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *color_map);
static void lvglTimerTask(void* param);
static void send_lines(spi_device_handle_t spi, int ypos, uint16_t *linedata);

static spi_device_handle_t spi;
static lv_disp_draw_buf_t disp_buf; // contains internal graphic buffer(s) called draw buffer(s)
static lv_disp_drv_t disp_drv;      // contains callback functions
static lv_disp_t *disp;

// Having some issue with floating point here so scale 9.6 10x
#define ROWS_PER_XFER_X10 32
#define NUMTRANS 1440/ROWS_PER_XFER_X10
#define PIXELSPERXFER 16*ROWS_PER_XFER_X10
#define BYTESPERXFER PIXELSPERXFER*2

static void notify_lvgl_flush_ready(spi_transaction_t *pTransaction)
{
    static int rownum = 0;

    (void)(pTransaction);

    rownum = rownum + ROWS_PER_XFER_X10;
    if(rownum >= 1440)
    {
        rownum = 0;
        lv_disp_flush_ready(&disp_drv);
    }
}

static void example_lvgl_flush_cb(lv_disp_drv_t *drv, const lv_area_t *area, lv_color_t *color_map)
{
    // copy a buffer's content to a specific area of the display
    send_lines(spi, 0, drv->draw_buf->buf1);
}

static void lvgl_tick(void *arg)
{
    /* Tell LVGL how many milliseconds has elapsed */
    lv_tick_inc(kLVGL_TickPeriod_us);
}

static DMA_ATTR lv_color_t buffy[160*144];
static volatile bool _SnapReq = false, _SnapFrozen = false;

// mshot: dump the exact overlay framebuffer (RGB565, little endian) as base64 lines.
// Gives the host "eyes" on the overlay even when the UVC feed is blanked (LCD_EN low).
static int mshot_command(int argc, char **argv)
{
    (void)argc; (void)argv;
    PwrMgr_InhibitSleep(30000);
    _SnapReq = true;
    for (int i = 0; i < 100 && !_SnapFrozen; i++) { vTaskDelay(pdMS_TO_TICKS(10)); }
    const uint8_t *p = (const uint8_t *)buffy;
    const size_t total = sizeof(buffy);
    unsigned char line[80];
    size_t olen = 0;
    printf("MSHOT BEGIN 160 144 RGB565LE %u\n", (unsigned)total);
    for (size_t off = 0; off < total; off += 57)
    {
        const size_t n = (total - off) < 57 ? (total - off) : 57;
        if (mbedtls_base64_encode(line, sizeof(line), &olen, p + off, n) == 0)
        {
            line[olen] = 0;
            printf("%s\n", line);
        }
        if (((off / 57) % 16) == 15)
        {
            fflush(stdout);
            vTaskDelay(1);   // let IDLE run: a 5 s dump otherwise trips the task watchdog
        }
    }
    printf("MSHOT END frozen=%d\n", (int)_SnapFrozen);
    _SnapReq = false;
    return 0;
}

// ---------------------------------------------------------------------------------------------
// mgrid: driverless data export through the menu overlay -> FPGA -> UVC (stock FPGA).
// Freezes LVGL, paints 40x36 cells of 4x4 px into the overlay framebuffer and pushes it.
// Row 0 = calibration (colours 0,1,2,3 repeating). Rows 1..35 = 1400 cells x 2 bits = 350 bytes:
//   seq u16 LE | len u16 LE (=342) | payload[342] | crc32 LE (esp_rom_crc32_le(0, ...) over the first 346 bytes)
// payload = xorshift32 PRBS seeded with (seq * 2654435761u + 1) so the host can measure BER.
// Usage: mgrid <frames> <hold_ms>     (open the menu first: poke 100)
#include "esp_rom_crc.h"
static const uint16_t kGridColor[4] = { 0x0000, 0xFFFF, 0xF800, 0x001F };   // black, white, red, blue

static void grid_paint_blob(uint8_t *blob);
static void grid_paint(uint16_t seq)
{
    uint8_t blob[350];
    uint32_t x = seq * 2654435761u + 1u;
    blob[0] = seq & 0xFF; blob[1] = seq >> 8; blob[2] = 342 & 0xFF; blob[3] = 342 >> 8;
    for (int i = 0; i < 342; i++)
    {
        x ^= x << 13; x ^= x >> 17; x ^= x << 5;
        blob[4 + i] = (uint8_t)x;
    }
    grid_paint_blob(blob);
}

// paints a 350-byte blob (CRC is computed here over bytes 0..345 and stored at 346..349)
static void grid_paint_blob(uint8_t *blob)
{
    const uint32_t crc = esp_rom_crc32_le(0, blob, 346);
    memcpy(&blob[346], &crc, 4);
    uint16_t *fb = (uint16_t *)buffy;
    for (int cy = 0; cy < 36; cy++)
    {
        for (int cx = 0; cx < 40; cx++)
        {
            int sym;
            if (cy == 0)
            {
                sym = cx & 3;
            }
            else
            {
                const int cell = (cy - 1) * 40 + cx;           // 0..1399
                const int byte = cell >> 2, shift = 6 - 2 * (cell & 3);
                sym = (blob[byte] >> shift) & 3;
            }
            const uint16_t c = kGridColor[sym];
            for (int py = 0; py < 4; py++)
            {
                uint16_t *row = &fb[(cy * 4 + py) * 160 + cx * 4];
                row[0] = c; row[1] = c; row[2] = c; row[3] = c;
            }
        }
    }
}

static int mgrid_command(int argc, char **argv)
{
    const int frames = (argc >= 2) ? atoi(argv[1]) : 60;
    const int hold_ms = (argc >= 3) ? atoi(argv[2]) : 33;
    PwrMgr_InhibitSleep((uint32_t)(frames * (hold_ms + 20) + 30000));
    _SnapReq = true;
    for (int i = 0; i < 100 && !_SnapFrozen; i++) { vTaskDelay(1); }
    if (!_SnapFrozen) { printf("{\"cmd\":\"mgrid\",\"error\":\"lvgl did not freeze\"}\n"); _SnapReq = false; return 1; }
    const int64_t t0 = esp_timer_get_time();
    int timeouts = 0;
    for (int f = 0; f < frames; f++)
    {
        grid_paint((uint16_t)f);
        disp_drv.draw_buf->flushing = 1;
        send_lines(spi, 0, (uint16_t *)buffy);
        int w = 0;
        while (disp_drv.draw_buf->flushing && w < 20) { vTaskDelay(1); w++; }
        if (disp_drv.draw_buf->flushing) timeouts++;
        const int64_t next = t0 + (int64_t)(f + 1) * hold_ms * 1000;
        while (esp_timer_get_time() < next) { vTaskDelay(1); }
    }
    const int64_t us = esp_timer_get_time() - t0;
    printf("{\"cmd\":\"mgrid\",\"frames\":%d,\"hold_ms\":%d,\"us\":%lld,\"push_timeouts\":%d,\"bytes_per_frame\":342,\"Bps\":%.0f}\n",
           frames, hold_ms, (long long)us, timeouts, frames * 342.0 * 1e6 / (double)us);
    _SnapReq = false;
    return 0;
}

// mgridlog [hold_ms] [rounds]: export the hash-chained medic log (same text as `mlog`) through the
// overlay grid. Payload of each 350-byte blob: seq u16 | 342 u16 | 'L' | idx u16 | cnt u16 | dlen u16 | data[335] | crc32.
static int mgridlog_command(int argc, char **argv)
{
    const int hold_ms = (argc >= 2) ? atoi(argv[1]) : 33;
    const int rounds = (argc >= 3) ? atoi(argv[2]) : 3;
    const size_t cap = 24 * 1024;
    char *txt = malloc(cap);
    if (txt == NULL) { printf("{\"cmd\":\"mgridlog\",\"error\":\"no mem\"}\n"); return 1; }
    const int n = Medic_DumpLog(txt, cap);
    const int cnt = (n + 334) / 335;
    PwrMgr_InhibitSleep((uint32_t)(rounds * cnt * (hold_ms + 20) + 30000));
    _SnapReq = true;
    for (int i = 0; i < 100 && !_SnapFrozen; i++) { vTaskDelay(1); }
    if (!_SnapFrozen) { free(txt); _SnapReq = false; printf("{\"cmd\":\"mgridlog\",\"error\":\"no freeze\"}\n"); return 1; }
    uint8_t blob[350];
    uint16_t seq = 0;
    const int64_t t0 = esp_timer_get_time();
    for (int r = 0; r < rounds; r++)
    {
        for (int idx = 0; idx < cnt; idx++, seq++)
        {
            memset(blob, 0, sizeof(blob));
            const int off = idx * 335;
            const int dlen = (n - off) < 335 ? (n - off) : 335;
            blob[0] = seq & 0xFF; blob[1] = seq >> 8; blob[2] = 342 & 0xFF; blob[3] = 342 >> 8;
            blob[4] = 'L';
            blob[5] = idx & 0xFF; blob[6] = idx >> 8; blob[7] = cnt & 0xFF; blob[8] = cnt >> 8;
            blob[9] = dlen & 0xFF; blob[10] = dlen >> 8;
            memcpy(&blob[11], txt + off, dlen);
            grid_paint_blob(blob);
            disp_drv.draw_buf->flushing = 1;
            send_lines(spi, 0, (uint16_t *)buffy);
            int w = 0;
            while (disp_drv.draw_buf->flushing && w < 20) { vTaskDelay(1); w++; }
            const int64_t next = t0 + (int64_t)(seq + 1) * hold_ms * 1000;
            while (esp_timer_get_time() < next) { vTaskDelay(1); }
        }
    }
    printf("{\"cmd\":\"mgridlog\",\"log_bytes\":%d,\"chunks\":%d,\"rounds\":%d,\"ms\":%lld}\n", n, cnt, rounds,
           (long long)((esp_timer_get_time() - t0) / 1000));
    free(txt);
    _SnapReq = false;
    return 0;
}

// mqrs <frames> <hold_ms> <bytes>: animated QR stream painted by the ESP32 into the overlay (stock FPGA,
// no jailbreak). Frame i text = "%03d:" + base32(xorshift32 PRBS seeded i*2654435761+7, <bytes> bytes).
#include "src/extra/libs/qrcode/qrcodegen.h"
static void b32(const uint8_t *in, int n, char *out)
{
    static const char A[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    int bits = 0, val = 0, k = 0;
    for (int i = 0; i < n; i++)
    {
        val = (val << 8) | in[i]; bits += 8;
        while (bits >= 5) { out[k++] = A[(val >> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out[k++] = A[(val << (5 - bits)) & 31];
    out[k] = 0;
}

static int mqrs_command(int argc, char **argv)
{
    const int frames = (argc >= 2) ? atoi(argv[1]) : 20;
    const int hold_ms = (argc >= 3) ? atoi(argv[2]) : 200;
    int nbytes = (argc >= 4) ? atoi(argv[3]) : 40;
    if (nbytes < 1) nbytes = 1;
    if (nbytes > 120) nbytes = 120;
    static uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(15)], tmp[qrcodegen_BUFFER_LEN_FOR_VERSION(15)];
    char text[260];
    uint8_t data[120];
    PwrMgr_InhibitSleep((uint32_t)(frames * (hold_ms + 30) + 30000));
    _SnapReq = true;
    for (int i = 0; i < 100 && !_SnapFrozen; i++) { vTaskDelay(1); }
    if (!_SnapFrozen) { _SnapReq = false; printf("{\"cmd\":\"mqrs\",\"error\":\"no freeze\"}\n"); return 1; }
    int fails = 0, last_size = 0;
    const int64_t t0 = esp_timer_get_time();
    uint16_t *fb = (uint16_t *)buffy;
    for (int f = 0; f < frames; f++)
    {
        uint32_t x = (uint32_t)f * 2654435761u + 7u;
        for (int i = 0; i < nbytes; i++) { x ^= x << 13; x ^= x >> 17; x ^= x << 5; data[i] = (uint8_t)x; }
        snprintf(text, sizeof(text), "%03d:", f % 1000);
        b32(data, nbytes, text + 4);
        if (!qrcodegen_encodeText(text, tmp, qr, qrcodegen_Ecc_LOW, 1, 15, qrcodegen_Mask_AUTO, true)) { fails++; continue; }
        const int n = qrcodegen_getSize(qr);
        last_size = n;
        int s = 144 / (n + 4);
        if (s < 1) s = 1;
        const int w = n * s, ox = (160 - w) / 2, oy = (144 - w) / 2;
        for (int i = 0; i < 160 * 144; i++) fb[i] = 0xFFFF;
        for (int my = 0; my < n; my++)
            for (int mx = 0; mx < n; mx++)
                if (qrcodegen_getModule(qr, mx, my))
                    for (int py = 0; py < s; py++)
                        for (int px = 0; px < s; px++)
                            fb[(oy + my * s + py) * 160 + ox + mx * s + px] = 0x0000;
        disp_drv.draw_buf->flushing = 1;
        send_lines(spi, 0, (uint16_t *)buffy);
        int wt = 0;
        while (disp_drv.draw_buf->flushing && wt < 20) { vTaskDelay(1); wt++; }
        const int64_t next = t0 + (int64_t)(f + 1) * hold_ms * 1000;
        while (esp_timer_get_time() < next) { vTaskDelay(1); }
    }
    printf("{\"cmd\":\"mqrs\",\"frames\":%d,\"hold_ms\":%d,\"bytes\":%d,\"qr_modules\":%d,\"encode_fail\":%d,\"ms\":%lld}\n",
           frames, hold_ms, nbytes, last_size, fails, (long long)((esp_timer_get_time() - t0) / 1000));
    _SnapReq = false;
    return 0;
}

// ---------------------------------------------------------------------------------------------
// Host-supplied QR frames (stock FPGA, open the menu first). The payload is given as hex and drawn as
// base32 TEXT (A-Z2-7 = QR alphanumeric mode, ECC LOW, v1-15, same layout as mqrs), so OpenCV returns
// plain ASCII (byte-mode QR strings are not binary-safe through cv2's Python binding).
//   mqrt <hold_ms> <hex>        paint one QR, first waiting until the previous paint + hold_ms (host-
//                               streamed cadence stays exact); returns at once, LVGL stays frozen
//   mqrt end                    stop the player, unfreeze LVGL; prints {"shown":N}
//   mqrb <hold_ms> <hex> ...    the same for several blocks in one line (1024 chars, 30 args)
//   mqrq clear | <hex> ...      append blocks to the on-device queue (64 x 160 B); clear stops the player
//   mqrp <hold_ms> [rounds]     play the queue in a background task at exact cadence; rounds 0 = loop until
//                               `mqrt end`. The console RX buffer is only 256 B, so for 10 fps the host
//                               uploads with mqrq and plays with mqrp instead of streaming lines.
#include "esp_rom_sys.h"
#define QRH_MAXB 160
#define QRH_QCAP 64
static uint8_t (*s_qq)[QRH_MAXB] = NULL;   // heap (DRAM .bss is full): allocated by the first mqrq
static uint8_t s_qlen[QRH_QCAP];
static volatile int s_qn = 0, s_qr_shown = 0;
static volatile bool s_qplay = false, s_qstop = false;
static int s_qr_hold_ms = 100, s_qr_rounds = 0;
static int64_t s_qr_last_us = 0;

static int qrh_hex(const char *s, uint8_t *out, int max)
{
    int n = 0;
    for (; s[0] && s[1]; s += 2)
    {
        int v = 0;
        for (int k = 0; k < 2; k++)
        {
            const char c = s[k];
            const int d = (c >= '0' && c <= '9') ? c - '0' : (c >= 'a' && c <= 'f') ? c - 'a' + 10
                        : (c >= 'A' && c <= 'F') ? c - 'A' + 10 : -1;
            if (d < 0) return -1;
            v = (v << 4) | d;
        }
        if (n >= max) return -1;
        out[n++] = (uint8_t)v;
    }
    return (s[0] == 0 && n > 0) ? n : -1;
}

static bool qrh_freeze(void)
{
    _SnapReq = true;
    for (int i = 0; i < 100 && !_SnapFrozen; i++) { vTaskDelay(1); }
    return _SnapFrozen;
}

static void qrh_wait_slot(int hold_ms)
{
    const int64_t due = s_qr_last_us + (int64_t)hold_ms * 1000;
    while (due - esp_timer_get_time() > 12000) { vTaskDelay(1); }
    const int64_t rem = due - esp_timer_get_time();
    if (rem > 0) esp_rom_delay_us((uint32_t)rem);
    const int64_t now = esp_timer_get_time();
    s_qr_last_us = (now - due < 2000) ? due : now;    // on time: keep the grid; late: restart from now
}

// encode + paint + push; returns the QR size in modules, 0 on encode failure
static int qrh_paint(const uint8_t *data, int n)
{
    static uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(15)], tmp[qrcodegen_BUFFER_LEN_FOR_VERSION(15)];
    static char text[QRH_MAXB * 8 / 5 + 2];
    b32(data, n, text);
    if (!qrcodegen_encodeText(text, tmp, qr, qrcodegen_Ecc_LOW, 1, 15, qrcodegen_Mask_AUTO, true)) return 0;
    const int sz = qrcodegen_getSize(qr);
    int s = 144 / (sz + 4);
    if (s < 1) s = 1;
    const int w = sz * s, ox = (160 - w) / 2, oy = (144 - w) / 2;
    uint16_t *fb = (uint16_t *)buffy;
    for (int i = 0; i < 160 * 144; i++) fb[i] = 0xFFFF;
    for (int my = 0; my < sz; my++)
        for (int mx = 0; mx < sz; mx++)
            if (qrcodegen_getModule(qr, mx, my))
                for (int py = 0; py < s; py++)
                    for (int px = 0; px < s; px++)
                        fb[(oy + my * s + py) * 160 + ox + mx * s + px] = 0x0000;
    disp_drv.draw_buf->flushing = 1;
    send_lines(spi, 0, (uint16_t *)buffy);
    int wt = 0;
    while (disp_drv.draw_buf->flushing && wt < 20) { vTaskDelay(1); wt++; }
    s_qr_shown++;
    return sz;
}

static void qrh_player_task(void *arg)
{
    (void)arg;
    int i = 0, rounds = 0;
    while (!s_qstop)
    {
        const int n = s_qn;
        if (n == 0) { vTaskDelay(1); continue; }
        if (i >= n)
        {
            i = 0;
            rounds++;
            if (s_qr_rounds > 0 && rounds >= s_qr_rounds) break;
        }
        if (i == 0) PwrMgr_InhibitSleep((uint32_t)(n * (s_qr_hold_ms + 30) + 60000));
        qrh_wait_slot(s_qr_hold_ms);
        if (s_qstop) break;
        qrh_paint(s_qq[i], s_qlen[i]);
        i++;
    }
    s_qplay = false;
    vTaskDelete(NULL);
}

static void qrh_stop_player(void)
{
    if (s_qplay)
    {
        s_qstop = true;
        for (int i = 0; i < 300 && s_qplay; i++) { vTaskDelay(1); }
    }
    s_qstop = false;
}

static int mqrt_command(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "end") == 0)
    {
        qrh_stop_player();
        _SnapReq = false;
        printf("{\"cmd\":\"mqrt\",\"end\":true,\"shown\":%d}\n", s_qr_shown);
        return 0;
    }
    const bool burst = strcmp(argv[0], "mqrb") == 0;
    if (argc < 3)
    {
        printf("{\"cmd\":\"%s\",\"error\":\"usage: %s <hold_ms> <hex>%s | mqrt end\"}\n", argv[0], argv[0], burst ? " ..." : "");
        return 1;
    }
    const int hold_ms = atoi(argv[1]);
    const int nblk = burst ? argc - 2 : 1;
    qrh_stop_player();
    PwrMgr_InhibitSleep((uint32_t)(nblk * (hold_ms + 30) + 60000));
    if (!qrh_freeze()) { _SnapReq = false; printf("{\"cmd\":\"%s\",\"error\":\"no freeze\"}\n", argv[0]); return 1; }
    uint8_t data[QRH_MAXB];
    int shown = 0, bad = 0, sz = 0;
    for (int b = 0; b < nblk; b++)
    {
        const int n = qrh_hex(argv[2 + b], data, QRH_MAXB);
        if (n < 0) { bad++; continue; }
        qrh_wait_slot(hold_ms);
        const int r = qrh_paint(data, n);
        if (r) { sz = r; shown++; } else bad++;
    }
    printf("{\"cmd\":\"%s\",\"shown\":%d,\"bad\":%d,\"modules\":%d}\n", argv[0], shown, bad, sz);
    return bad ? 1 : 0;
}


// xp2: mqrsig <seconds> [hold_ms=500] - signed handoff. Alternates two QR frames on the overlay:
//   A = the Medic_BuildSummary text (byte mode, human readable on any phone)
//   B = "SIG:" + base32(DER ECDSA-P256 signature over A's exact bytes), alphanumeric mode
// A verifier with the enrolled public key (msign pub) checks B against A offline.
static int qr_paint_text(const char *text)
{
    static uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(15)], tmp[qrcodegen_BUFFER_LEN_FOR_VERSION(15)];
    if (!qrcodegen_encodeText(text, tmp, qr, qrcodegen_Ecc_LOW, 1, 15, qrcodegen_Mask_AUTO, true)) return 0;
    const int sz = qrcodegen_getSize(qr);
    int s = 144 / (sz + 4);
    if (s < 1) s = 1;
    const int w = sz * s, ox = (160 - w) / 2, oy = (144 - w) / 2;
    uint16_t *fb = (uint16_t *)buffy;
    for (int i = 0; i < 160 * 144; i++) fb[i] = 0xFFFF;
    for (int my = 0; my < sz; my++)
        for (int mx = 0; mx < sz; mx++)
            if (qrcodegen_getModule(qr, mx, my))
                for (int py = 0; py < s; py++)
                    for (int px = 0; px < s; px++)
                        fb[(oy + my * s + py) * 160 + ox + mx * s + px] = 0x0000;
    disp_drv.draw_buf->flushing = 1;
    send_lines(spi, 0, (uint16_t *)buffy);
    int wt = 0;
    while (disp_drv.draw_buf->flushing && wt < 20) { vTaskDelay(1); wt++; }
    return sz;
}

static int mqrsig_command(int argc, char **argv)
{
    const int sec = (argc >= 2) ? atoi(argv[1]) : 10;
    const int hold = (argc >= 3) ? atoi(argv[2]) : 500;
    static char sum[240], sigtxt[8 + 140];
    uint8_t der[80];
    const int n = Medic_BuildSummary(sum, sizeof sum);
    const size_t dl = XP_SignDer((const uint8_t *)sum, (size_t)n, der, sizeof der);
    if (n <= 0 || dl == 0) { printf("{\"cmd\":\"mqrsig\",\"error\":\"sign failed\"}\n"); return 1; }
    strcpy(sigtxt, "SIG:");
    b32(der, (int)dl, sigtxt + 4);
    PwrMgr_InhibitSleep((uint32_t)sec * 1000 + 30000);
    if (!qrh_freeze()) { _SnapReq = false; printf("{\"cmd\":\"mqrsig\",\"error\":\"no freeze\"}\n"); return 1; }
    int ma = 0, mb = 0, frames = 0;
    const int64_t t0 = esp_timer_get_time();
    while (esp_timer_get_time() - t0 < (int64_t)sec * 1000000)
    {
        if (frames % 2 == 0) ma = qr_paint_text(sum); else mb = qr_paint_text(sigtxt);
        frames++;
        const int64_t due = t0 + (int64_t)frames * hold * 1000;
        while (esp_timer_get_time() < due) vTaskDelay(1);
    }
    _SnapReq = false;
    printf("{\"cmd\":\"mqrsig\",\"summary\":\"%s\",\"sig_der_len\":%u,\"sig\":\"%s\",\"modules\":[%d,%d],\"frames\":%d}\n",
           sum, (unsigned)dl, sigtxt, ma, mb, frames);
    return 0;
}

static int mqrq_command(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "clear") == 0)
    {
        qrh_stop_player();
        s_qn = 0;
        printf("{\"cmd\":\"mqrq\",\"queued\":0}\n");
        return 0;
    }
    if (s_qq == NULL) s_qq = malloc(QRH_QCAP * QRH_MAXB);
    if (s_qq == NULL) { printf("{\"cmd\":\"mqrq\",\"error\":\"no mem\"}\n"); return 1; }
    int bad = 0;
    for (int a = 1; a < argc; a++)
    {
        const int idx = s_qn;
        if (idx >= QRH_QCAP) { bad++; continue; }
        const int n = qrh_hex(argv[a], s_qq[idx], QRH_MAXB);
        if (n < 0) { bad++; continue; }
        s_qlen[idx] = (uint8_t)n;
        s_qn = idx + 1;   // publish after the copy: the player may be running
    }
    printf("{\"cmd\":\"mqrq\",\"queued\":%d,\"bad\":%d,\"cap\":%d}\n", s_qn, bad, QRH_QCAP);
    return bad ? 1 : 0;
}

static int mqrp_command(int argc, char **argv)
{
    if (argc < 2) { printf("{\"cmd\":\"mqrp\",\"error\":\"usage: mqrp <hold_ms> [rounds=0 loop]\"}\n"); return 1; }
    if (s_qq == NULL || s_qn == 0) { printf("{\"cmd\":\"mqrp\",\"error\":\"queue empty (mqrq first)\"}\n"); return 1; }
    qrh_stop_player();
    s_qr_hold_ms = atoi(argv[1]);
    if (s_qr_hold_ms < 20) s_qr_hold_ms = 20;
    s_qr_rounds = (argc >= 3) ? atoi(argv[2]) : 0;
    if (!qrh_freeze()) { _SnapReq = false; printf("{\"cmd\":\"mqrp\",\"error\":\"no freeze\"}\n"); return 1; }
    s_qr_shown = 0;
    s_qr_last_us = esp_timer_get_time() - (int64_t)s_qr_hold_ms * 1000;   // first frame now
    s_qplay = true;
    if (xTaskCreatePinnedToCore(qrh_player_task, "mqrp", 4096, NULL, 3, NULL, 1) != pdPASS)
    {
        s_qplay = false;
        _SnapReq = false;
        printf("{\"cmd\":\"mqrp\",\"error\":\"task\"}\n");
        return 1;
    }
    printf("{\"cmd\":\"mqrp\",\"queued\":%d,\"hold_ms\":%d,\"rounds\":%d}\n", s_qn, s_qr_hold_ms, s_qr_rounds);
    return 0;
}

// mbaud <rate>: switch the console UART rate (the FPGA bridge follows the host's line coding).
// The host must change its own rate on the SAME open port (re-opening reboots the ESP32).
static int mbaud_command(int argc, char **argv)
{
    if (argc != 2) { printf("{\"cmd\":\"mbaud\",\"error\":\"usage: mbaud <rate>\"}\n"); return 1; }
    const uint32_t rate = (uint32_t)strtoul(argv[1], NULL, 10);
    printf("{\"cmd\":\"mbaud\",\"rate\":%lu,\"switching_in_ms\":200}\n", (unsigned long)rate);
    fflush(stdout);
    uart_wait_tx_done(CONFIG_ESP_CONSOLE_UART_NUM, pdMS_TO_TICKS(100));
    vTaskDelay(pdMS_TO_TICKS(200));
    uart_set_baudrate(CONFIG_ESP_CONSOLE_UART_NUM, rate);
    return 0;
}

static int mawake_command(int argc, char **argv)
{
    if (argc == 2)
    {
        PwrMgr_InhibitSleep((uint32_t)strtoul(argv[1], NULL, 10) * 1000u);
    }
    printf("{\"awake_ms\":%lld}\n", (long long)PwrMgr_InhibitRemaining_ms());
    return 0;
}

// Standalone (mboot on): open the overlay by itself so the vitals monitor is on screen at power-on.
// `poke 100` toggles the menu (stateless), so only toggle when the FPGA sysmon stream says it is closed.
static void menu_open_task(void *param)
{
    (void)param;
    vTaskDelay(pdMS_TO_TICKS(5000));
    for (int attempt = 0; attempt < 2 && !Medic_MenuOpen(); attempt++)
    {
        int ret = 0;
        (void)esp_console_run("poke 100", &ret);
        vTaskDelay(pdMS_TO_TICKS(1500));
    }
    printf("{\"cmd\":\"mboot\",\"ev\":\"overlay\",\"open\":%s}\n", Medic_MenuOpen() ? "true" : "false");
    vTaskDelete(NULL);
}

static void lvglTimerTask(void* param)
{
    while(1)
    {
        // The task running lv_timer_handler should have lower priority than that running `lv_tick_inc`
        lv_timer_handler();
        // mshot support: freeze rendering between complete frames so the dump is tear-free
        if (_SnapReq)
        {
            _SnapFrozen = true;
            while (_SnapReq) { vTaskDelay(1); }   // >=1 tick: pdMS_TO_TICKS(5)==0 at 100 Hz starves IDLE1
            _SnapFrozen = false;
        }
        vTaskDelay(pdMS_TO_TICKS(30));
    }
}


static void send_lines(spi_device_handle_t spi, int ypos, uint16_t *linedata)
{
    esp_err_t ret;

    int x;
    //Transaction descriptors. Declared static so they're not allocated on the stack; we need this memory even when this
    //function is finished because the SPI driver needs access to it even while we're already calculating the next line.
    static spi_transaction_t trans[NUMTRANS];

    //In theory, it's better to initialize trans and data only once and hang on to the initialized
    //variables. We allocate them on the stack, so we need to re-init them each call.
    for (x=0; x<NUMTRANS; x++) {
        memset(&trans[x], 0, sizeof(spi_transaction_t));
        trans[x].tx_buffer = &buffy[x*PIXELSPERXFER];//finally send the line datai
        trans[x].length = BYTESPERXFER * 8;  //Data length, in bits
        trans[x].flags = SPI_TRANS_MODE_QIO; //undo SPI_TRANS_USE_TXDATA flag
        trans[x].cmd = 0x400 | 1023;//write
        trans[x].addr = x*BYTESPERXFER;
    }

    //Queue all transactions.
    for (x=0; x<NUMTRANS; x++) {
        ret=spi_device_queue_trans(spi, &trans[x], portMAX_DELAY);
        assert(ret==ESP_OK);
    }

    return;
    //When we are here, the SPI driver is busy (in the background) getting the transactions sent. That happens
    //mostly using DMA, so the CPU doesn't have much to do here. We're not going to wait for the transaction to
    //finish because we may as well spend the time calculating the next line. When that is done, we can call
    //send_line_finish, which will wait for the transfers to be done and check their status.
}

static void register_update_callbacks(void)
{
    Brightness_RegisterOnUpdateCb(FPGA_Tx_WriteBrightness);
    PlayerNum_RegisterOnUpdateCb(FPGA_Tx_SendSysCtl);
    SilentMode_RegisterOnUpdateCb(FPGA_Tx_SendSysCtl);
    ColorCorrectLCD_RegisterOnUpdateCb(FPGA_Tx_SendSysCtl);
    ColorCorrectUSB_RegisterOnUpdateCb(FPGA_Tx_SendSysCtl);
    FrameBlend_RegisterOnUpdateCb(FPGA_Tx_SendSysCtl);
    ScreenTransitCtl_RegisterOnUpdateCb(FPGA_Tx_SendSysCtl);
    DPadCtl_RegisterOnUpdateCb(FPGA_Tx_SendSysCtl);
    LowBattIconCtl_RegisterOnUpdateCb(FPGA_Tx_SendSysCtl);
    Button_RegisterOnButtonPokeCb(FPGA_Tx_PokeButtons);
    Style_RegisterOnUpdateCb(FPGA_Tx_WritePaletteStyle);
    GBCColorTemp_RegisterOnUpdateCb(FPGA_Tx_WriteColorTemp);
}

static void persist_storage_init(void)
{
    Settings_Initialize();
    Firmware_Initialize();
    SerialNum_Initialize();
    Button_RegisterCommands();

    const fnSettingApply_t fnApplySetting[kNumSettingKeys] = {
        [kSettingKey_FrameBlend]       = FrameBlend_ApplySetting,
        [kSettingKey_ColorCorrectLCD]  = ColorCorrectLCD_ApplySetting,
        [kSettingKey_ColorCorrectUSB]  = ColorCorrectUSB_ApplySetting,
        [kSettingKey_PlayerNum]        = PlayerNum_ApplySetting,
        [kSettingKey_SilentMode]       = SilentMode_ApplySetting,
        [kSettingKey_Brightness]       = Brightness_ApplySetting,
        [kSettingKey_ScreenTransitCtl] = ScreenTransitCtl_ApplySetting,
        [kSettingKey_DPadCtl]          = DPadCtl_ApplySetting,
        [kSettingKey_LowBattIconCtl]   = LowBattIconCtl_ApplySetting,
        [kSettingKey_PaletteStyleID]   = Style_ApplySetting,
        [kSettingKey_GBCColorTemp]     = GBCColorTemp_ApplySetting,
    };

    OSD_Result_t eResult;
    for(SettingKey_t k = kSettingKey_FirstKey; k < kNumSettingKeys; k++)
    {
        SettingValue_t Value = {
            .eType = kSettingDataType_U32,
            .U32 = 0,
        };

        const char* pSettingName = Settings_KeyToName(k);

        // Set up the data type eType for each key
        if ((eResult = Settings_RetrieveDefault(k, &Value)) != kOSD_Result_Ok)
        {
            ESP_LOGE(TAG, "Failed to setup %s with its default, err = %d", pSettingName, eResult);
            continue;
        }

        if ((eResult = Settings_Retrieve(k, &Value.U32)) != kOSD_Result_Ok)
        {
            ESP_LOGE(TAG, "Failed to load setting %s, err = %d. Using default value.", pSettingName, eResult);

            // Create the entry if not existent, or store the default
            if ((eResult = Settings_Update(k, Value.U32)) != kOSD_Result_Ok)
            {
                ESP_LOGE(TAG, "Failed to update setting %s on init, err = %d.", pSettingName, eResult);
            }
        }
        else
        {
            ESP_LOGI(TAG, "Setting loaded, %s = %lu", pSettingName, Value.U32);
        }

        // Send over the setting to the module
        if (fnApplySetting[k] != NULL)
        {
            if ((eResult = fnApplySetting[k](&Value)) != kOSD_Result_Ok)
            {
                ESP_LOGE(TAG, "Failed to apply setting %s to %lu, err = %d.", pSettingName, Value.U32, eResult);
            }
        }
    }
}

static esp_console_repl_t *pRepl = NULL;
static esp_console_repl_config_t ReplConfig = ESP_CONSOLE_REPL_CONFIG_DEFAULT();
static esp_console_dev_uart_config_t ReplHWConfig = ESP_CONSOLE_DEV_UART_CONFIG_DEFAULT();

void app_main(void)
{
    persist_storage_init();
    Mutex_Init();

    // Set up the system management UART to/from the FPGA
    ESP_LOGI(TAG, "Initialize FPGA UART");
    const uart_config_t uart_config = {
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    uart_driver_install(UART_NUM_1, kFPGA_TxConsts_BufferSize, kFPGA_RxConsts_BufferSize, 0, NULL, 0);
    uart_param_config(UART_NUM_1, &uart_config);
    uart_set_pin(UART_NUM_1, PIN_NUM_UART_TO_FPGA, PIN_NUM_UART_FROM_FPGA, -1, -1);

    gpio_sleep_set_direction(PIN_NUM_UART_FROM_FPGA, GPIO_MODE_INPUT);
    gpio_sleep_set_pull_mode(PIN_NUM_UART_FROM_FPGA, GPIO_PULLUP_ONLY);

    // Task is created earlier than the others to apply the settings ASAP
    xTaskCreate(FPGA_TxTask, "fpga_tx_task", kFPGATxTask_StackDepth, NULL, kFPGATxTask_Priority, FPGA_GetTxTaskHandle());

    // Task is created early in order to recieve fast messages (e.g hotkey palette data)
    // These tasks are started in the "paused" state
    xTaskCreate(FPGA_RxTask, "fpga_rx_task", kFPGARxTask_StackDepth, NULL, kFPGARxTask_Priority, FPGA_GetRxTaskHandle());

    // Let the tasks run for a bit to transmit config data to the FPGA core
    const size_t kTransmitCfgCounts = 6;
    for(size_t i = 0; i < kTransmitCfgCounts; i++)
    {
        FPGA_Tx_SendAll();
        vTaskDelay( pdMS_TO_TICKS(10) );
    }

    ESP_LOGI(TAG, "Initialize SPI Master");

    spi_bus_config_t buscfg={
        .miso_io_num=PIN_NUM_QSPI_MISO,
        .mosi_io_num=PIN_NUM_QSPI_MOSI,
        .sclk_io_num=PIN_NUM_QSPI_CLK,
        .quadwp_io_num=PIN_NUM_QSPI_WP,
        .quadhd_io_num=PIN_NUM_QSPI_HD,
        .max_transfer_sz=(BYTESPERXFER*8)+46,
        .flags=SPICOMMON_BUSFLAG_QUAD | SPICOMMON_BUSFLAG_MASTER
    };
    spi_device_interface_config_t devcfg={
        .clock_speed_hz=40*1000*1000,           //Clock out at 40 MHz
        .mode=0,                                //SPI mode 0
        .spics_io_num=PIN_NUM_QSPI_CS,
        .queue_size=NUMTRANS,
        .pre_cb=NULL,
        .flags=SPI_DEVICE_HALFDUPLEX,
        .cs_ena_pretrans=3,
        .cs_ena_posttrans=3,
        .command_bits=11,
        .address_bits=32,
        .dummy_bits=3,
        .post_cb=notify_lvgl_flush_ready
    };

    //Initialize the SPI bus
    esp_err_t ret=spi_bus_initialize(VSPI_HOST, &buscfg, SPI_DMA_CH_AUTO);
    ESP_ERROR_CHECK(ret);
    ret=spi_bus_add_device(VSPI_HOST, &devcfg, &spi);
    ESP_ERROR_CHECK(ret);

    ESP_LOGI(TAG, "Initialize LVGL library");
    lv_init();
    // alloc draw buffers used by LVGL
    // it's recommended to choose the size of the draw buffer(s) to be at least 1/10 screen sized
    lv_color_t *buf1 = (lv_color_t*)&buffy;
    assert(buf1);
    lv_disp_draw_buf_init(&disp_buf, buf1, NULL, kOSD_NumPixels);

    ESP_LOGI(TAG, "Register display driver to LVGL");
    lv_disp_drv_init(&disp_drv);
    disp_drv.hor_res = kOSD_Width_px;
    disp_drv.ver_res = kOSD_Height_px;
    disp_drv.direct_mode = 1;
    disp_drv.full_refresh = 1;
    disp_drv.flush_cb = example_lvgl_flush_cb;
    disp_drv.draw_buf = &disp_buf;
    disp = lv_disp_drv_register(&disp_drv);

    //Configuration is completed.

    ESP_LOGI(TAG, "Install LVGL tick timer");
    // Tick interface for LVGL (using esp_timer to generate 2ms periodic event)
    const esp_timer_create_args_t lvgl_tick_timer_args = {
        .callback = &lvgl_tick,
        .name = "lvgl_tick"
    };
    esp_timer_handle_t lvgl_tick_timer = NULL;
    ESP_ERROR_CHECK(esp_timer_create(&lvgl_tick_timer_args, &lvgl_tick_timer));
    ESP_ERROR_CHECK(esp_timer_start_periodic(lvgl_tick_timer, kLVGL_TickPeriod_us));

    ESP_LOGI(TAG, "Display LVGL animation");
    lv_obj_t *scr = lv_disp_get_scr_act(disp);

    OSD_Initialize();
    OSD_Default_Init(scr);
    register_update_callbacks();

    Gfx_Start(scr);
    Medic_Init(scr);   // also registers medic console commands (same pattern as Button_RegisterCommands)
    {
        const esp_console_cmd_t shot = { .command = "mshot", .help = "dump overlay framebuffer (base64 RGB565LE)", .func = mshot_command };
        esp_console_cmd_register(&shot);
        const esp_console_cmd_t awake = { .command = "mawake", .help = "mawake [seconds] - inhibit light sleep", .func = mawake_command };
        esp_console_cmd_register(&awake);
        const esp_console_cmd_t grid = { .command = "mgrid", .help = "mgrid <frames> <hold_ms> - data grid export via overlay/UVC (open menu first)", .func = mgrid_command };
        esp_console_cmd_register(&grid);
        const esp_console_cmd_t baud = { .command = "mbaud", .help = "mbaud <rate> - change console baud (host must follow on the open port)", .func = mbaud_command };
        esp_console_cmd_register(&baud);
        const esp_console_cmd_t gridlog = { .command = "mgridlog", .help = "mgridlog [hold_ms] [rounds] - export medic log via overlay grid/UVC", .func = mgridlog_command };
        esp_console_cmd_register(&gridlog);
        const esp_console_cmd_t qrs = { .command = "mqrs", .help = "mqrs <frames> <hold_ms> <bytes> - animated QR via overlay", .func = mqrs_command };
        esp_console_cmd_register(&qrs);
        const esp_console_cmd_t qrt = { .command = "mqrt", .help = "mqrt <hold_ms> <hex> | mqrt end - show one host QR (base32 text), stays frozen", .func = mqrt_command };
        esp_console_cmd_register(&qrt);
        const esp_console_cmd_t qrb = { .command = "mqrb", .help = "mqrb <hold_ms> <hex> ... - paced burst of host QRs", .func = mqrt_command };
        esp_console_cmd_register(&qrb);
        const esp_console_cmd_t qrq = { .command = "mqrq", .help = "mqrq clear | <hex> ... - queue QR blocks (64 x 160 B)", .func = mqrq_command };
        esp_console_cmd_register(&qrq);
        const esp_console_cmd_t qsig = { .command = "mqrsig", .help = "mqrsig <sec> [hold_ms] - alternate summary QR + device signature QR", .func = mqrsig_command };
        esp_console_cmd_register(&qsig);
        const esp_console_cmd_t qrp = { .command = "mqrp", .help = "mqrp <hold_ms> [rounds=0 loop] - play QR queue in background", .func = mqrp_command };
        esp_console_cmd_register(&qrp);
    }
    {
        const XP_Hooks_t xp_hooks = { .fpga_send_raw = FPGA_Tx_SendRaw, .inhibit_sleep = PwrMgr_InhibitSleep,
                                       .backlight_restore = FPGA_Tx_WriteBrightness, .build_summary = Medic_BuildSummary,
                                       .dump_log = Medic_DumpLog, .note_vital = Medic_NoteVital,
                                       .auto_status = Medic_AutoStatus,
                                       .post_msg = Medic_PostMsg, .msg_ack_ms = Medic_MsgAckMs,
                                       .log_arrival = Medic_LogArrival };
        XP_Init(&xp_hooks);   // fw/xp experiment commands (see XP_README.md)
    }

    xTaskCreatePinnedToCore(lvglTimerTask, "lvgl Timer", kTimerTask_StackDepth, NULL, 4, NULL, 1);

    // Prompt to be printed before each line.
    ReplConfig.prompt = "mcu> ";
    ReplConfig.max_cmdline_length = 1024;
    ReplConfig.task_stack_size = 8192;   // XP: radio/scan commands run in the console task

    ReplHWConfig.rx_gpio_num = GPIO_NUM_35;
    ReplHWConfig.tx_gpio_num = GPIO_NUM_36;

    ESP_ERROR_CHECK(esp_console_new_repl_uart(&ReplHWConfig, &ReplConfig, &pRepl));
    esp_console_register_help_command();
    // All commands must be registered prior to starting the REPL
    ESP_ERROR_CHECK(esp_console_start_repl(pRepl));

    vTaskDelay( pdMS_TO_TICKS(2000) );
    xTaskCreate(PwrMgr_Task, "pwr_mgr_task", kSleepTask_StackDepth, NULL, kSleepTask_Priority, NULL);
    XP_BootAuto();
    if (XP_BootEnabled()) xTaskCreate(menu_open_task, "menu_open", 3072, NULL, 2, NULL);
}
