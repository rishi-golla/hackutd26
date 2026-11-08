// MEDIC: decode of FPGA sysmon packets that stock code discards (0x03 volume wheel / headphone / backlight,
// 0x05 PMIC, 0x07 temperature) and precise A-button edge timing from the 0x02 button stream.
//
// Timing model: while the menu is open the FPGA sends an addr 0x02 packet at a steady ~1315 Hz. The rx task
// reads UART1 in ~10 ms chunks, so the esp_timer time at which a packet is *processed* is jittery. Instead,
// every packet gets an index k inside its "segment" (a run with no gap > 50 ms), and its precise time is
// seg_anchor_us + k * period. The anchor's jitter is a constant offset inside a segment, so intervals between
// edges are accurate to about one packet period (0.76 ms). The period starts at 1e9/1315 ns and is
// re-estimated from the longest segment seen so far (>= 2000 packets).

#include "medic.h"
#include "medic_priv.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <inttypes.h>

#include "esp_console.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#define A_BIT 3                 // kButton_A in button.h (bit 3 of the 0x02 word)
#define SEG_GAP_US 50000        // a gap longer than this starts a new timing segment
#define DEBOUNCE_PKTS 3         // new level must hold for 3 packets (~2.3 ms) to count
#define NOMINAL_PERIOD_NS 760456u   // 1e9 / 1315 Hz (measured on this unit)
#define REC_MAX 128

typedef struct {
    int64_t us, raw_us;
    uint8_t pressed;
} RecEdge_t;

static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static MedicHw_t s_hw;
static QueueHandle_t s_pressQ;

// segment / debounce state (rx task only, read under s_mux)
static int64_t s_seg_us0, s_last02_us;
static uint32_t s_seg_k, s_seg_period_ns = NOMINAL_PERIOD_NS, s_best_k, s_segments;
static uint8_t s_a_stable, s_a_cnt, s_a_raw_prev;
static uint32_t s_a_cand_k;
static int64_t s_a_cand_raw_us;
static volatile int64_t s_last_raw_press_us = -1;

// tapsense recording (armed by the console task)
static RecEdge_t *volatile s_rec;
static volatile uint32_t s_rec_n, s_rec_lost;

static int64_t seg_time(uint32_t k) { return s_seg_us0 + ((int64_t)k * s_seg_period_ns) / 1000; }

static void emit_edge(uint8_t pressed, int64_t us, int64_t raw_us)
{
    if (pressed && s_pressQ != NULL) {
        const MedicEdge_t e = {.us = us, .raw_us = raw_us};
        (void)xQueueSend(s_pressQ, &e, 0);
    }
    portENTER_CRITICAL(&s_mux);
    RecEdge_t *r = s_rec;
    if (r != NULL) {
        if (s_rec_n < REC_MAX) {
            r[s_rec_n].us = us;
            r[s_rec_n].raw_us = raw_us;
            r[s_rec_n].pressed = pressed;
            s_rec_n++;
        } else {
            s_rec_lost++;
        }
    }
    portEXIT_CRITICAL(&s_mux);
}

static void on_buttons(uint16_t x, int64_t now)
{
    const uint8_t a = (uint8_t)((x >> A_BIT) & 1);
    portENTER_CRITICAL(&s_mux);
    const bool new_seg = (s_last02_us == 0) || (now - s_last02_us) > SEG_GAP_US;
    if (new_seg) {
        // close the previous segment: keep the period estimate from the longest one
        if (s_last02_us != 0 && s_seg_k >= 2000 && s_seg_k > s_best_k) {
            s_hw.period_ns = (uint32_t)(((s_last02_us - s_seg_us0) * 1000) / s_seg_k);
            s_best_k = s_seg_k;
        }
        s_seg_us0 = now;
        s_seg_k = 0;
        s_seg_period_ns = s_hw.period_ns ? s_hw.period_ns : NOMINAL_PERIOD_NS;
        s_segments++;
        s_a_stable = a;   // no edge at the start of a segment (menu just opened)
        s_a_cnt = 0;
    } else {
        s_seg_k++;
    }
    s_last02_us = now;
    s_hw.t02_us = now;
    s_hw.n02++;
    if (a && !s_a_raw_prev) s_last_raw_press_us = now;
    s_a_raw_prev = a;

    bool fire = false;
    uint8_t lvl = 0;
    int64_t us = 0, raw_us = 0;
    if (a != s_a_stable) {
        if (s_a_cnt == 0) { s_a_cand_k = s_seg_k; s_a_cand_raw_us = now; }
        if (++s_a_cnt >= DEBOUNCE_PKTS) {
            s_a_stable = a;
            s_a_cnt = 0;
            fire = true;
            lvl = a;
            us = seg_time(s_a_cand_k);
            raw_us = s_a_cand_raw_us;
        }
    } else {
        s_a_cnt = 0;
    }
    s_hw.a_down = s_a_stable;
    portEXIT_CRITICAL(&s_mux);
    if (fire) emit_edge(lvl, us, raw_us);
}

