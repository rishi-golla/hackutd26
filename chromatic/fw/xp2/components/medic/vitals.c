// VITALS mode: the whole overlay is one clean live-vitals monitor for a single BLE finger sensor
// (Pi MAX30102 -> standard Heart Rate 0x180D + Pulse Oximeter 0x1822, fed in by fw/xp2 blehr through
// Medic_NoteVital). Research prototype, NOT a medical device.
//
// 160x144 layout (dark):
//   y   0..18   status bar: state chip (left), BLE glyph + session clock (right)
//   y  20..80   HR panel (x 4..98: caption, pulsing heart, 48 px number) | SpO2 panel (x 104..156)
//   y  82..112  60 s HR sparkline
//   y 114..128  session range row
//   y 130..144  footer: one-line hint (state colour) + "A QR"
// QR screen (A toggles, B back): white, 111 px QR of a human-readable summary + side readout.

#include "medic_priv.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#define W 160
#define H 144

#define C_BG       0x0A0E14
#define C_PANEL    0x111823
#define C_LINE     0x1C2633
#define C_MUTED    0x7C8798
#define C_TEXT     0xF2F5F8
#define C_TEAL     0x2DD4BF
#define C_GREEN    0x34D399
#define C_BLUE     0x60A5FA
#define C_AMBER    0xFBBF24
#define C_RED      0xFF4D4F
#define C_SPO2     0x7DD3FC
#define C_HEART    0xFF375F

#define HR_LO 50
#define HR_HI 130
#define SPO2_LO 90
#define LIVE_MS 3000        // a valid HR younger than this = live
#define SPO2_MS 5000
#define LOST_MS 4000        // linked + subscribed but no packet for this long = signal lost
#define CHART_N 60

typedef enum { ST_SEARCH, ST_CONNECT, ST_NOFINGER, ST_MEASURE, ST_LIVE, ST_ALERT, ST_LOST } State_t;

static lv_obj_t *_VRoot, *_Chip, *_ChipLbl, *_Ble, *_Clock;
static lv_obj_t *_HrCap, *_Heart, *_HrVal, *_HrUnit, *_SpCap, *_SpVal, *_SpUnit, *_Div;
static lv_obj_t *_Chart, *_Range, *_Foot, *_Hint, *_FootR;
static lv_chart_series_t *_Ser;
static lv_obj_t *_QRoot, *_QrTitle, *_Qr, *_QHrCap, *_QHr, *_QSpCap, *_QSp, *_QFoot;
static bool _ShowQr;
static int64_t _NextChart_ms, _NextQr_ms, _NextBeat_ms;
static char _QrText[160];
static char _Cache[12][56];   // render-on-change cache for labels

// heart glyph: 16x14 image generated at init, ARGB (RGB565 + alpha) so it can be recoloured + zoomed
#define HEART_W 16
#define HEART_H 14
static uint8_t _HeartBuf[HEART_W * HEART_H * 3];
static lv_img_dsc_t _HeartImg;

static void mk_heart(void)
{
    for (int y = 0; y < HEART_H; y++) {
        for (int x = 0; x < HEART_W; x++) {
            // implicit heart (x^2 + y^2 - 1)^3 - x^2 y^3 <= 0, 2x2 supersampled for soft edges
            int in = 0;
            for (int sy = 0; sy < 2; sy++) {
                for (int sx = 0; sx < 2; sx++) {
                    const float fx = ((x + 0.25f + 0.5f * sx) / HEART_W - 0.5f) * 2.5f;
                    const float fy = (0.5f - (y + 0.25f + 0.5f * sy) / HEART_H) * 2.5f + 0.15f;
                    const float a = fx * fx + fy * fy - 1.0f;
                    if (a * a * a - fx * fx * fy * fy * fy <= 0.0f) in++;
                }
            }
            const lv_color_t c = lv_color_hex(0xFFFFFF);
            uint8_t *p = &_HeartBuf[(y * HEART_W + x) * 3];
            memcpy(p, &c, 2);
            p[2] = (uint8_t)(in * 255 / 4);
        }
    }
    _HeartImg.header.always_zero = 0;
    _HeartImg.header.w = HEART_W;
    _HeartImg.header.h = HEART_H;
    _HeartImg.header.cf = LV_IMG_CF_TRUE_COLOR_ALPHA;
    _HeartImg.data_size = sizeof(_HeartBuf);
    _HeartImg.data = _HeartBuf;
}

