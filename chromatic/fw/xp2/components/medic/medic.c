// MEDIC mode — research prototype for EMS workflows on the ModRetro Chromatic.
// NOT a medical device. Dose figures are standard PALS weight-based values used
// for a feasibility demo only and must be checked against local protocol.
//
// xp2 changes (research/redteam.md): concentration shown with epi, units on every dose, every label width-
// checked against montserrat_14 (<=156 px) and LONG_DOT as a visible fallback, dose-page "A" logs micrograms
// and counts as an epi, alarms evaluated in Medic_Tick on every page (banner), rounded rate with a 20 s stale
// reset and >=3 taps, precise A timing from the FPGA stream on the RATE page, volume-wheel weight dial,
// one recursive lock around all shared state, clamped summary builder, JumpSTART note, messages stay until
// acked, ring-overflow chain base, NVS persistence of the chain head + last 16 events, render-on-change.

#include "medic.h"
#include "medic_priv.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <inttypes.h>

#include "button.h"
#include "esp_console.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "mbedtls/sha256.h"
#include "nvs.h"

// ---------------------------------------------------------------- config
#define W 160
#define H 144
#define LBL_W 156        // every 14 px label: x=2, width 156 (widths verified with the font tables)
#define MAX_EVENTS 160
#define MSG_LEN 96
#define CYCLE_S 120      // CPR cycle / rhythm check interval
#define EPI_DUE_S 240    // epi q3-5 min: flag at 4 min
#define MSG_ACK_HIDE_MS 3000
#define RATE_STALE_US 20000000LL   // 20 s: allows RR down to 3/min
#define RATE_MIN_TAPS 3
#define TOAST_MS 2500

typedef enum {
    EV_BOOT = 0, EV_CODE_START, EV_EPI, EV_SHOCK, EV_RHYTHM, EV_ROSC, EV_AMIO,
    EV_DOSE_EPI, EV_RATE, EV_TRIAGE, EV_MSG_RX, EV_MSG_ACK, EV_TIME_SYNC, EV_NOTE,
    EV_ALARM, EV_PREV_HEAD, EV_VITAL, EV_ARRIVED, EV_COUNT
} EvType_t;

static const char *kEvName[EV_COUNT] = {
    "BOOT", "CODE_START", "EPI", "SHOCK", "RHYTHM_CHECK", "ROSC", "AMIO",
    "EPI_DOSE_UG", "RATE", "TRIAGE", "MSG_RX", "MSG_ACK", "TIME_SYNC", "NOTE",
    "ALARM", "PREV_HEAD", "VITAL", "ARRIVED"
};

typedef struct {
    uint32_t t_ms;
    uint8_t type;
    int32_t arg;
    uint8_t tag[8];     // first 8 bytes of the chained hash after this event
} Event_t;

enum { PG_CODE, PG_DOSE, PG_RATE, PG_TRIAGE, PG_HANDOFF, PG_SYS, PG_COUNT };
static const char *kPageName[PG_COUNT] = {"CODE", "PEDS DOSE", "RATE", "TRIAGE", "HANDOFF", "SYSTEM"};

typedef enum { TRI_NONE = 0, TRI_GREEN, TRI_YELLOW, TRI_RED, TRI_BLACK } Tri_t;
static const char *kTriName[] = {"-", "GREEN", "YELLOW", "RED", "BLACK"};
static const uint32_t kTriColor[] = {0x202020, 0x00A040, 0xE0C000, 0xD01010, 0x000000};

// START triage question steps (adult START; JumpSTART note shown for children)
enum { TQ_WALK, TQ_BREATH, TQ_REPOS, TQ_RR30, TQ_PERF, TQ_MENTAL, TQ_DONE };
static const char *kTriQ[] = {
    "Can walk?", "Breathing?", "Breathing after\nairway repositioned?",
    "Resp rate > 30?", "Cap refill > 2s\nor no radial pulse?", "Follows simple\ncommands?", ""
};

enum { AL_EPI = 1, AL_CYCLE = 2 };

// ---------------------------------------------------------------- state (all guarded by _Lock)
static SemaphoreHandle_t _Lock;   // recursive: Tick holds it around input + render, log_event nests
static QueueHandle_t _BtnQ;
static volatile bool _Active = true;
static int _Page = PG_CODE;

static Event_t _Ev[MAX_EVENTS];
static int _NumEv;
static uint32_t _Dropped;
static uint8_t _Chain[32];
static uint8_t _ChainBase[32];   // chain value before _Ev[0] (zeros until the ring overflows)

static int64_t _CodeStart_ms = -1, _LastEpi_ms = -1, _LastCycle_ms = -1;
static int _NumEpi, _NumShock, _NumAmio;
static bool _Rosc;
static int _AlarmLatched;  // bitmask of alarms already logged this interval
static int _AlarmNow;      // bitmask of alarms currently due (evaluated every tick, any page)

static int _WeightKg = 20;
static bool _DialOn, _DialRefValid;
static int _DialRef, _DialLastVol;
static int64_t _DoseToastUntil_ms = -1;
static int _DoseToastUg;

static int64_t _Taps[9];   // esp_timer us
static int _NumTaps;
static bool _RateIsHR;
static int _BleHr; static int64_t _BleHr_ms = -1;
static int _BleSpo2; static int64_t _BleSpo2_ms = -1;   // xp2: BLE pulse oximeter (PLX)   // xp2: live HR from a BLE Heart Rate sensor (blehr)
// VITALS mode (default): the overlay is only the live vitals monitor (vitals.c); the six EMS pages stay compiled
// but unreachable. Sensor link / contact / session stats for it:
#define VITALS_MODE 1
static int _Link; static int64_t _Link_ms;
static int _Contact = -1; static int64_t _Pkt_ms = -1;
static int64_t _Sess_ms;
static int _SessN, _SessHrMin = -1, _SessHrMax = -1, _SessSpMin = -1;
static bool _TapPrecise;   // last tap came from the FPGA edge stream
static int64_t _RateToastUntil_ms = -1;
static int64_t _IgnoreEdgesUntil_us = -1;   // the A press that acked a message must not also become a tap
static int _RateToastVal;

static int _TriStep = TQ_WALK;
static Tri_t _TriResult = TRI_NONE;
static int _TriPatient = 1;
static int _TriCount[5];

static char _Msg[MSG_LEN];
static int64_t _MsgAt_ms = -1;
static bool _MsgAcked = true;
static int64_t _MsgAckAt_ms = -1;

static volatile float _BattV = 0;
static volatile int _BattKind = -1;
static uint32_t _UnixAnchor;     // host-provided unix time
static uint32_t _UnixAnchorMs;   // device ms at anchor

#define LOCK() xSemaphoreTakeRecursive(_Lock, portMAX_DELAY)
#define UNLOCK() xSemaphoreGiveRecursive(_Lock)

// ---------------------------------------------------------------- UI objects
static lv_obj_t *_Root, *_Title, *_Big, *_Side1, *_Side2, *_R[5], *_Hint, *_Banner, *_AlarmBar, *_Qr;
static lv_style_t _StText;

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