void Medic_NoteFpga(uint8_t addr, uint16_t x)
{
    const int64_t now = esp_timer_get_time();
    switch (addr) {
    case 0x02:
        on_buttons(x, now);
        break;
    case 0x03:
        portENTER_CRITICAL(&s_mux);
        s_hw.vol = (uint8_t)(127 - (x & 0x7F));
        s_hw.hp = (uint8_t)((x >> 7) & 1);
        s_hw.bl = (uint8_t)(x >> 8);
        s_hw.t03_us = now; s_hw.n03++; s_hw.valid03 = true;
        portEXIT_CRITICAL(&s_mux);
        break;
    case 0x05:
        portENTER_CRITICAL(&s_mux);
        s_hw.pmic = x; s_hw.t05_us = now; s_hw.n05++; s_hw.valid05 = true;
        portEXIT_CRITICAL(&s_mux);
        break;
    case 0x07:
        portENTER_CRITICAL(&s_mux);
        s_hw.temp_raw = x; s_hw.t07_us = now; s_hw.n07++; s_hw.valid07 = true;
        portEXIT_CRITICAL(&s_mux);
        break;
    default:
        break;
    }
}

void MedicHw_Get(MedicHw_t *out)
{
    portENTER_CRITICAL(&s_mux);
    *out = s_hw;
    portEXIT_CRITICAL(&s_mux);
}

bool MedicHw_PopPress(MedicEdge_t *e)
{
    return s_pressQ != NULL && xQueueReceive(s_pressQ, e, 0) == pdTRUE;
}

int64_t MedicHw_LastRawAPress_us(void)
{
    portENTER_CRITICAL(&s_mux);
    const int64_t t = s_last_raw_press_us;
    portEXIT_CRITICAL(&s_mux);
    return t;
}

void MedicHw_Init(void)
{
    if (s_pressQ == NULL) s_pressQ = xQueueCreate(16, sizeof(MedicEdge_t));
    portENTER_CRITICAL(&s_mux);
    if (s_hw.period_ns == 0) s_hw.period_ns = NOMINAL_PERIOD_NS;
    portEXIT_CRITICAL(&s_mux);
}

// ---------------------------------------------------------------- console
static int64_t age_ms(bool valid, int64_t t) { return valid ? (esp_timer_get_time() - t) / 1000 : -1; }

// mvol - latest decoded wheel / headphone / backlight / PMIC / temperature from the FPGA stream
static int cmd_mvol(int argc, char **argv)
{
    (void)argc; (void)argv;
    MedicHw_t h;
    MedicHw_Get(&h);
    printf("{\"cmd\":\"mvol\",\"vol\":%u,\"hp\":%u,\"bl\":%u,\"vol_age_ms\":%" PRId64 ",\"pmic\":\"%04x\",\"chg\":%d,"
           "\"pmic_age_ms\":%" PRId64 ",\"temp_raw\":%u,\"temp_age_ms\":%" PRId64 ",\"a_down\":%d,\"n02\":%" PRIu32
           ",\"n03\":%" PRIu32 ",\"n05\":%" PRIu32 ",\"n07\":%" PRIu32 ",\"period_us\":%.2f,\"note\":\"%s\"}\n",
           h.vol, h.hp, h.bl, age_ms(h.valid03, h.t03_us), h.pmic, ((h.pmic >> 4) & 3) == 2, age_ms(h.valid05, h.t05_us),
           h.temp_raw, age_ms(h.valid07, h.t07_us), h.a_down, h.n02, h.n03, h.n05, h.n07, h.period_ns / 1000.0,
           h.valid03 ? "ok" : "no 0x03 yet: open the menu (poke 100)");
    return 0;
}

