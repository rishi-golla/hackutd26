#pragma once
// Private interface between medic.c (UI/state) and medic_hw.c (FPGA sysmon decode, A-edge timing).

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    bool valid03, valid05, valid07;
    uint8_t vol;           // 127 - (x & 0x7F); wheel sweeps ~1..107
    uint8_t hp;            // (x >> 7) & 1
    uint8_t bl;            // x >> 8
    uint16_t pmic;         // raw addr 0x05 word
    uint16_t temp_raw;     // raw addr 0x07 word
    int64_t t02_us, t03_us, t05_us, t07_us;   // esp_timer time of the latest packet
    uint32_t n02, n03, n05, n07;              // packets since boot
    uint32_t period_ns;    // current estimate of the addr 0x02 packet period
    bool a_down;           // debounced A state from the 0x02 stream
} MedicHw_t;

typedef struct {
    int64_t us;            // precise time: segment anchor + packet_index * period (esp_timer domain)
    int64_t raw_us;        // esp_timer time when the rx task processed the first packet of the edge
} MedicEdge_t;

void MedicHw_Init(void);
void MedicHw_Get(MedicHw_t *out);
bool MedicHw_PopPress(MedicEdge_t *e);          // debounced A press edges (consumer: medic Tick)
int64_t MedicHw_LastRawAPress_us(void);         // first undebounced A 0->1 packet (set before Button_Update sees it)
void MedicHw_RegisterCmds(void);                // tapsense, mvol

// ---- VITALS mode (vitals.c): one live HR/SpO2 monitor for a single BLE finger sensor
#include "lvgl.h"
#include "button.h"

typedef struct {
    int64_t now_ms;
    int link;            // 0 searching / disconnected, 1 connected, 2 subscribed (Medic_NoteVital kind 10)
    int64_t link_ms;     // when link last changed
    int contact;         // 1 finger on, 0 no finger, -1 unknown (kind 11, sent with every HR packet)
    int64_t pkt_ms;      // last HR packet of any kind (-1 none)
    int hr;              // last valid HR > 0
    int64_t hr_ms;
    int spo2;
    int64_t spo2_ms;
    int64_t sess_ms;     // session start (boot or START)
    int n, hr_min, hr_max, spo2_min;   // session stats over valid readings (-1 = none)
    uint8_t head[4];     // first bytes of the log chain head (tamper evidence in the QR)
} MedicVitals_t;

void Medic_VitalsGet(MedicVitals_t *v);
void Medic_VitalsReset(void);
void Vitals_Init(void);
void Vitals_Tick(void);
void Vitals_Button(Button_t b);
void Vitals_SetVisible(bool on);