// ---------------------------------------------------------------- NVS persistence (namespace "medic")
// Every host port-open reboots the ESP32, so keep a boot counter, the last 16 events and the chain head
// across resets. Writes: one u32 per boot, one blob per logged event (never for BOOT / PREV_HEAD).
#define PERSIST_N 16
typedef struct __attribute__((packed)) {
    uint32_t boot;
    uint32_t t_ms;
    int32_t arg;
    uint8_t type;
} PEvent_t;
typedef struct __attribute__((packed)) {
    uint8_t ver, head, count, rsvd;
    PEvent_t e[PERSIST_N];
} PLogV1_t;
typedef struct __attribute__((packed)) {
    uint8_t ver, head, count, rsvd;
    PEvent_t e[PERSIST_N];
    uint8_t chain[32];      // _Chain right after the newest persisted event
    uint32_t chain_boot;    // boot that produced it
    uint32_t chain_nev;     // events in that boot's chain at that point (incl. dropped)
} PLog_t;
static uint32_t _BootCount;
static PLog_t _PLog;
static bool _PLogOk;
static uint8_t _PrevHead[32];       // chain head persisted by an earlier boot (loaded at init)
static uint32_t _PrevHeadBoot, _PrevHeadNev;
static bool _PrevHeadValid;

static void persist_init(void)
{
    nvs_handle_t h;
    if (nvs_open("medic", NVS_READWRITE, &h) != ESP_OK) return;
    uint32_t b = 0;
    (void)nvs_get_u32(h, "boot", &b);
    _BootCount = b + 1;
    (void)nvs_set_u32(h, "boot", _BootCount);
    size_t sz = sizeof(_PLog);
    memset(&_PLog, 0, sizeof(_PLog));
    const esp_err_t err = nvs_get_blob(h, "ev", &_PLog, &sz);
    if (err == ESP_OK && sz == sizeof(PLogV1_t) && _PLog.ver == 1) {
        memset(_PLog.chain, 0, sizeof(_PLog.chain));   // migrate v1 (no chain head) -> v2
        _PLog.chain_boot = _PLog.chain_nev = 0;
        _PLog.ver = 2;
    } else if (err != ESP_OK || sz != sizeof(_PLog) || _PLog.ver != 2) {
        memset(&_PLog, 0, sizeof(_PLog));
        _PLog.ver = 2;
    }
    static const uint8_t zero[32] = {0};
    if (memcmp(_PLog.chain, zero, 32) != 0) {
        memcpy(_PrevHead, _PLog.chain, 32);
        _PrevHeadBoot = _PLog.chain_boot;
        _PrevHeadNev = _PLog.chain_nev;
        _PrevHeadValid = true;
    }
    (void)nvs_commit(h);
    nvs_close(h);
    _PLogOk = true;
}

static void persist_event(uint32_t t_ms, uint8_t type, int32_t arg)
{
    if (!_PLogOk) return;
    PEvent_t *e = &_PLog.e[_PLog.head];
    e->boot = _BootCount; e->t_ms = t_ms; e->arg = arg; e->type = type;
    _PLog.head = (uint8_t)((_PLog.head + 1) % PERSIST_N);
    if (_PLog.count < PERSIST_N) _PLog.count++;
    memcpy(_PLog.chain, _Chain, 32);
    _PLog.chain_boot = _BootCount;
    _PLog.chain_nev = (uint32_t)_NumEv + _Dropped;
    nvs_handle_t h;
    if (nvs_open("medic", NVS_READWRITE, &h) != ESP_OK) return;
    (void)nvs_set_blob(h, "ev", &_PLog, sizeof(_PLog));
    (void)nvs_commit(h);
    nvs_close(h);
}

// ---------------------------------------------------------------- event log
static void chain_step(uint8_t out[32], const uint8_t prev[32], uint32_t t_ms, uint8_t type, int32_t arg)
{
    uint8_t buf[32 + 9];
    memcpy(buf, prev, 32);
    memcpy(buf + 32, &t_ms, 4);
    buf[36] = type;
    memcpy(buf + 37, &arg, 4);
    mbedtls_sha256(buf, sizeof(buf), out, 0);
}

static void log_event(EvType_t t, int32_t arg)
{
    LOCK();
    Event_t e = { .t_ms = (uint32_t)now_ms(), .type = (uint8_t)t, .arg = arg };
    chain_step(_Chain, _Chain, e.t_ms, e.type, e.arg);
    memcpy(e.tag, _Chain, 8);
    if (_NumEv < MAX_EVENTS) {
        _Ev[_NumEv++] = e;
    } else {
        // the oldest event leaves the ring: advance the base so the retained events still verify
        chain_step(_ChainBase, _ChainBase, _Ev[0].t_ms, _Ev[0].type, _Ev[0].arg);
        memmove(&_Ev[0], &_Ev[1], sizeof(Event_t) * (MAX_EVENTS - 1));
        _Ev[MAX_EVENTS - 1] = e;
        _Dropped++;
    }
    if (t != EV_BOOT && t != EV_PREV_HEAD) persist_event(e.t_ms, e.type, e.arg);
    UNLOCK();
}

// ---------------------------------------------------------------- dosing (PALS, demo only)
static const char *broselow(int kg, uint32_t *color)
{
    struct { int maxkg; const char *n; uint32_t c; } b[] = {
        {5, "GREY", 0x909090}, {7, "PINK", 0xF080B0}, {9, "RED", 0xE02020},
        {11, "PURPLE", 0x8030C0}, {14, "YELLOW", 0xF0D000}, {18, "WHITE", 0xF0F0F0},
        {23, "BLUE", 0x2060E0}, {29, "ORANGE", 0xF08000}, {36, "GREEN", 0x20A040},
    };
    for (size_t i = 0; i < sizeof(b) / sizeof(b[0]); i++) {
        if (kg <= b[i].maxkg) { *color = b[i].c; return b[i].n; }
    }
    *color = 0x404040;
    return "ADULT?";
}

// black text on light backgrounds (approx. relative luminance > ~0.3), white otherwise
static uint32_t pick_fg(uint32_t bg)
{
    const uint32_t r = (bg >> 16) & 0xFF, g = (bg >> 8) & 0xFF, b = bg & 0xFF;
    const uint32_t y = (r * 54 + g * 183 + b * 19) >> 8;   // Rec.709 luma, 0..255
    return y > 115 ? 0x000000 : 0xFFFFFF;
}

static float minf(float a, float b) { return a < b ? a : b; }
static int epi_ug(int kg) { int u = 10 * kg; return u > 1000 ? 1000 : u; }   // 0.01 mg/kg, max 1 mg

static int dial_to_kg(int vol)
{
    if (vol < 1) vol = 1;
    if (vol > 107) vol = 107;
    return 3 + ((vol - 1) * 37 + 53) / 106;   // 1..107 -> 3..40 kg, rounded
}

// ---------------------------------------------------------------- rate
static int rate_per_min(int *n_out)
{
    *n_out = _NumTaps;
    if (_NumTaps < RATE_MIN_TAPS) return 0;
    const int64_t span = _Taps[_NumTaps - 1] - _Taps[0];
    if (span <= 0) return 0;
    return (int)(((int64_t)(_NumTaps - 1) * 60000000LL + span / 2) / span);
}

static void add_tap(int64_t us, bool precise)
{
    if (_NumTaps > 0 && (us - _Taps[_NumTaps - 1]) > RATE_STALE_US) _NumTaps = 0;   // stale -> restart
    if (_NumTaps > 0 && us <= _Taps[_NumTaps - 1]) return;                         // out of order
    if (_NumTaps == 9) { memmove(_Taps, _Taps + 1, sizeof(_Taps[0]) * 8); _NumTaps = 8; }
    _Taps[_NumTaps++] = us;
    _TapPrecise = precise;
}