// tapsense <seconds> - precise press/release edges of A from the 0x02 stream, inter-press intervals
static int cmd_tapsense(int argc, char **argv)
{
    int sec = (argc >= 2) ? atoi(argv[1]) : 10;
    if (sec < 1) sec = 1;
    if (sec > 120) sec = 120;
    RecEdge_t *buf = calloc(REC_MAX, sizeof(RecEdge_t));
    if (buf == NULL) {
        printf("{\"cmd\":\"tapsense\",\"error\":\"no mem\"}\n");
        return 1;
    }
    MedicHw_t h0, h1;
    MedicHw_Get(&h0);
    uint32_t seg0;
    portENTER_CRITICAL(&s_mux);
    seg0 = s_segments;
    s_rec_n = 0;
    s_rec_lost = 0;
    s_rec = buf;
    portEXIT_CRITICAL(&s_mux);
    printf("{\"cmd\":\"tapsense\",\"sec\":%d,\"note\":\"press A now; needs the menu open (0x02 stream)\"}\n", sec);
    fflush(stdout);
    const int64_t t0 = esp_timer_get_time();
    const int64_t end = t0 + (int64_t)sec * 1000000;
    while (esp_timer_get_time() < end) vTaskDelay(pdMS_TO_TICKS(50));
    uint32_t n, lost, seg1;
    portENTER_CRITICAL(&s_mux);
    s_rec = NULL;
    n = s_rec_n;
    lost = s_rec_lost;
    seg1 = s_segments;
    portEXIT_CRITICAL(&s_mux);
    MedicHw_Get(&h1);
    const uint32_t pk = h1.n02 - h0.n02;
    const double win_s = (esp_timer_get_time() - t0) / 1e6;

    int presses = 0;
    for (uint32_t i = 0; i < n; i++) presses += buf[i].pressed;
    printf("{\"cmd\":\"tapsense\",\"edges\":%" PRIu32 ",\"presses\":%d,\"lost\":%" PRIu32 ",\"pkt02\":%" PRIu32 ",\"pkt02_hz\":%.1f,"
           "\"period_us\":%.2f,\"new_segments\":%" PRIu32 ",\"debounce_pkts\":%d}\n",
           n, presses, lost, pk, win_s > 0 ? pk / win_s : 0.0, h1.period_ns / 1000.0, seg1 - seg0, DEBOUNCE_PKTS);
    if (pk == 0) printf("{\"cmd\":\"tapsense\",\"warning\":\"no 0x02 packets: open the menu (poke 100) and retry\"}\n");

    int64_t first = -1, prev = -1, prev_raw = -1;
    double sum = 0, sum2 = 0, sum_raw = 0;
    int nint = 0, k = 0, printed = 0;
    for (uint32_t i = 0; i < n; i++) {
        if (!buf[i].pressed) continue;
        double hold = -1;
        for (uint32_t j = i + 1; j < n; j++) {
            if (!buf[j].pressed) { hold = (buf[j].us - buf[i].us) / 1000.0; break; }
        }
        if (first < 0) first = buf[i].us;
        double ipi = -1, ipi_raw = -1;
        if (prev >= 0) {
            ipi = (buf[i].us - prev) / 1000.0;
            ipi_raw = (buf[i].raw_us - prev_raw) / 1000.0;
            sum += ipi; sum2 += ipi * ipi; sum_raw += ipi_raw; nint++;
        }
        if (printed < 48) {
            printf("{\"cmd\":\"tapsense\",\"i\":%d,\"t_ms\":%.1f,\"hold_ms\":%.1f,\"ipi_ms\":%.1f,\"ipi_raw_ms\":%.1f}\n",
                   k, (buf[i].us - first) / 1000.0, hold, ipi, ipi_raw);
            printed++;
            if ((printed & 7) == 0) vTaskDelay(1);
        }
        prev = buf[i].us;
        prev_raw = buf[i].raw_us;
        k++;
    }
    if (nint > 0) {
        const double mean = sum / nint;
        const double var = sum2 / nint - mean * mean;
        printf("{\"cmd\":\"tapsense\",\"intervals\":%d,\"ipi_mean_ms\":%.2f,\"ipi_sd_ms\":%.2f,\"rate_per_min\":%.1f,"
               "\"rate_raw_per_min\":%.1f,\"lines_truncated\":%d}\n",
               nint, mean, var > 0 ? sqrt(var) : 0.0, mean > 0 ? 60000.0 / mean : 0.0,
               sum_raw > 0 ? 60000.0 * nint / sum_raw : 0.0, k > printed ? k - printed : 0);
    } else {
        printf("{\"cmd\":\"tapsense\",\"intervals\":0}\n");
    }
    free(buf);
    return 0;
}

void MedicHw_RegisterCmds(void)
{
    const esp_console_cmd_t c1 = {.command = "tapsense", .help = "tapsense <seconds> - precise A press/release edges from the FPGA 0x02 stream", .func = cmd_tapsense};
    const esp_console_cmd_t c2 = {.command = "mvol", .help = "mvol - volume wheel / headphone / backlight / PMIC / temp decoded from FPGA", .func = cmd_mvol};
    esp_console_cmd_register(&c1);
    esp_console_cmd_register(&c2);
}
