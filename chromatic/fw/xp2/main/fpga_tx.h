#pragma once

#include <stddef.h>
#include <stdint.h>

typedef enum {
    kFPGA_TxConsts_BufferSize = 1024,    // [bytes]
} FPGA_TxConsts_t;

void FPGA_TxTask(void *arg);
void FPGA_Tx_Resume(void);
void FPGA_Tx_Pause(void);
void FPGA_Tx_SendAll(void);
void FPGA_Tx_WriteBrightness(void);
void FPGA_Tx_SendSysCtl(void);
void FPGA_Tx_PokeButtons(void);
void FPGA_Tx_WritePaletteStyle(void);
void FPGA_Tx_WriteColorTemp(void);
size_t FPGA_Tx_SendRaw(uint8_t ID, uint16_t Payload16, uint8_t *pOut, size_t OutCap);   // XP