// ---------------------------------------------------------------- summary (QR + console)
#define APPEND(...) do {                                              \
        if (n < (int)cap - 1) {                                       \
            int _k = snprintf(out + n, cap - n, __VA_ARGS__);         \
            if (_k > 0) { n += _k; }                                  \
            if (n > (int)cap - 1) { n = (int)cap - 1; }               \
        }                                                             \
    } while (0)
static int build_summary(char *out, size_t cap)   // caller holds _Lock
{
    if (out == NULL || cap == 0) return 0;
    out[0] = 0;
    int64_t t = now_ms();
    int n = 0;
    APPEND("CMX1|up=%" PRId64 "s", t / 1000);
    if (_UnixAnchor) APPEND("|unix=%" PRIu32, _UnixAnchor + (uint32_t)((t - _UnixAnchorMs) / 1000));
    if (_CodeStart_ms >= 0) {
        APPEND("|code=%" PRId64 "s|epi=%d|shk=%d|amio=%d|rosc=%d",
               (t - _CodeStart_ms) / 1000, _NumEpi, _NumShock, _NumAmio, _Rosc);
    }
    APPEND("|wt=%dkg", _WeightKg);
    int rn; int r = rate_per_min(&rn);
    if (r) APPEND("|%s=%d", _RateIsHR ? "hr" : "rr", r);
    if (_BleHr_ms >= 0) APPEND("|bhr=%d@%" PRId64 "s", _BleHr, (t - _BleHr_ms) / 1000);
    if (_BleSpo2_ms >= 0) APPEND("|spo2=%d@%" PRId64 "s", _BleSpo2, (t - _BleSpo2_ms) / 1000);
    APPEND("|tri=G%dY%dR%dB%d", _TriCount[TRI_GREEN], _TriCount[TRI_YELLOW], _TriCount[TRI_RED], _TriCount[TRI_BLACK]);
    APPEND("|ev=%d|h=", _NumEv + (int)_Dropped);
    for (int i = 0; i < 8; i++) APPEND("%02x", _Chain[i]);
    return n;
}

// xp2: a vital sign from an external sensor (kind 1 = HR bpm). log=true appends a VITAL event, arg = kind*1000+value.
void Medic_NoteVital(int kind, int value, bool log)
{
    if (_Lock == NULL) return;
    LOCK();
    const int64_t t = now_ms();
    if (kind == 1 && value > 0) {
        _BleHr = value; _BleHr_ms = t; _Pkt_ms = t;
        _SessN++;
        if (_SessHrMin < 0 || value < _SessHrMin) _SessHrMin = value;
        if (value > _SessHrMax) _SessHrMax = value;
    }
    if (kind == 2 && value > 0) {
        _BleSpo2 = value; _BleSpo2_ms = t;
        if (_SessSpMin < 0 || value < _SessSpMin) _SessSpMin = value;
    }
    if (kind == 10 && value != _Link) { _Link = value; _Link_ms = t; }   // link: 0 none, 1 connected, 2 subscribed
    if (kind == 11) { _Contact = value; _Pkt_ms = t; }                     // contact, sent with every HR packet
    if (log) log_event(EV_VITAL, kind * 1000 + value);
    UNLOCK();
}

void Medic_VitalsGet(MedicVitals_t *v)
{
    LOCK();
    v->now_ms = now_ms();
    v->link = _Link; v->link_ms = _Link_ms;
    v->contact = _Contact; v->pkt_ms = _Pkt_ms;
    v->hr = _BleHr; v->hr_ms = _BleHr_ms;
    v->spo2 = _BleSpo2; v->spo2_ms = _BleSpo2_ms;
    v->sess_ms = _Sess_ms;
    v->n = _SessN; v->hr_min = _SessHrMin; v->hr_max = _SessHrMax; v->spo2_min = _SessSpMin;
    memcpy(v->head, _Chain, 4);
    UNLOCK();
}

void Medic_VitalsReset(void)
{
    LOCK();
    _Sess_ms = now_ms();
    _SessN = 0; _SessHrMin = _SessHrMax = _SessSpMin = -1;
    log_event(EV_NOTE, 1);   // session reset marker in the chain
    UNLOCK();
}

// true while the FPGA sysmon stream is fresh = the Chromatic menu (overlay) is open
bool Medic_MenuOpen(void)
{
    MedicHw_t hw;
    MedicHw_Get(&hw);
    return hw.valid03 && (esp_timer_get_time() - hw.t03_us) < 800000;
}

// xp2: snapshot for the auto pre-alert watcher: RED-tag count, latest BLE HR (-1 if none/stale >30 s), unix time (0 = unknown)
void Medic_AutoStatus(int *red, int *hr, int *spo2, uint32_t *unix_now)
{
    if (_Lock == NULL) { *red = 0; *hr = -1; *spo2 = -1; *unix_now = 0; return; }
    LOCK();
    const int64_t t = now_ms();
    *red = _TriCount[TRI_RED];
    *hr = (_BleHr_ms >= 0 && t - _BleHr_ms < 30000) ? _BleHr : -1;
    *spo2 = (_BleSpo2_ms >= 0 && t - _BleSpo2_ms < 30000) ? _BleSpo2 : -1;
    *unix_now = _UnixAnchor ? _UnixAnchor + (uint32_t)((t - _UnixAnchorMs) / 1000) : 0;
    UNLOCK();
}

// xp2: automatic arrival (heard the destination's BLE beacon): ARRIVED event, arg = site id
void Medic_LogArrival(int site)
{
    if (_Lock == NULL) return;
    LOCK();
    log_event(EV_ARRIVED, site);
    UNLOCK();
}

int Medic_BuildSummary(char *out, size_t cap)
{
    if (out == NULL || cap == 0 || _Lock == NULL) return 0;
    LOCK();
    int n = build_summary(out, cap);
    UNLOCK();
    return n;
}

// ---------------------------------------------------------------- UI helpers (render on change only)
static uint32_t _CurBg = 0xFFFFFFFF, _CurFg = 0xFFFFFFFF;

static void set_text(lv_obj_t *l, const char *s)
{
    const char *cur = lv_label_get_text(l);
    if (cur == NULL || strcmp(cur, s) != 0) lv_label_set_text(l, s);
}

static void set_textf(lv_obj_t *l, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static void set_textf(lv_obj_t *l, const char *fmt, ...)
{
    char b[112];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof b, fmt, ap);
    va_end(ap);
    set_text(l, b);
}

static void show(lv_obj_t *o, bool on)
{
    const bool hidden = lv_obj_has_flag(o, LV_OBJ_FLAG_HIDDEN);
    if (on && hidden) lv_obj_clear_flag(o, LV_OBJ_FLAG_HIDDEN);
    if (!on && !hidden) lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
}

static void set_bg(uint32_t c)
{
    if (c != _CurBg) { _CurBg = c; lv_obj_set_style_bg_color(_Root, lv_color_hex(c), 0); }
}

static void set_fg(uint32_t c)
{
    if (c == _CurFg) return;
    _CurFg = c;
    lv_obj_t *objs[] = {_Title, _Big, _Side1, _Side2, _R[0], _R[1], _R[2], _R[3], _R[4], _Hint};
    for (size_t i = 0; i < sizeof(objs) / sizeof(objs[0]); i++)
        lv_obj_set_style_text_color(objs[i], lv_color_hex(c), 0);
}