static lv_obj_t *mk_lbl(lv_obj_t *parent, const lv_font_t *f, uint32_t color, lv_coord_t x, lv_coord_t y)
{
    lv_obj_t *l = lv_label_create(parent);
    lv_obj_set_style_text_font(l, f, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
    lv_label_set_text(l, "");
    lv_obj_set_pos(l, x, y);
    return l;
}

static lv_obj_t *mk_box(lv_obj_t *parent, lv_coord_t x, lv_coord_t y, lv_coord_t w, lv_coord_t h, uint32_t bg, lv_coord_t r)
{
    lv_obj_t *o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_set_pos(o, x, y);
    lv_obj_set_size(o, w, h);
    lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(o, lv_color_hex(bg), 0);
    lv_obj_set_style_radius(o, r, 0);
    lv_obj_clear_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    return o;
}

// set label text + colour only when it changed (LVGL invalidates on every set)
static void put(int slot, lv_obj_t *l, uint32_t color, const char *fmt, ...) __attribute__((format(printf, 4, 5)));
static void put(int slot, lv_obj_t *l, uint32_t color, const char *fmt, ...)
{
    char b[40];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(b, sizeof b, fmt, ap);
    va_end(ap);
    char key[56];
    snprintf(key, sizeof key, "%06lx%s", (unsigned long)color, b);
    if (strcmp(_Cache[slot], key) == 0) return;
    strncpy(_Cache[slot], key, sizeof _Cache[slot] - 1);
    lv_label_set_text(l, b);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
}

void Vitals_Init(void)
{
    mk_heart();
    // ---- vitals screen
    _VRoot = mk_box(lv_layer_top(), 0, 0, W, H, C_BG, 0);

    _Chip = mk_box(_VRoot, 4, 3, 86, 14, C_BLUE, 7);
    _ChipLbl = lv_label_create(_Chip);
    lv_obj_set_style_text_font(_ChipLbl, &lv_font_montserrat_12, 0);
    lv_obj_set_style_text_color(_ChipLbl, lv_color_hex(C_BG), 0);
    lv_obj_center(_ChipLbl);
    _Ble = mk_lbl(_VRoot, &lv_font_montserrat_12, C_MUTED, 104, 3);
    lv_label_set_text(_Ble, LV_SYMBOL_BLUETOOTH);
    _Clock = mk_lbl(_VRoot, &lv_font_montserrat_12, C_MUTED, 116, 3);
    lv_obj_set_width(_Clock, 40);
    lv_obj_set_style_text_align(_Clock, LV_TEXT_ALIGN_RIGHT, 0);

    mk_box(_VRoot, 0, 19, W, 1, C_LINE, 0);

    // HR panel x 2..98: caption "HR bpm" + pulsing heart top-right, 48 px number (3 digits ~87 px) below
    _HrCap = mk_lbl(_VRoot, &lv_font_montserrat_12, C_MUTED, 6, 22);
    lv_label_set_text(_HrCap, "HR  bpm");
    _Heart = lv_img_create(_VRoot);
    lv_img_set_src(_Heart, &_HeartImg);
    lv_obj_set_pos(_Heart, 78, 23);
    lv_img_set_pivot(_Heart, HEART_W / 2, HEART_H / 2);
    lv_obj_set_style_img_recolor_opa(_Heart, LV_OPA_COVER, 0);
    lv_obj_set_style_img_recolor(_Heart, lv_color_hex(C_LINE), 0);
    _HrVal = mk_lbl(_VRoot, &lv_font_montserrat_48, C_TEXT, 2, 33);
    lv_obj_set_width(_HrVal, 96);
    lv_label_set_long_mode(_HrVal, LV_LABEL_LONG_CLIP);
    _HrUnit = NULL;

    _Div = mk_box(_VRoot, 100, 24, 1, 54, C_LINE, 0);

    // SpO2 panel x 104..158: caption "SpO2 %", 28 px number ("100" ~51 px)
    _SpCap = mk_lbl(_VRoot, &lv_font_montserrat_12, C_MUTED, 106, 22);
    lv_label_set_text(_SpCap, "SpO2  %");
    _SpVal = mk_lbl(_VRoot, &lv_font_montserrat_28, C_SPO2, 105, 44);
    lv_obj_set_width(_SpVal, 54);
    lv_label_set_long_mode(_SpVal, LV_LABEL_LONG_CLIP);
    _SpUnit = NULL;

    _Chart = lv_chart_create(_VRoot);
    lv_obj_set_pos(_Chart, 4, 82);
    lv_obj_set_size(_Chart, W - 8, 30);
    lv_chart_set_type(_Chart, LV_CHART_TYPE_LINE);
    lv_chart_set_point_count(_Chart, CHART_N);
    lv_chart_set_update_mode(_Chart, LV_CHART_UPDATE_MODE_SHIFT);
    lv_chart_set_div_line_count(_Chart, 3, 0);
    lv_chart_set_range(_Chart, LV_CHART_AXIS_PRIMARY_Y, 40, 140);
    lv_obj_set_style_bg_color(_Chart, lv_color_hex(C_PANEL), 0);
    lv_obj_set_style_bg_opa(_Chart, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(_Chart, 0, 0);
    lv_obj_set_style_radius(_Chart, 6, 0);
    lv_obj_set_style_pad_all(_Chart, 3, 0);
    lv_obj_set_style_line_color(_Chart, lv_color_hex(C_LINE), LV_PART_MAIN);
    lv_obj_set_style_line_width(_Chart, 2, LV_PART_ITEMS);
    lv_obj_set_style_size(_Chart, 0, LV_PART_INDICATOR);   // no point dots
    _Ser = lv_chart_add_series(_Chart, lv_color_hex(C_TEAL), LV_CHART_AXIS_PRIMARY_Y);
    lv_chart_set_all_value(_Chart, _Ser, LV_CHART_POINT_NONE);

    _Range = mk_lbl(_VRoot, &lv_font_montserrat_12, C_MUTED, 6, 114);
    lv_obj_set_width(_Range, W - 12);

    _Foot = mk_box(_VRoot, 0, 130, W, 14, C_PANEL, 0);
    _Hint = mk_lbl(_Foot, &lv_font_montserrat_12, C_MUTED, 6, 0);
    lv_obj_set_width(_Hint, 112);
    lv_label_set_long_mode(_Hint, LV_LABEL_LONG_DOT);
    _FootR = mk_lbl(_Foot, &lv_font_montserrat_12, C_MUTED, 120, 0);
    lv_obj_set_width(_FootR, 36);
    lv_obj_set_style_text_align(_FootR, LV_TEXT_ALIGN_RIGHT, 0);
    lv_label_set_text(_FootR, "A " LV_SYMBOL_RIGHT " QR");

    // ---- QR screen
    _QRoot = mk_box(lv_layer_top(), 0, 0, W, H, 0xFFFFFF, 0);
    _QrTitle = mk_lbl(_QRoot, &lv_font_montserrat_12, 0x111823, 4, 1);
    lv_label_set_text(_QrTitle, "SCAN VITALS");
    _Qr = lv_qrcode_create(_QRoot, 111, lv_color_hex(0x000000), lv_color_hex(0xFFFFFF));
    lv_obj_set_pos(_Qr, 4, 18);
    _QHrCap = mk_lbl(_QRoot, &lv_font_montserrat_12, 0x6B7280, 120, 22);
    lv_label_set_text(_QHrCap, "HR");
    _QHr = mk_lbl(_QRoot, &lv_font_montserrat_26, 0x111823, 118, 36);
    _QSpCap = mk_lbl(_QRoot, &lv_font_montserrat_12, 0x6B7280, 120, 70);
    lv_label_set_text(_QSpCap, "SpO2");
    _QSp = mk_lbl(_QRoot, &lv_font_montserrat_26, 0x0E7490, 118, 84);
    _QFoot = mk_lbl(_QRoot, &lv_font_montserrat_12, 0x6B7280, 118, 128);
    lv_label_set_text(_QFoot, "B back");
    lv_obj_add_flag(_QRoot, LV_OBJ_FLAG_HIDDEN);
}

static void vis(lv_obj_t *o, bool on)   // change (and invalidate) only on a real change
{
    const bool hidden = lv_obj_has_flag(o, LV_OBJ_FLAG_HIDDEN);
    if (on && hidden) lv_obj_clear_flag(o, LV_OBJ_FLAG_HIDDEN);
    if (!on && !hidden) lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
}

void Vitals_SetVisible(bool on)
{
    if (_VRoot == NULL) return;
    vis(_VRoot, on && !_ShowQr);
    vis(_QRoot, on && _ShowQr);
}

void Vitals_Button(Button_t b)
{
    if (b == kButton_A || b == kButton_Right || b == kButton_Left) { _ShowQr = !_ShowQr; _NextQr_ms = 0; }
    else if (b == kButton_B) _ShowQr = false;
    else if (b == kButton_Start) {
        Medic_VitalsReset();
        lv_chart_set_all_value(_Chart, _Ser, LV_CHART_POINT_NONE);
    }
    Vitals_SetVisible(true);
}

static State_t state_of(const MedicVitals_t *v, bool *hr_live, bool *sp_live)
{
    const int64_t t = v->now_ms;
    *hr_live = v->hr > 0 && v->hr_ms >= 0 && t - v->hr_ms < LIVE_MS;
    *sp_live = v->spo2 > 0 && v->spo2_ms >= 0 && t - v->spo2_ms < SPO2_MS && v->contact != 0;
    if (v->link <= 0) return ST_SEARCH;
    if (v->link == 1) return ST_CONNECT;
    const int64_t last = v->pkt_ms > v->link_ms ? v->pkt_ms : -1;   // packets since this (re)subscription
    if (last < 0) return (t - v->link_ms > LOST_MS) ? ST_LOST : ST_CONNECT;
    if (t - last > LOST_MS) return ST_LOST;
    if (v->contact == 0) return ST_NOFINGER;
    if (!*hr_live) return ST_MEASURE;
    const bool crit = v->hr < HR_LO || v->hr > HR_HI || (*sp_live && v->spo2 < SPO2_LO);
    return crit ? ST_ALERT : ST_LIVE;
}

static void build_qr(const MedicVitals_t *v, bool hr_live, bool sp_live, int secs)
{
    char hr[12] = "--", sp[12] = "--", rng[28] = "--", mn[12] = "--";
    if (hr_live) snprintf(hr, sizeof hr, "%d", v->hr);
    if (sp_live) snprintf(sp, sizeof sp, "%d", v->spo2);
    if (v->hr_min > 0) snprintf(rng, sizeof rng, "%d-%d", v->hr_min, v->hr_max);
    if (v->spo2_min > 0) snprintf(mn, sizeof mn, "%d", v->spo2_min);
    snprintf(_QrText, sizeof _QrText,
             "CMX VITALS\nHR %s bpm\nSpO2 %s%%\nHR %s SpO2min %s\nn %d t %02d:%02d:%02d\n#%02x%02x%02x%02x",
             hr, sp, rng, mn, v->n, secs / 3600, (secs / 60) % 60, secs % 60,
             v->head[0], v->head[1], v->head[2], v->head[3]);
}

static void heart_color(uint32_t c)
{
    static uint32_t cur = 0xFFFFFFFF;
    if (c == cur) return;
    cur = c;
    lv_obj_set_style_img_recolor(_Heart, lv_color_hex(c), 0);
}

void Vitals_Tick(void)
{
    if (_VRoot == NULL) return;
    MedicVitals_t v;
    Medic_VitalsGet(&v);
    bool hr_live, sp_live;
    const State_t st = state_of(&v, &hr_live, &sp_live);
    const int64_t t = v.now_ms;
    const int secs = (int)((t - v.sess_ms) / 1000);

    // ---- heart: beats at the live rate (zoom pulse + colour), grey otherwise
    if ((st == ST_LIVE || st == ST_ALERT) && v.hr >= 25 && v.hr <= 240) {
        const int64_t period = 60000 / v.hr;
        if (_NextBeat_ms == 0 || t - _NextBeat_ms > 2 * period) _NextBeat_ms = t;
        int64_t since = t - _NextBeat_ms;
        if (since >= period) { _NextBeat_ms += period; since -= period; }
        // lub: grow to 1.3x in 90 ms, ease back over 240 ms, rest until the next beat
        const int z = since < 90 ? 256 + (int)(77 * since / 90) : (since < 330 ? 333 - (int)(77 * (since - 90) / 240) : 256);
        lv_img_set_zoom(_Heart, (uint16_t)z);
        heart_color(st == ST_ALERT ? C_RED : C_HEART);
    } else {
        _NextBeat_ms = 0;
        lv_img_set_zoom(_Heart, 256);
        heart_color(C_LINE);
    }

    // ---- everything else at 5 Hz
    static int64_t next = 0;
    if (t < next) return;
    next = t + 200;

    static const char *const kChip[] = {"SEARCHING", "CONNECTING", "NO FINGER", "MEASURING", "LIVE", "ALERT", "SIGNAL LOST"};
    static const uint32_t kChipC[] = {C_BLUE, C_BLUE, C_AMBER, C_TEAL, C_GREEN, C_RED, C_RED};
    const bool blink = (st == ST_ALERT || st == ST_LOST) && ((t / 500) & 1);
    static uint32_t chip_c = 0xFFFFFFFF;
    const uint32_t cc = blink ? 0x7A1D20 : kChipC[st];
    if (cc != chip_c) { chip_c = cc; lv_obj_set_style_bg_color(_Chip, lv_color_hex(cc), 0); }
    put(0, _ChipLbl, blink ? C_TEXT : C_BG, "%s", kChip[st]);
    put(1, _Ble, v.link == 2 ? C_TEAL : (v.link == 1 ? C_BLUE : ((t / 600) & 1 ? C_MUTED : C_LINE)), LV_SYMBOL_BLUETOOTH);
    if (secs < 3600) put(2, _Clock, C_MUTED, "%02d:%02d", secs / 60, secs % 60);
    else put(2, _Clock, C_MUTED, "%d:%02dh", secs / 3600, (secs / 60) % 60);

    const bool hr_crit = hr_live && (v.hr < HR_LO || v.hr > HR_HI);
    if (hr_live) put(3, _HrVal, hr_crit ? C_RED : C_TEXT, "%d", v.hr);
    else put(3, _HrVal, C_LINE, "--");
    const bool sp_crit = sp_live && v.spo2 < SPO2_LO;
    if (sp_live) put(4, _SpVal, sp_crit ? C_RED : (v.spo2 < 95 ? C_AMBER : C_SPO2), "%d", v.spo2);
    else put(4, _SpVal, C_LINE, "--");

    const char *hint;
    char hb[40];
    switch (st) {
    case ST_SEARCH:   hint = v.n ? "Reconnecting..." : "Searching..."; break;
    case ST_CONNECT:  hint = "Connecting..."; break;
    case ST_NOFINGER: hint = "Place finger"; break;
    case ST_MEASURE:  hint = "Hold still..."; break;
    case ST_LOST:     hint = "Check sensor"; break;
    case ST_ALERT:
        snprintf(hb, sizeof hb, "%s", hr_crit ? (v.hr > HR_HI ? "HR HIGH" : "HR LOW") : "SpO2 LOW");
        hint = hb;
        break;
    default:          hint = "Monitoring"; break;
    }
    put(5, _Hint, st == ST_LIVE ? C_GREEN : kChipC[st], "%s", hint);

    if (v.hr_min <= 0) put(6, _Range, C_MUTED, "No readings yet");
    else if (v.spo2_min > 0) put(6, _Range, C_MUTED, "HR %d-%d    SpO2 min %d", v.hr_min, v.hr_max, v.spo2_min);
    else put(6, _Range, C_MUTED, "HR %d-%d    SpO2 min --", v.hr_min, v.hr_max);

    // ---- sparkline: one point per second (gap while not live), y range follows the data
    if (t >= _NextChart_ms) {
        _NextChart_ms = t + 1000;
        lv_chart_set_next_value(_Chart, _Ser, hr_live ? v.hr : LV_CHART_POINT_NONE);
        lv_coord_t *ys = lv_chart_get_y_array(_Chart, _Ser);
        int lo = 1000, hi = -1000;
        for (int i = 0; i < CHART_N; i++) {
            if (ys[i] == LV_CHART_POINT_NONE) continue;
            if (ys[i] < lo) lo = ys[i];
            if (ys[i] > hi) hi = ys[i];
        }
        if (hi < lo) { lo = 60; hi = 100; }
        if (hi - lo < 20) { const int m = (hi + lo) / 2; lo = m - 10; hi = m + 10; }
        lv_chart_set_range(_Chart, LV_CHART_AXIS_PRIMARY_Y, (lv_coord_t)(lo - 5), (lv_coord_t)(hi + 5));
        lv_chart_set_series_color(_Chart, _Ser, lv_color_hex(st == ST_ALERT ? C_RED : C_TEAL));
        lv_chart_refresh(_Chart);
    }

    // ---- QR screen: refresh every 2 s while shown
    if (_ShowQr && t >= _NextQr_ms) {
        _NextQr_ms = t + 2000;
        build_qr(&v, hr_live, sp_live, secs);
        lv_qrcode_update(_Qr, _QrText, (uint32_t)strlen(_QrText));
    }
    if (_ShowQr) {
        if (hr_live) put(7, _QHr, hr_crit ? 0xDC2626 : 0x111823, "%d", v.hr);
        else put(7, _QHr, 0x9CA3AF, "--");
        if (sp_live) put(8, _QSp, sp_crit ? 0xDC2626 : 0x0E7490, "%d", v.spo2);
        else put(8, _QSp, 0x9CA3AF, "--");
    }
}
