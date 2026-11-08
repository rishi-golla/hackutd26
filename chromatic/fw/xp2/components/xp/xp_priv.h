#pragma once

#include "xp.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define XP_OUT_BUDGET 3800   // bytes per command (keep < ~4 KB)

extern XP_Hooks_t g_xp_hooks;

void xp_awake(uint32_t ms);
void xp_print_mac(const uint8_t *mac);          // prints aa:bb:cc:dd:ee:ff (no quotes)
void xp_print_hexstr(const uint8_t *p, size_t n);
void xp_print_escaped(const uint8_t *p, size_t n);   // JSON-safe, non-printables as \xHH
bool xp_parse_hex_bytes(const char *s, uint8_t *out, size_t cap, size_t *len);

void xp_register_radio_cmds(void);
void xp_register_fpga_cmds(void);
void xp_register_mwifi_cmds(void);
void xp_register_csi_cmds(void);      // xp2: xp_csi.c
void xp_register_blehid_cmds(void);   // xp2: xp_blehid.c
void xp_register_blelog_cmds(void);   // xp2: xp_blelog.c
void xp_register_blehr_cmds(void);
void xp_register_boot_cmds(void);    // xp2: xp_blehr.c
void xp_register_sign_cmds(void);     // xp2: xp_sign.c

bool xp_mwifi_active(void);     // softAP (mwifi) owns the Wi-Fi driver
void xp_radio_all_down(void);   // tear down the per-command STA/BLE stacks
bool xp_bl_take(int level);   // xp2: override + set backlight 0..15
void xp_bl_release(void);     // xp2: end override, stock level restored
bool xp_blehr_active(void);    // xp2: blehr owns NimBLE (mauto then advertises on that stack)
bool xp_blelog_start_bg(int sec);   // xp2: blelog in a task (record + MSG/ACK server)