static void fmt_mmss(char *b, size_t cap, int64_t ms)
{
    if (ms < 0) { snprintf(b, cap, "--:--"); return; }
    int s = (int)(ms / 1000);
    snprintf(b, cap, "%02d:%02d", s / 60, s % 60);
}

static void clear_rows(int from)
{
    for (int i = from; i < 5; i++) set_text(_R[i], "");
}

static bool msg_banner_visible(int64_t t)
{
    if (_MsgAt_ms < 0) return false;
    if (_MsgAcked && (_MsgAckAt_ms < 0 || (t - _MsgAckAt_ms) > MSG_ACK_HIDE_MS)) return false;
    return _Page != PG_HANDOFF;   // never cover the QR code
}

static bool msg_unacked(void) { return _MsgAt_ms >= 0 && !_MsgAcked; }

static const char *alarm_text(int bits)
{
    return bits == (AL_EPI | AL_CYCLE) ? "EPI + RHYTHM DUE" : (bits & AL_EPI) ? "EPI DUE" : "RHYTHM CHECK DUE";
}

// alarms: evaluated on every tick regardless of page (M1)
static void eval_alarms(int64_t t)
{
    _AlarmNow = 0;
    if (_CodeStart_ms < 0 || _Rosc) return;
    int64_t since_epi = _LastEpi_ms < 0 ? (t - _CodeStart_ms) : (t - _LastEpi_ms);
    int64_t since_cyc = _LastCycle_ms < 0 ? (t - _CodeStart_ms) : (t - _LastCycle_ms);
    if (since_epi >= EPI_DUE_S * 1000LL) _AlarmNow |= AL_EPI;
    if (since_cyc >= CYCLE_S * 1000LL) _AlarmNow |= AL_CYCLE;
    if ((_AlarmLatched & _AlarmNow) != _AlarmNow) {
        _AlarmLatched |= _AlarmNow;
        log_event(EV_ALARM, _AlarmNow);
    }
}

static int _LayoutPage = -1;
static void layout_for_page(int pg)
{
    if (pg == _LayoutPage) return;
    _LayoutPage = pg;
    if (pg == PG_DOSE) {
        lv_obj_align(_Big, LV_ALIGN_TOP_LEFT, 2, 15);
    } else {
        lv_obj_align(_Big, LV_ALIGN_TOP_MID, 0, 15);
    }
    show(_Side1, pg == PG_DOSE);
    show(_Side2, pg == PG_DOSE);
}

static void render(void)
{
    char a[24], b[24];
    int64_t t = now_ms();
    bool blink = ((t / 400) % 2) == 0;
    uint32_t bg = 0x000000, fg = 0xFFFFFF;

    layout_for_page(_Page);
    show(_Qr, _Page == PG_HANDOFF);
    show(_Big, _Page != PG_HANDOFF);
    if (_Page != PG_DOSE && _Page != PG_HANDOFF) set_textf(_Title, "%d/%d %s", _Page + 1, PG_COUNT, kPageName[_Page]);

    switch (_Page) {
    case PG_CODE: {
        if (_CodeStart_ms < 0) {
            set_text(_Big, "READY");
            set_text(_R[0], "START: begin code");
            clear_rows(1);
            set_text(_Hint, "</>: pages");
            break;
        }
        fmt_mmss(a, sizeof a, t - _CodeStart_ms);
        set_text(_Big, _Rosc ? "ROSC" : a);
        fmt_mmss(b, sizeof b, _LastEpi_ms < 0 ? -1 : t - _LastEpi_ms);
        set_textf(_R[0], "EPI x%d  last %s", _NumEpi, b);
        fmt_mmss(b, sizeof b, _LastCycle_ms < 0 ? -1 : t - _LastCycle_ms);
        set_textf(_R[1], "SHK x%d  cycle %s", _NumShock, b);
        if (_NumAmio) set_textf(_R[2], "AMIO x%d", _NumAmio); else set_text(_R[2], "");
        // silent-until-wrong: calm black screen unless something is overdue
        if (_AlarmNow) {
            set_text(_R[3], alarm_text(_AlarmNow));
            bg = blink ? ((_AlarmNow & AL_EPI) ? 0xC00000 : 0xC06000) : 0x000000;
        } else {
            set_text(_R[3], "");
        }
        set_text(_R[4], "v:ROSC START:amio");
        set_text(_Hint, "A:epi B:shk ^:check");
        break;
    }
    case PG_DOSE: {
        uint32_t bc;
        const char *band = broselow(_WeightKg, &bc);
        const float epi_mg = epi_ug(_WeightKg) / 1000.0f;
        set_textf(_Title, "%d/%d DOSE A:log EPI", _Page + 1, PG_COUNT);
        set_textf(_Big, "%dkg", _WeightKg);
        set_text(_Side1, band);
        if (_DoseToastUntil_ms > t) set_textf(_Side2, "+%dug", _DoseToastUg);   // what A just logged
        else set_text(_Side2, _DialOn ? "DIAL" : "");
        set_textf(_R[0], "EPI %.2fmg = %.1fmL", epi_mg, epi_mg * 10.0f);   // 0.1 mg/mL (1:10,000)
        set_text(_R[1], "of 0.1mg/mL IV/IO");
        set_textf(_R[2], "AMIO %.0fmg", minf(5.0f * _WeightKg, 300));
        set_textf(_R[3], "ADEN %.1f/%.1fmg", minf(0.1f * _WeightKg, 6), minf(0.2f * _WeightKg, 12));
        set_textf(_R[4], "SHK %d/%dJ", 2 * _WeightKg, 4 * _WeightKg);
        set_textf(_Hint, "D10 %dmL ^v/dial kg", 5 * _WeightKg);
        bg = bc; fg = pick_fg(bc);
        break;
    }
    case PG_RATE: {
        int n; int r = rate_per_min(&n);
        const bool ble = _BleHr_ms >= 0 && t - _BleHr_ms < 5000;
        if (r) set_textf(_Big, "%d", r); else if (ble) set_textf(_Big, "%d", _BleHr); else set_text(_Big, "--");
        if (ble && !r) set_text(_R[0], "HR /min  BLE sensor");
        else set_textf(_R[0], "%s /min  taps=%d", _RateIsHR ? "HR" : "RR", n);
        set_text(_R[1], _RateIsHR ? "A:tap each beat" : "A:tap each breath");
        if (_RateToastUntil_ms > t) set_textf(_R[2], "logged %s %d/min", _RateIsHR ? "HR" : "RR", _RateToastVal);
        else if (n == 0) set_text(_R[2], "");
        else set_text(_R[2], _TapPrecise ? "timing: FPGA edge" : "timing: 20ms tick");
        if (_BleSpo2_ms >= 0 && t - _BleSpo2_ms < 5000 && !(_RateToastUntil_ms > t)) set_textf(_R[2], "SpO2 %d%%%s", _BleSpo2, _BleSpo2 < 90 ? " LOW" : "");
        set_text(_R[3], "^:record B:reset");
        set_text(_R[4], "v: RR/HR");
        if (ble) set_textf(_Hint, "BLE HR %d live", _BleHr); else set_text(_Hint, "idle 20s = restart");
        break;
    }
    case PG_TRIAGE: {
        set_text(_R[1], "");
        set_text(_R[2], "");
        if (_TriStep == TQ_DONE) {
            set_text(_Big, kTriName[_TriResult]);
            set_textf(_R[0], "Patient #%d tagged", _TriPatient);
            set_text(_R[4], "");
            bg = kTriColor[_TriResult];
            fg = pick_fg(bg);
            set_text(_Hint, "^: next patient");
        } else {
            set_textf(_Big, "#%d", _TriPatient);
            set_text(_R[0], kTriQ[_TriStep]);   // may span two lines (R1+R2 area)
            set_text(_R[4], "JumpSTART if <8 yrs");
            set_text(_Hint, "A:YES  B:NO");
        }
        set_textf(_R[3], "G%d Y%d R%d B%d", _TriCount[TRI_GREEN], _TriCount[TRI_YELLOW],
                  _TriCount[TRI_RED], _TriCount[TRI_BLACK]);
        break;
    }
    case PG_HANDOFF: {
        static char s[200];
        static int64_t last_build = -100000;
        if (t - last_build > 2000) {
            int n = build_summary(s, sizeof s);
            lv_qrcode_update(_Qr, s, n);
            last_build = t;
        }
        set_text(_Title, "");
        clear_rows(0);
        set_text(_Hint, msg_unacked() ? "MSG waiting: < >" : "scan at hospital");
        bg = 0xFFFFFF; fg = 0x000000;
        break;
    }
    case PG_SYS: {
        MedicHw_t hw;
        MedicHw_Get(&hw);
        const float bv = _BattV;
        const int bk = _BattKind;
        set_text(_Big, "SYS");
        set_textf(_R[0], "batt %.2fV (%s)", bv, bk == 0 ? "AA" : bk == 1 ? "LiPo" : "?");
        set_textf(_R[1], "ev %d drop %" PRIu32, _NumEv, _Dropped);
        if (hw.valid03) set_textf(_R[2], "vol %u hp%u t%u", hw.vol, hw.hp, hw.temp_raw);
        else set_text(_R[2], "vol -");
        set_textf(_R[3], "hash %02x%02x%02x%02x", _Chain[0], _Chain[1], _Chain[2], _Chain[3]);
        set_textf(_R[4], "boot %" PRIu32, _BootCount);
        set_text(_Hint, "A: stock menu");
        break;
    }
    }

    // host message banner (two-way: A acknowledges while the banner is visible). Unacked stays until acked.
    const bool msg_vis = msg_banner_visible(t);
    if (msg_vis) set_textf(_Banner, "%s%s", _Msg, _MsgAcked ? " [ok]" : " (A=ack)");
    show(_Banner, msg_vis);

    // alarm bar on every page except CODE (which shows it in-page). Bottom row when the top is taken.
    const bool bar = _AlarmNow && _Page != PG_CODE;
    if (bar) {
        set_text(_AlarmBar, alarm_text(_AlarmNow));
        const lv_coord_t y = (msg_vis || _Page == PG_HANDOFF) ? 128 : 0;
        if (lv_obj_get_y(_AlarmBar) != y) lv_obj_set_y(_AlarmBar, y);
        static int last_blink = -1;
        if (last_blink != (int)blink) {
            last_blink = blink;
            lv_obj_set_style_bg_color(_AlarmBar, lv_color_hex(blink ? 0xD00000 : 0x500000), 0);
        }
    }
    show(_AlarmBar, bar);

    set_bg(bg);
    set_fg(fg);
}

