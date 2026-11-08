#pragma once
// fw/xp experiment console commands (see XP_README.md).

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    // Build a system-monitor frame with the stock SetupTxBuffer framing, write it to UART1,
    // copy the frame into out (if not NULL) and return its size (0 = rejected).
    size_t (*fpga_send_raw)(uint8_t id, uint16_t payload16, uint8_t *out, size_t out_cap);
    // Keep the MCU out of light sleep for at least ms.
    void (*inhibit_sleep)(uint32_t ms);
    // Ask the stock TX task to re-send the saved brightness level (FPGA_Tx_WriteBrightness).
    void (*backlight_restore)(void);
    // Medic handoff summary for the captive portal (Medic_BuildSummary). Returns length.
    int (*build_summary)(char *out, size_t cap);
    // xp2: full mlog text (MLOG BEGIN ... base= / E lines / MLOG END head=) into out (Medic_DumpLog). Returns length.
    int (*dump_log)(char *out, size_t cap);
    // xp2: external vital sign (kind 1 = HR bpm) -> medic UI; log=true appends a VITAL event (Medic_NoteVital).
    void (*note_vital)(int kind, int value, bool log);
    // xp2: RED-tag count, live BLE HR (-1 = none), unix time (0 = unknown) for the mauto pre-alert watcher.
    void (*auto_status)(int *red, int *hr, int *spo2, uint32_t *unix_now);
    // xp2: BLE MSG/ACK (Medic_PostMsg / Medic_MsgAckMs)
    int (*post_msg)(const char *text);
    int (*msg_ack_ms)(void);
    void (*log_arrival)(int site);   // xp2: mwatch
} XP_Hooks_t;

// True while bl/blseq own the backlight: main/fpga_tx.c skips its own brightness writes and
// main/fpga_rx.c skips Brightness_Update() from FPGA readback (so nothing is saved to NVS).
bool XP_BacklightOverride(void);

// Registers all xp console commands. Call before esp_console_start_repl().
void XP_Init(const XP_Hooks_t *pHooks);
void XP_BootAuto(void);   // standalone mode at power-on if `mboot on` (NVS xpboot/on)
bool XP_BootEnabled(void);

// xp2: ECDSA P-256 (device key in NVS xpsign/sk) over SHA-256(msg); DER into out, returns length (0 = fail).
size_t XP_SignDer(const uint8_t *msg, size_t n, uint8_t *out, size_t cap);

// ---- FPGA UART tap (called from main/fpga_rx.c, rx task context; cheap when inactive) ----
enum {
    kXpTapErr_Crc = 0,
    kXpTapErr_Len = 1,
};
void XP_TapBytes(size_t n);                              // raw bytes read from UART1
void XP_TapFrame(const uint8_t *raw, size_t len);        // complete, validated frame (header..crc)
void XP_TapError(int kind, const uint8_t *raw, size_t len);
