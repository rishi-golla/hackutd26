#pragma once
// MEDIC mode for the ModRetro Chromatic MCU (research prototype, NOT a medical device).
// Takes over the menu overlay with: arrest/code timer (silent until overdue),
// paediatric weight-based dose card, tap-to-count rate, START triage, QR handoff,
// host<->device messages, and a SHA-256 hash-chained event log over the console.

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "lvgl.h"

void Medic_Init(lv_obj_t *pScreen);   // build UI (hidden) and register console commands
bool Medic_IsActive(void);            // true -> medic UI owns the overlay and buttons
void Medic_Tick(void);                // call from the LVGL timer (every ~20 ms)
void Medic_NoteBattery(float volts, int kind);
int Medic_BuildSummary(char *out, size_t cap);   // thread-safe CMX1|... handoff summary, returns length
// xp2: every decoded FPGA->MCU sysmon word (main/fpga_rx.c ProcessMessage, rx task). Call it BEFORE
// Button_Update so A-edge timing is recorded before the button flag becomes visible to the UI.
void Medic_NoteFpga(uint8_t addr, uint16_t rxdata);
int Medic_DumpLog(char *out, size_t cap);
void Medic_NoteVital(int kind, int value, bool log);   // xp2: external sensor (1 = HR bpm); log -> VITAL event
void Medic_AutoStatus(int *red, int *hr, int *spo2, uint32_t *unix_now);   // xp2: RED count, live BLE HR (-1), unix (0)
int Medic_PostMsg(const char *text);   // xp2: host->crew banner (A acks); logs MSG_RX
int Medic_MsgAckMs(void);              // xp2: arrival->ack ms, -1 if none/unacked
void Medic_LogArrival(int site);        // xp2: ARRIVED event (destination beacon heard)
bool Medic_MenuOpen(void);             // xp2: FPGA sysmon stream fresh (< 800 ms) = Chromatic menu/overlay open