// ---------------------------------------------------------------- input
static void give_epi_dose(int64_t t)
{
    _NumEpi++;
    _LastEpi_ms = t;
    _AlarmLatched &= ~AL_EPI;
    _DoseToastUg = epi_ug(_WeightKg);
    log_event(EV_DOSE_EPI, _DoseToastUg);   // arg = micrograms given (M2)
    _DoseToastUntil_ms = t + TOAST_MS;
}

static void dial_reset_ref(void)
{
    MedicHw_t hw;
    MedicHw_Get(&hw);
    _DialOn = false;
    _DialRefValid = hw.valid03;
    _DialRef = hw.vol;
}

// physical: the press came from Button_GetState (FPGA stream or `poke`); false = mbtn injection
static void on_button(Button_t btn, bool physical)
{
    int64_t t = now_ms();

    if (btn == kButton_Left)  { _Page = (_Page + PG_COUNT - 1) % PG_COUNT; return; }
    if (btn == kButton_Right) { _Page = (_Page + 1) % PG_COUNT; return; }

    if (btn == kButton_A && msg_unacked() && msg_banner_visible(t)) {
        _MsgAcked = true;
        _MsgAckAt_ms = t;
        _IgnoreEdgesUntil_us = esp_timer_get_time();   // edges whose first packet predates the ack are the ack press
        log_event(EV_MSG_ACK, 0);
        return;
    }

    switch (_Page) {
    case PG_CODE:
        if (_CodeStart_ms < 0) {
            if (btn == kButton_Start) {
                _CodeStart_ms = t; _LastCycle_ms = t; log_event(EV_CODE_START, 0);
            }
            break;
        }
        if (btn == kButton_A) { _NumEpi++; _LastEpi_ms = t; _AlarmLatched &= ~AL_EPI; log_event(EV_EPI, _NumEpi); }
        if (btn == kButton_B) { _NumShock++; log_event(EV_SHOCK, _NumShock); }
        if (btn == kButton_Up) { _LastCycle_ms = t; _AlarmLatched &= ~AL_CYCLE; log_event(EV_RHYTHM, 0); }
        if (btn == kButton_Down) { _Rosc = !_Rosc; log_event(EV_ROSC, _Rosc); }
        if (btn == kButton_Start) { _NumAmio++; log_event(EV_AMIO, _NumAmio); }
        break;
    case PG_DOSE:
        if (btn == kButton_Up && _WeightKg < 40) _WeightKg++;
        if (btn == kButton_Down && _WeightKg > 3) _WeightKg--;
        if (btn == kButton_Up || btn == kButton_Down) dial_reset_ref();   // buttons take over from the wheel
        if (btn == kButton_A) give_epi_dose(t);
        break;
    case PG_RATE:
        if (btn == kButton_A) {
            // A physical press is timed from the FPGA edge stream (Medic_Tick drains it). Only fall back to
            // the tick time when the stream did not see an A press around now (e.g. `poke 8`).
            const int64_t raw = MedicHw_LastRawAPress_us();
            const int64_t now_us = esp_timer_get_time();
            if (!physical || raw < 0 || (now_us - raw) > 300000) add_tap(now_us, false);
        }
        if (btn == kButton_B) _NumTaps = 0;
        if (btn == kButton_Up) {
            int n; int r = rate_per_min(&n);
            if (r) {
                log_event(EV_RATE, (_RateIsHR ? 100000 : 0) + r);
                _RateToastVal = r;
                _RateToastUntil_ms = t + TOAST_MS;
            }
        }
        if (btn == kButton_Down) { _RateIsHR = !_RateIsHR; _NumTaps = 0; }
        break;
    case PG_TRIAGE:
        if (_TriStep == TQ_DONE) {
            if (btn == kButton_Up) { _TriPatient++; _TriStep = TQ_WALK; _TriResult = TRI_NONE; }
            break;
        }
        if (btn != kButton_A && btn != kButton_B) break;
        {
            bool yes = (btn == kButton_A);
            switch (_TriStep) {
            case TQ_WALK:   if (yes) _TriResult = TRI_GREEN; else _TriStep = TQ_BREATH; break;
            case TQ_BREATH: _TriStep = yes ? TQ_RR30 : TQ_REPOS; break;
            case TQ_REPOS:  if (yes) _TriResult = TRI_RED; else _TriResult = TRI_BLACK; break;
            case TQ_RR30:   if (yes) _TriResult = TRI_RED; else _TriStep = TQ_PERF; break;
            case TQ_PERF:   if (yes) _TriResult = TRI_RED; else _TriStep = TQ_MENTAL; break;
            case TQ_MENTAL: _TriResult = yes ? TRI_YELLOW : TRI_RED; break;
            }
            if (_TriResult != TRI_NONE) {
                _TriStep = TQ_DONE;
                _TriCount[_TriResult]++;
                log_event(EV_TRIAGE, _TriPatient * 10 + _TriResult);
            }
        }
        break;
    case PG_SYS:
        if (btn == kButton_A) _Active = false;   // hand the overlay back to the stock menu
        break;
    default:
        break;
    }
}

