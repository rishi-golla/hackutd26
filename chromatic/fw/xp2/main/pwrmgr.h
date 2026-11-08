#pragma once

#include <stdbool.h>
#include <stdint.h>

void PwrMgr_Task(void *arg);
void PwrMgr_TriggerLightSleep(void);
void PwrMgr_IdleTimerPet(void);
bool PwrMgr_IsLPMActive(void);
void PwrMgr_SetLPM(const bool Active);
void PwrMgr_InhibitSleep(const uint32_t ms);
int64_t PwrMgr_InhibitRemaining_ms(void);