// volume wheel -> weight on the DOSE page (engages after > 2 units of movement; Up/Down still work)
static void dial_tick(void)
{
    if (_Page != PG_DOSE) { _DialOn = false; _DialRefValid = false; return; }
    MedicHw_t hw;
    MedicHw_Get(&hw);
    if (!hw.valid03 || (esp_timer_get_time() - hw.t03_us) > 1000000) return;   // stream stale (menu closed)
    const int vol = hw.vol;
    if (!_DialRefValid) { _DialRef = vol; _DialRefValid = true; return; }
    if (!_DialOn) {
        if (abs(vol - _DialRef) > 2) { _DialOn = true; _DialLastVol = vol; _WeightKg = dial_to_kg(vol); }
        return;
    }
    const int kg = dial_to_kg(vol);
    if (kg != _WeightKg && abs(vol - _DialLastVol) >= 2) { _WeightKg = kg; _DialLastVol = vol; }
}

void Medic_Tick(void)
{
    static const Button_t kBtns[] = {kButton_A, kButton_B, kButton_Up, kButton_Down,
                                     kButton_Left, kButton_Right, kButton_Start};
#if VITALS_MODE
    {
        MedicEdge_t e0;
        while (MedicHw_PopPress(&e0)) { }                    // RATE-page tap stream unused here
        if (!lv_obj_has_flag(_Root, LV_OBJ_FLAG_HIDDEN)) lv_obj_add_flag(_Root, LV_OBJ_FLAG_HIDDEN);
        for (size_t i = 0; i < sizeof(kBtns) / sizeof(kBtns[0]); i++)
            if (Button_GetState(kBtns[i]) == kButtonState_Pressed) Vitals_Button(kBtns[i]);
        uint8_t inj0;
        while (xQueueReceive(_BtnQ, &inj0, 0) == pdTRUE) Vitals_Button((Button_t)inj0);
        Vitals_SetVisible(true);
        Vitals_Tick();
        return;
    }
#endif
    LOCK();
    const int64_t t = now_ms();
    // precise A edges first (they are pushed before Button_Update sees the press)
    MedicEdge_t e;
    const int64_t now_us = esp_timer_get_time();
    while (MedicHw_PopPress(&e)) {
        if (now_us - e.raw_us > 1000000) continue;   // queued while medic was inactive: stale
        if (_Page == PG_RATE && !(msg_unacked() && msg_banner_visible(t)) && e.raw_us > _IgnoreEdgesUntil_us)
            add_tap(e.us, true);
    }
    for (size_t i = 0; i < sizeof(kBtns) / sizeof(kBtns[0]); i++) {
        if (Button_GetState(kBtns[i]) == kButtonState_Pressed) on_button(kBtns[i], true);
    }
    uint8_t inj;
    while (xQueueReceive(_BtnQ, &inj, 0) == pdTRUE) on_button((Button_t)inj, false);

    dial_tick();
    eval_alarms(t);

    show(_Root, true);
    static int64_t last = 0;
    if (t - last >= 100) { last = t; render(); }
    UNLOCK();
}

bool Medic_IsActive(void)
{
    if (!_Active && _Root && !lv_obj_has_flag(_Root, LV_OBJ_FLAG_HIDDEN)) lv_obj_add_flag(_Root, LV_OBJ_FLAG_HIDDEN);
    if (!_Active) Vitals_SetVisible(false);
    return _Active;
}

void Medic_NoteBattery(float volts, int kind) { _BattV = volts; _BattKind = kind; }

// ---------------------------------------------------------------- console
static void print_json_str(const char *s)
{
    for (; *s; s++) {
        const unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') printf("\\%c", c);
        else if (c < 0x20 || c >= 0x7f) printf("\\u%04x", c);
        else putchar(c);
    }
}

static void print_hex(const uint8_t *p, size_t n) { for (size_t i = 0; i < n; i++) printf("%02x", p[i]); }

// Same text as `mlog`, written into a buffer (for export over the overlay/UVC grid). Returns length.
int Medic_DumpLog(char *out, size_t cap)
{
    Event_t *copy = malloc(sizeof(Event_t) * MAX_EVENTS);
    if (copy == NULL || cap < 200) { free(copy); return 0; }
    uint8_t head[32], base[32];
    LOCK();
    const int n = _NumEv;
    const uint32_t dropped = _Dropped;
    memcpy(copy, _Ev, sizeof(Event_t) * n);
    memcpy(head, _Chain, 32);
    memcpy(base, _ChainBase, 32);
    UNLOCK();
    size_t k = 0;
#define APP(...) do { int w_ = snprintf(out + k, cap - k, __VA_ARGS__); if (w_ < 0 || (size_t)w_ >= cap - k) goto full; k += (size_t)w_; } while (0)
    APP("MLOG BEGIN n=%d dropped=%" PRIu32 " base=", n, dropped);
    for (int i = 0; i < 32; i++) APP("%02x", base[i]);
    APP("\n");
    for (int i = 0; i < n; i++) {
        const Event_t *e = &copy[i];
        APP("E %" PRIu32 " %u %s %" PRId32 " ", e->t_ms, e->type, e->type < EV_COUNT ? kEvName[e->type] : "?", e->arg);
        for (int j = 0; j < 8; j++) APP("%02x", e->tag[j]);
        APP("\n");
    }
    APP("MLOG END head=");
    for (int i = 0; i < 32; i++) APP("%02x", head[i]);
    APP("\n");
#undef APP
full:
    free(copy);
    return (int)k;
}

static int cmd_medic(int argc, char **argv)
{
    if (argc >= 2) _Active = (strcmp(argv[1], "off") != 0);
    printf("{\"medic\":%s}\n", _Active ? "true" : "false");
    return 0;
}

static int cmd_mbtn(int argc, char **argv)
{
    static const struct { const char *n; Button_t b; } map[] = {
        {"a", kButton_A}, {"b", kButton_B}, {"up", kButton_Up}, {"down", kButton_Down},
        {"left", kButton_Left}, {"right", kButton_Right}, {"start", kButton_Start},
    };
    int q = 0;
    for (int i = 1; i < argc; i++) {
        for (size_t j = 0; j < sizeof(map) / sizeof(map[0]); j++) {
            if (strcmp(argv[i], map[j].n) == 0) { uint8_t v = map[j].b; if (xQueueSend(_BtnQ, &v, 0) == pdTRUE) q++; }
        }
    }
    printf("{\"queued\":%d}\n", q);
    return 0;
}

// xp2: post a host->crew message (console msg, BLE MSG characteristic). Returns stored length.
int Medic_PostMsg(const char *tmp)
{
    if (_Lock == NULL) return 0;
    LOCK();
    strlcpy(_Msg, tmp, sizeof(_Msg));
    _MsgAt_ms = now_ms();
    _MsgAcked = false;
    _MsgAckAt_ms = -1;
    log_event(EV_MSG_RX, (int32_t)strlen(_Msg));
    const int n = (int)strlen(_Msg);
    UNLOCK();
    return n;
}

// xp2: ms from message arrival to the crew's A-press acknowledgement; -1 = no message or not yet acked.
int Medic_MsgAckMs(void)
{
    if (_Lock == NULL) return -1;
    LOCK();
    const int r = (_MsgAt_ms >= 0 && _MsgAcked && _MsgAckAt_ms >= 0) ? (int)(_MsgAckAt_ms - _MsgAt_ms) : -1;
    UNLOCK();
    return r;
}

static int cmd_msg(int argc, char **argv)
{
    char tmp[MSG_LEN] = {0};
    size_t n = 0;
    for (int i = 1; i < argc && n < sizeof(tmp) - 1; i++) {
        int k = snprintf(tmp + n, sizeof(tmp) - n, "%s%s", i > 1 ? " " : "", argv[i]);
        if (k < 0) break;
        n += (size_t)k;
        if (n > sizeof(tmp) - 1) n = sizeof(tmp) - 1;
    }
    char copy[MSG_LEN];
    LOCK();
    strlcpy(_Msg, tmp, sizeof(_Msg));
    _MsgAt_ms = now_ms();
    _MsgAcked = false;
    _MsgAckAt_ms = -1;
    log_event(EV_MSG_RX, (int32_t)strlen(_Msg));   // stored length (M7)
    strlcpy(copy, _Msg, sizeof copy);
    UNLOCK();
    printf("{\"msg\":\"");
    print_json_str(copy);
    printf("\"}\n");
    return 0;
}

static int cmd_mtime(int argc, char **argv)
{
    LOCK();
    if (argc == 2) {
        _UnixAnchor = (uint32_t)strtoul(argv[1], NULL, 10);
        _UnixAnchorMs = (uint32_t)now_ms();
        log_event(EV_TIME_SYNC, (int32_t)_UnixAnchor);
    }
    const uint32_t ua = _UnixAnchor, um = _UnixAnchorMs;
    UNLOCK();
    printf("{\"unix_anchor\":%" PRIu32 ",\"anchor_ms\":%" PRIu32 ",\"now_ms\":%" PRId64 "}\n", ua, um, now_ms());
    return 0;
}

static int cmd_mpage(int argc, char **argv)
{
    LOCK();
    if (argc == 2) { int p = atoi(argv[1]); if (p >= 0 && p < PG_COUNT) _Page = p; }
    const int p = _Page;
    UNLOCK();
    printf("{\"page\":%d,\"name\":\"%s\"}\n", p, kPageName[p]);
    return 0;
}

static int cmd_mstate(int argc, char **argv)
{
    char s[220];
    MedicHw_t hw;
    MedicHw_Get(&hw);
    LOCK();
    build_summary(s, sizeof s);
    const int64_t t = now_ms();
    int rn; const int rate = rate_per_min(&rn);
    const int active = _Active, page = _Page, epi = _NumEpi, shk = _NumShock, rosc = _Rosc, wt = _WeightKg;
    const int tri_step = _TriStep, tri_res = _TriResult, nev = _NumEv, alarm = _AlarmNow, dial = _DialOn;
    const int precise = _TapPrecise, unacked = msg_unacked(), is_hr = _RateIsHR;
    const int64_t code_ms = _CodeStart_ms < 0 ? -1 : t - _CodeStart_ms;
    UNLOCK();
    printf("{\"now_ms\":%" PRId64 ",\"active\":%d,\"page\":%d,\"code_ms\":%" PRId64 ",\"epi\":%d,\"shock\":%d,"
           "\"rosc\":%d,\"wt\":%d,\"dial\":%d,\"taps\":%d,\"rate\":%d,\"rate_kind\":\"%s\",\"rate_src\":\"%s\","
           "\"tri_step\":%d,\"tri_result\":%d,\"alarm\":%d,\"msg_unacked\":%d,\"batt_v\":%.3f,\"batt_kind\":%d,"
           "\"vol\":%d,\"hp\":%d,\"bl\":%d,\"temp_raw\":%d,\"pmic\":\"%04x\",\"hw_age_ms\":%" PRId64 ","
           "\"events\":%d,\"summary\":\"%s\"}\n",
           t, active, page, code_ms, epi, shk, rosc, wt, dial, rn, rate, is_hr ? "hr" : "rr",
           rn == 0 ? "-" : precise ? "fpga_edge" : "tick", tri_step, tri_res, alarm, unacked, (double)_BattV, _BattKind,
           hw.valid03 ? hw.vol : -1, hw.valid03 ? hw.hp : -1, hw.valid03 ? hw.bl : -1, hw.valid07 ? hw.temp_raw : -1,
           hw.pmic, hw.valid03 ? (esp_timer_get_time() - hw.t03_us) / 1000 : -1, nev, s);
    return 0;
}

static int cmd_mlog(int argc, char **argv)
{
    // copy under the lock, print outside it (printing 160 lines takes ~0.5 s)
    Event_t *copy = malloc(sizeof(Event_t) * MAX_EVENTS);
    if (copy == NULL) { printf("{\"cmd\":\"mlog\",\"error\":\"no mem\"}\n"); return 1; }
    uint8_t head[32], base[32];
    LOCK();
    const int n = _NumEv;
    const uint32_t dropped = _Dropped;
    memcpy(copy, _Ev, sizeof(Event_t) * n);
    memcpy(head, _Chain, 32);
    memcpy(base, _ChainBase, 32);
    UNLOCK();
    printf("MLOG BEGIN n=%d dropped=%" PRIu32 " base=", n, dropped);
    print_hex(base, 32);
    printf("\n");
    for (int i = 0; i < n; i++) {
        const Event_t *e = &copy[i];
        printf("E %" PRIu32 " %u %s %" PRId32 " ", e->t_ms, e->type, e->type < EV_COUNT ? kEvName[e->type] : "?", e->arg);
        print_hex(e->tag, 8);
        printf("\n");
        if ((i & 15) == 15) vTaskDelay(1);
    }
    printf("MLOG END head=");
    print_hex(head, 32);
    printf("\n");
    free(copy);
    return 0;
}

// mlogp [clear] - boot counter, chain head and the last 16 events persisted in NVS namespace "medic"
static int cmd_mlogp(int argc, char **argv)
{
    if (argc >= 2 && strcmp(argv[1], "clear") == 0) {
        nvs_handle_t h;
        if (nvs_open("medic", NVS_READWRITE, &h) == ESP_OK) {
            (void)nvs_erase_key(h, "ev");
            (void)nvs_commit(h);
            nvs_close(h);
        }
        LOCK();
        memset(&_PLog, 0, sizeof(_PLog));
        _PLog.ver = 2;
        UNLOCK();
        printf("{\"cmd\":\"mlogp\",\"cleared\":true,\"boot\":%" PRIu32 "}\n", _BootCount);
        return 0;
    }
    PLog_t *p = malloc(sizeof(PLog_t));
    if (p == NULL) { printf("{\"cmd\":\"mlogp\",\"error\":\"no mem\"}\n"); return 1; }
    LOCK();
    *p = _PLog;
    const bool ok = _PLogOk;
    UNLOCK();
    printf("{\"cmd\":\"mlogp\",\"ok\":%d,\"ver\":%u,\"boot\":%" PRIu32 ",\"stored\":%u,\"head\":\"", ok, p->ver, _BootCount, p->count);
    print_hex(p->chain, 32);
    printf("\",\"head_boot\":%" PRIu32 ",\"head_nev\":%" PRIu32 ",\"prev_head\":\"", p->chain_boot, p->chain_nev);
    print_hex(_PrevHead, 32);
    printf("\",\"prev_head_boot\":%" PRIu32 ",\"prev_head_nev\":%" PRIu32 ",\"prev_valid\":%d}\n", _PrevHeadBoot, _PrevHeadNev,
           _PrevHeadValid);
    const int start = (p->head + PERSIST_N - p->count) % PERSIST_N;
    for (int i = 0; i < p->count; i++) {
        const PEvent_t *e = &p->e[(start + i) % PERSIST_N];
        const char *nm = e->type < EV_COUNT ? kEvName[e->type] : "?";
        printf("{\"cmd\":\"mlogp\",\"i\":%d,\"boot\":%" PRIu32 ",\"t_ms\":%" PRIu32 ",\"ev\":\"%s\",\"arg\":%" PRId32 "}\n",
               i, e->boot, e->t_ms, nm, e->arg);
    }
    free(p);
    return 0;
}

static void reg(const char *name, const char *help, esp_console_cmd_func_t fn)
{
    const esp_console_cmd_t c = { .command = name, .help = help, .func = fn };
    esp_console_cmd_register(&c);
}

// ---------------------------------------------------------------- init
// Fixed width AND height: with LONG_DOT an over-long line ends in "..." instead of wrapping into the next row.
static lv_obj_t *mk_label(lv_coord_t x, lv_coord_t y, lv_coord_t w, lv_coord_t h)
{
    lv_obj_t *l = lv_label_create(_Root);
    lv_obj_add_style(l, &_StText, 0);
    lv_obj_set_pos(l, x, y);
    lv_obj_set_size(l, w, h);
    lv_label_set_long_mode(l, LV_LABEL_LONG_DOT);   // visible "..." instead of silent clipping
    lv_label_set_text(l, "");
    return l;
}

void Medic_Init(lv_obj_t *pScreen)
{
    (void)pScreen;
    _Lock = xSemaphoreCreateRecursiveMutex();
    _BtnQ = xQueueCreate(32, sizeof(uint8_t));
    MedicHw_Init();
    memset(_Chain, 0, sizeof(_Chain));
    memset(_ChainBase, 0, sizeof(_ChainBase));
    persist_init();
    log_event(EV_BOOT, (int32_t)_BootCount);
    if (_PrevHeadValid) {
        // commit this boot's chain to the head an earlier boot left in NVS (first 4 bytes, LE)
        int32_t h4;
        memcpy(&h4, _PrevHead, 4);
        log_event(EV_PREV_HEAD, h4);
    }

    _Root = lv_obj_create(lv_layer_top());
    lv_obj_remove_style_all(_Root);
    lv_obj_set_size(_Root, W, H);
    lv_obj_set_pos(_Root, 0, 0);
    lv_obj_set_style_bg_opa(_Root, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(_Root, lv_color_hex(0x000000), 0);
    lv_obj_clear_flag(_Root, LV_OBJ_FLAG_SCROLLABLE);

    lv_style_init(&_StText);
    lv_style_set_text_color(&_StText, lv_color_hex(0xFFFFFF));
    lv_style_set_text_font(&_StText, &lv_font_montserrat_14);

    // layout: title 0..16, big 15..45 (28 px font), rows at 46/62/78/94/110, hint 128..144
    _Title = mk_label(2, 0, LBL_W, 16);

    _Big = lv_label_create(_Root);
    lv_obj_add_style(_Big, &_StText, 0);
    lv_obj_set_style_text_font(_Big, &lv_font_montserrat_28, 0);
    lv_label_set_text(_Big, "");
    lv_obj_align(_Big, LV_ALIGN_TOP_MID, 0, 15);

    _Side1 = mk_label(84, 16, 74, 15);   // DOSE page: Broselow band
    _Side2 = mk_label(84, 31, 74, 15);   // DOSE page: DIAL marker / "+200ug" after logging
    // R1 is two lines tall (triage questions span R1+R2; R2 is empty then). Others are one line.
    for (int i = 0; i < 5; i++) _R[i] = mk_label(2, (lv_coord_t)(46 + 16 * i), LBL_W, i == 0 ? 32 : 16);
    _Hint = mk_label(2, 128, LBL_W, 16);

    _Qr = lv_qrcode_create(_Root, 124, lv_color_hex(0x000000), lv_color_hex(0xFFFFFF));
    lv_obj_align(_Qr, LV_ALIGN_TOP_MID, 0, 1);
    lv_obj_add_flag(_Qr, LV_OBJ_FLAG_HIDDEN);

    _AlarmBar = lv_label_create(_Root);
    lv_obj_add_style(_AlarmBar, &_StText, 0);
    lv_obj_set_size(_AlarmBar, W, 16);
    lv_label_set_long_mode(_AlarmBar, LV_LABEL_LONG_DOT);
    lv_obj_set_style_pad_left(_AlarmBar, 2, 0);
    lv_obj_set_style_bg_opa(_AlarmBar, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(_AlarmBar, lv_color_hex(0xD00000), 0);
    lv_obj_set_style_text_color(_AlarmBar, lv_color_hex(0xFFFFFF), 0);
    lv_label_set_text(_AlarmBar, "");
    lv_obj_set_pos(_AlarmBar, 0, 0);
    lv_obj_add_flag(_AlarmBar, LV_OBJ_FLAG_HIDDEN);

    _Banner = lv_label_create(_Root);
    lv_obj_add_style(_Banner, &_StText, 0);
    lv_obj_set_width(_Banner, W);
    lv_label_set_long_mode(_Banner, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_bg_opa(_Banner, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(_Banner, lv_color_hex(0xF0D000), 0);
    lv_obj_set_style_text_color(_Banner, lv_color_hex(0x000000), 0);
    lv_label_set_text(_Banner, "");
    lv_obj_set_pos(_Banner, 0, 0);
    lv_obj_add_flag(_Banner, LV_OBJ_FLAG_HIDDEN);

    lv_obj_add_flag(_Root, LV_OBJ_FLAG_HIDDEN);
#if VITALS_MODE
    _Sess_ms = now_ms();
    Vitals_Init();
    Vitals_SetVisible(false);   // shown by the first Medic_Tick
#endif

    reg("medic", "medic [on|off] - medic overlay ownership", cmd_medic);
    reg("mbtn", "mbtn <a|b|up|down|left|right|start>... - inject medic buttons", cmd_mbtn);
    reg("msg", "msg <text> - show a host message banner (stays until A acks)", cmd_msg);
    reg("mtime", "mtime [unix] - anchor device clock to host unix time", cmd_mtime);
    reg("mpage", "mpage [n] - get/set medic page", cmd_mpage);
    reg("mstate", "mstate - JSON state (+ wheel/hp/temp/pmic) + handoff summary", cmd_mstate);
    reg("mlog", "mlog - dump hash-chained event log (BEGIN carries base=)", cmd_mlog);
    reg("mlogp", "mlogp [clear] - boot counter, chain head + last 16 events persisted in NVS", cmd_mlogp);
    MedicHw_RegisterCmds();
}
