// fw/xp: experiment console commands for the ModRetro Chromatic ESP32 (sensors, GPIO, console, heap).
// Radio commands live in xp_radio.c, FPGA tap/cmd in xp_fpga.c.
// Every command prints one JSON-ish line per result, keeps output < ~4 KB and yields with vTaskDelay(1).

#include "xp_priv.h"

#include "driver/gpio.h"
#include "driver/i2s_std.h"
#include "driver/rtc_io.h"
#include "driver/touch_pad.h"
#include "driver/uart.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_console.h"
#include "esp_heap_caps.h"
#include "esp_rom_sys.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "soc/gpio_reg.h"
#include "soc/sens_reg.h"
#include "soc/soc.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>

XP_Hooks_t g_xp_hooks;

// Pins the board uses (board.h + console) and in-package flash / UART0. Never reconfigured by xp
// (except i2sprobe, which only makes 33/25/26 inputs).
//   board.h: 5,18,19,21,22,23 (QSPI) 9,10 (UART1 FPGA) 25,26,27,33 (I2S) 35,36 (console cfg)
//   UART0 console: 1,3   in-package flash: 6,7,8,11,16,17
static const int kSkipPins[] = {1, 3, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 33, 35, 36};
// Candidate unused pads on ESP32 (QFN48). 34,37,38,39 are input-only without internal pulls.
static const int kScanPins[] = {0, 2, 4, 12, 13, 14, 15, 32, 34, 37, 38, 39};

static void print_skip_list(void)
{
    printf("[");
    for (size_t i = 0; i < sizeof(kSkipPins) / sizeof(kSkipPins[0]); i++)
    {
        printf("%s%d", i ? "," : "", kSkipPins[i]);
    }
    printf("]");
}

void xp_awake(uint32_t ms)
{
    if (g_xp_hooks.inhibit_sleep != NULL)
    {
        g_xp_hooks.inhibit_sleep(ms);
    }
}

void xp_print_mac(const uint8_t *mac)
{
    printf("%02x:%02x:%02x:%02x:%02x:%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

void xp_print_hexstr(const uint8_t *p, size_t n)
{
    for (size_t i = 0; i < n; i++)
    {
        printf("%02x", p[i]);
    }
}

void xp_print_escaped(const uint8_t *p, size_t n)
{
    for (size_t i = 0; i < n; i++)
    {
        const uint8_t c = p[i];
        if (c >= 0x20 && c < 0x7f && c != '"' && c != '\\')
        {
            putchar(c);
        }
        else
        {
            printf("\\x%02x", c);
        }
    }
}

bool xp_parse_hex_bytes(const char *s, uint8_t *out, size_t cap, size_t *len)
{
    *len = 0;
    if (s == NULL)
    {
        return false;
    }
    if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X'))
    {
        s += 2;
    }
    if (strcmp(s, "-") == 0)
    {
        return true;   // "-" = empty
    }
    const size_t n = strlen(s);
    if ((n % 2) != 0 || (n / 2) > cap)
    {
        return false;
    }
    for (size_t i = 0; i < n; i += 2)
    {
        if (!isxdigit((unsigned char)s[i]) || !isxdigit((unsigned char)s[i + 1]))
        {
            return false;
        }
        char b[3] = {s[i], s[i + 1], 0};
        out[(*len)++] = (uint8_t)strtoul(b, NULL, 16);
    }
    return true;
}

// ------------------------------------------------------------------------------------------------ heap
static void print_caps(const char *name, uint32_t caps)
{
    printf("{\"cmd\":\"heap\",\"caps\":\"%s\",\"free\":%u,\"largest\":%u,\"min_free\":%u,\"total\":%u}\n", name,
           (unsigned)heap_caps_get_free_size(caps), (unsigned)heap_caps_get_largest_free_block(caps),
           (unsigned)heap_caps_get_minimum_free_size(caps), (unsigned)heap_caps_get_total_size(caps));
}

static int cmd_heap(int argc, char **argv)
{
    (void)argc; (void)argv;
    print_caps("internal", MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    print_caps("dma", MALLOC_CAP_DMA);
    print_caps("8bit", MALLOC_CAP_8BIT);
    print_caps("32bit_iram", MALLOC_CAP_32BIT | MALLOC_CAP_EXEC);
    printf("{\"cmd\":\"heap\",\"esp_free\":%u,\"esp_min_free\":%u,\"tasks\":%u,\"console_stack_hwm\":%u}\n",
           (unsigned)esp_get_free_heap_size(), (unsigned)esp_get_minimum_free_heap_size(),
           (unsigned)uxTaskGetNumberOfTasks(), (unsigned)uxTaskGetStackHighWaterMark(NULL));
    return 0;
}

// ------------------------------------------------------------------------------------------------ bench
static int cmd_bench(int argc, char **argv)
{
    int kb = (argc >= 2) ? atoi(argv[1]) : 8;
    const bool raw = (argc >= 3) && (strcmp(argv[2], "raw") == 0);
    if (kb < 1) kb = 1;
    if (kb > 256) kb = 256;
    xp_awake(kb * 1000 + 30000);

    char line[64];
    const size_t total = (size_t)kb * 1024;
    fflush(stdout);
    uart_wait_tx_done(CONFIG_ESP_CONSOLE_UART_NUM, pdMS_TO_TICKS(1000));
    const int64_t t0 = esp_timer_get_time();
    for (size_t off = 0, n = 0; off < total; off += sizeof(line), n++)
    {
        // 63 chars + '\n': "B" + 6-digit line no + pattern
        int k = snprintf(line, sizeof(line), "B%06u ", (unsigned)n);
        for (; k < 63; k++)
        {
            line[k] = (char)('A' + ((n + k) % 26));
        }
        line[63] = '\n';
        if (raw)
        {
            uart_write_bytes(CONFIG_ESP_CONSOLE_UART_NUM, line, sizeof(line));
        }
        else
        {
            fwrite(line, 1, sizeof(line), stdout);
        }
        if ((off % 16384) == 16320)
        {
            vTaskDelay(1);   // UART writes block (and yield) anyway; this is belt and braces
        }
    }
    fflush(stdout);
    uart_wait_tx_done(CONFIG_ESP_CONSOLE_UART_NUM, pdMS_TO_TICKS(30000));
    const int64_t us = esp_timer_get_time() - t0;
    const double bps = us > 0 ? (double)total * 1e6 / (double)us : 0;
    printf("{\"cmd\":\"bench\",\"mode\":\"%s\",\"bytes\":%u,\"us\":%lld,\"Bps\":%.0f,\"baud_equiv_8N1\":%.0f}\n",
           raw ? "raw" : "vfs", (unsigned)total, (long long)us, bps, bps * 10.0);
    return 0;
}

// ------------------------------------------------------------------------------------------------ hall
static int cmd_hall(int argc, char **argv)
{
    (void)argc; (void)argv;
    printf("{\"cmd\":\"hall\",\"supported\":false,\"reason\":\"hall_sensor_read()/adc1 hall API was removed in ESP-IDF v5.0 "
           "(not in v5.3). The ESP32 hall sensor is read through the SENSOR_VP/VN pads = GPIO36/GPIO39 via ADC1 ch0/ch3; "
           "GPIO36 is in the board.h/console skip list, so a register-level hack was not attempted.\"}\n");
    return 0;
}

// ------------------------------------------------------------------------------------------------ temp
// ESP32 classic has an undocumented, uncalibrated on-die temperature sensor (SENS_SAR_TSENS_*).
// IDF v5 dropped temprature_sens_read(); this reproduces its register sequence.
static int cmd_temp(int argc, char **argv)
{
    int samples = (argc >= 2) ? atoi(argv[1]) : 8;
    if (samples < 1) samples = 1;
    if (samples > 64) samples = 64;

    const uint32_t saved_wait2 = REG_READ(SENS_SAR_MEAS_WAIT2_REG);
    const uint32_t saved_tsens = REG_READ(SENS_SAR_TSENS_CTRL_REG);

    unsigned sum = 0, mn = 255, mx = 0;
    for (int i = 0; i < samples; i++)
    {
        SET_PERI_REG_BITS(SENS_SAR_MEAS_WAIT2_REG, SENS_FORCE_XPD_SAR, 3, SENS_FORCE_XPD_SAR_S);
        SET_PERI_REG_BITS(SENS_SAR_TSENS_CTRL_REG, SENS_TSENS_CLK_DIV, 10, SENS_TSENS_CLK_DIV_S);
        CLEAR_PERI_REG_MASK(SENS_SAR_TSENS_CTRL_REG, SENS_TSENS_POWER_UP);
        CLEAR_PERI_REG_MASK(SENS_SAR_TSENS_CTRL_REG, SENS_TSENS_DUMP_OUT);
        SET_PERI_REG_MASK(SENS_SAR_TSENS_CTRL_REG, SENS_TSENS_POWER_UP_FORCE);
        SET_PERI_REG_MASK(SENS_SAR_TSENS_CTRL_REG, SENS_TSENS_POWER_UP);
        esp_rom_delay_us(100);
        SET_PERI_REG_MASK(SENS_SAR_TSENS_CTRL_REG, SENS_TSENS_DUMP_OUT);
        esp_rom_delay_us(5);
        const unsigned raw = GET_PERI_REG_BITS2(SENS_SAR_SLAVE_ADDR3_REG, SENS_TSENS_OUT, SENS_TSENS_OUT_S);
        sum += raw;
        if (raw < mn) mn = raw;
        if (raw > mx) mx = raw;
        vTaskDelay(1);
    }

    REG_WRITE(SENS_SAR_TSENS_CTRL_REG, saved_tsens);
    REG_WRITE(SENS_SAR_MEAS_WAIT2_REG, saved_wait2);

    const float avg = (float)sum / (float)samples;
    printf("{\"cmd\":\"temp\",\"supported\":\"undocumented\",\"samples\":%d,\"raw_avg\":%.1f,\"raw_min\":%u,\"raw_max\":%u,"
           "\"approx_c\":%.1f,\"note\":\"ESP32 has no official temp sensor; raw TSENS_OUT is uncalibrated (old Arduino formula "
           "(raw-32)/1.8 assumes F). raw=128 constant means sensor not responding. Use only for relative change.\"}\n",
           samples, avg, mn, mx, (avg - 32.0f) / 1.8f);
    return 0;
}

// ------------------------------------------------------------------------------------------------ touch
static const int kTouchGpio[TOUCH_PAD_MAX] = {4, 0, 2, 15, 13, 12, 14, 27, 33, 32};   // T0..T9

static bool pin_is_skipped(int gpio)
{
    for (size_t i = 0; i < sizeof(kSkipPins) / sizeof(kSkipPins[0]); i++)
    {
        if (kSkipPins[i] == gpio)
        {
            return true;
        }
    }
    return false;
}

static int cmd_touch(int argc, char **argv)
{
    int samples = (argc >= 2) ? atoi(argv[1]) : 16;
    if (samples < 1) samples = 1;
    if (samples > 256) samples = 256;

    printf("{\"cmd\":\"touch\",\"skipped\":[");
    bool first = true;
    for (int t = 0; t < TOUCH_PAD_MAX; t++)
    {
        if (pin_is_skipped(kTouchGpio[t]))
        {
            printf("%s{\"T\":%d,\"gpio\":%d}", first ? "" : ",", t, kTouchGpio[t]);
            first = false;
        }
    }
    printf("]}\n");

    esp_err_t err = touch_pad_init();
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"touch\",\"error\":\"touch_pad_init %s\"}\n", esp_err_to_name(err));
        return 1;
    }
    touch_pad_set_fsm_mode(TOUCH_FSM_MODE_SW);
    touch_pad_set_voltage(TOUCH_HVOLT_2V7, TOUCH_LVOLT_0V5, TOUCH_HVOLT_ATTEN_1V);

    for (int t = 0; t < TOUCH_PAD_MAX; t++)
    {
        if (pin_is_skipped(kTouchGpio[t]))
        {
            continue;
        }
        err = touch_pad_config((touch_pad_t)t, 0);
        if (err != ESP_OK)
        {
            printf("{\"cmd\":\"touch\",\"T\":%d,\"gpio\":%d,\"error\":\"%s\"}\n", t, kTouchGpio[t], esp_err_to_name(err));
            continue;
        }
        uint32_t sum = 0, mn = 0xFFFF, mx = 0, zeros = 0;
        for (int i = 0; i < samples; i++)
        {
            uint16_t v = 0;
            (void)touch_pad_read((touch_pad_t)t, &v);   // returns INVALID_STATE when v == 0
            if (v == 0) zeros++;
            sum += v;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
            if ((i & 7) == 7) vTaskDelay(1);
        }
        printf("{\"cmd\":\"touch\",\"T\":%d,\"gpio\":%d,\"avg\":%lu,\"min\":%lu,\"max\":%lu,\"zeros\":%lu,\"n\":%d}\n", t,
               kTouchGpio[t], (unsigned long)(sum / samples), (unsigned long)mn, (unsigned long)mx, (unsigned long)zeros,
               samples);
    }

    touch_pad_deinit();
    for (int t = 0; t < TOUCH_PAD_MAX; t++)
    {
        if (!pin_is_skipped(kTouchGpio[t]))
        {
            rtc_gpio_deinit((gpio_num_t)kTouchGpio[t]);   // hand the pad back to the digital IO_MUX
        }
    }
    printf("{\"cmd\":\"touch\",\"done\":true,\"hint\":\"lower count = more capacitance (trace/plane/finger); "
           "0 or wildly varying = pin driven or shorted\"}\n");
    return 0;
}

// ------------------------------------------------------------------------------------------------ adc
static int cmd_adc(int argc, char **argv)
{
    int samples = (argc >= 2) ? atoi(argv[1]) : 32;
    if (samples < 2) samples = 2;
    if (samples > 512) samples = 512;

    // ADC1: ch0=36 ch1=37 ch2=38 ch3=39 ch4=32 ch5=33 ch6=34 ch7=35
    static const int kAdcGpio[8] = {36, 37, 38, 39, 32, 33, 34, 35};

    printf("{\"cmd\":\"adc\",\"skipped\":[");
    bool first = true;
    for (int c = 0; c < 8; c++)
    {
        if (pin_is_skipped(kAdcGpio[c]))
        {
            printf("%s{\"ch\":%d,\"gpio\":%d}", first ? "" : ",", c, kAdcGpio[c]);
            first = false;
        }
    }
    printf("],\"note\":\"ADC2 not sampled (conflicts with Wi-Fi)\"}\n");

    adc_oneshot_unit_handle_t unit = NULL;
    const adc_oneshot_unit_init_cfg_t ucfg = {.unit_id = ADC_UNIT_1, .ulp_mode = ADC_ULP_MODE_DISABLE};
    esp_err_t err = adc_oneshot_new_unit(&ucfg, &unit);
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"adc\",\"error\":\"new_unit %s\"}\n", esp_err_to_name(err));
        return 1;
    }
    adc_cali_handle_t cali = NULL;
    const adc_cali_line_fitting_config_t ccfg = {.unit_id = ADC_UNIT_1, .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT};
    const bool have_cali = (adc_cali_create_scheme_line_fitting(&ccfg, &cali) == ESP_OK);

    for (int c = 0; c < 8; c++)
    {
        if (pin_is_skipped(kAdcGpio[c]))
        {
            continue;
        }
        const adc_oneshot_chan_cfg_t chcfg = {.atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT};
        err = adc_oneshot_config_channel(unit, (adc_channel_t)c, &chcfg);
        if (err != ESP_OK)
        {
            printf("{\"cmd\":\"adc\",\"ch\":%d,\"gpio\":%d,\"error\":\"%s\"}\n", c, kAdcGpio[c], esp_err_to_name(err));
            continue;
        }
        int32_t sum = 0, mn = 4096, mx = -1;
        int64_t sq = 0;
        int ok = 0;
        for (int i = 0; i < samples; i++)
        {
            int v = 0;
            if (adc_oneshot_read(unit, (adc_channel_t)c, &v) == ESP_OK)
            {
                ok++;
                sum += v;
                sq += (int64_t)v * v;
                if (v < mn) mn = v;
                if (v > mx) mx = v;
            }
            if ((i & 15) == 15) vTaskDelay(1);
        }
        if (ok == 0)
        {
            printf("{\"cmd\":\"adc\",\"ch\":%d,\"gpio\":%d,\"error\":\"no reads\"}\n", c, kAdcGpio[c]);
            continue;
        }
        const float avg = (float)sum / ok;
        float var = (float)sq / ok - avg * avg;
        if (var < 0) var = 0;
        int mv = -1;
        if (have_cali)
        {
            (void)adc_cali_raw_to_voltage(cali, (int)(avg + 0.5f), &mv);
        }
        // Heuristic: floating pins wander/large spread; driven pins are tight.
        const char *verdict = (mx - mn) > 200 ? "floating?" : ((mx - mn) < 40 ? "driven/stable" : "noisy");
        printf("{\"cmd\":\"adc\",\"ch\":%d,\"gpio\":%d,\"avg\":%.1f,\"min\":%ld,\"max\":%ld,\"var\":%.1f,\"mv\":%d,\"n\":%d,\"verdict\":\"%s\"}\n",
               c, kAdcGpio[c], avg, (long)mn, (long)mx, var, mv, ok, verdict);
    }
    if (have_cali)
    {
        adc_cali_delete_scheme_line_fitting(cali);
    }
    adc_oneshot_del_unit(unit);
    return 0;
}

// ------------------------------------------------------------------------------------------------ gpioscan
static inline int fast_level(int gpio)
{
    return (gpio < 32) ? ((REG_READ(GPIO_IN_REG) >> gpio) & 1) : ((REG_READ(GPIO_IN1_REG) >> (gpio - 32)) & 1);
}

static unsigned count_edges(int gpio, unsigned reads)
{
    unsigned edges = 0;
    int last = fast_level(gpio);
    for (unsigned i = 0; i < reads; i++)
    {
        const int l = fast_level(gpio);
        edges += (l != last);
        last = l;
    }
    return edges;
}

static void pin_input(int gpio, gpio_pull_mode_t pull)
{
    gpio_config_t cfg = {
        .pin_bit_mask = BIT64(gpio),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = (pull == GPIO_PULLUP_ONLY) ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
        .pull_down_en = (pull == GPIO_PULLDOWN_ONLY) ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&cfg);
    esp_rom_delay_us(300);   // ~45 kOhm internal pull vs pad capacitance: settle
}

static int cmd_gpioscan(int argc, char **argv)
{
    (void)argc; (void)argv;
    printf("{\"cmd\":\"gpioscan\",\"skipped\":");
    print_skip_list();
    printf(",\"note\":\"inputs only, never outputs. 12-15 lose JTAG function until reset\"}\n");

    for (size_t i = 0; i < sizeof(kScanPins) / sizeof(kScanPins[0]); i++)
    {
        const int g = kScanPins[i];
        const bool has_pulls = GPIO_IS_VALID_OUTPUT_GPIO(g);   // 34..39 are input-only, no pulls

        pin_input(g, GPIO_FLOATING);
        const int lf = gpio_get_level(g);
        const unsigned edges = count_edges(g, 20000);

        if (has_pulls)
        {
            pin_input(g, GPIO_PULLUP_ONLY);
            const int lu = gpio_get_level(g);
            pin_input(g, GPIO_PULLDOWN_ONLY);
            const int ld = gpio_get_level(g);
            const char *v = (lu == 1 && ld == 0) ? "floating"
                          : (lu == 1 && ld == 1) ? "driven_high"
                          : (lu == 0 && ld == 0) ? "driven_low" : "odd";
            if (edges > 4) v = "toggling";
            printf("{\"cmd\":\"gpioscan\",\"gpio\":%d,\"float\":%d,\"pu\":%d,\"pd\":%d,\"edges20k\":%u,\"verdict\":\"%s\"}\n",
                   g, lf, lu, ld, edges, v);
        }
        else
        {
            printf("{\"cmd\":\"gpioscan\",\"gpio\":%d,\"float\":%d,\"pulls\":\"none(input-only pad)\",\"edges20k\":%u,\"verdict\":\"%s\"}\n",
                   g, lf, edges, edges > 4 ? "toggling" : "static");
        }
        // Leave the pad as a floating, input-disabled GPIO.
        gpio_set_pull_mode(g, GPIO_FLOATING);
        gpio_set_direction(g, GPIO_MODE_DISABLE);
        vTaskDelay(1);
    }
    return 0;
}

// ------------------------------------------------------------------------------------------------ i2sprobe
// board.h names are MCU-relative: BCLK33 WS25 DIN26 (FPGA->MCU data) DOUT27. Stock firmware never
// initialises I2S, so neither side is a configured clock master in stock; probing as an RX *slave*
// makes the ESP32 pins pure inputs, which is safe whichever way the FPGA has them. DOUT27 untouched.
static int cmd_i2sprobe(int argc, char **argv)
{
    int ms = (argc >= 2) ? atoi(argv[1]) : 1000;
    if (ms < 100) ms = 100;
    if (ms > 10000) ms = 10000;
    xp_awake(ms + 10000);

    static const int pins[3] = {33, 25, 26};
    static const char *names[3] = {"bclk33", "ws25", "din26"};
    printf("{\"cmd\":\"i2sprobe\",\"phase\":\"gpio_edges\"");
    for (int i = 0; i < 3; i++)
    {
        pin_input(pins[i], GPIO_FLOATING);
        printf(",\"%s\":{\"level\":%d,\"edges20k\":%u}", names[i], gpio_get_level(pins[i]), count_edges(pins[i], 20000));
    }
    printf("}\n");

    i2s_chan_handle_t rx = NULL;
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_SLAVE);
    esp_err_t err = i2s_new_channel(&chan_cfg, NULL, &rx);
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"i2sprobe\",\"error\":\"new_channel %s\"}\n", esp_err_to_name(err));
        return 1;
    }
    i2s_std_config_t std_cfg = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(44100),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = GPIO_NUM_33,
            .ws = GPIO_NUM_25,
            .dout = I2S_GPIO_UNUSED,
            .din = GPIO_NUM_26,
            .invert_flags = {0},
        },
    };
    err = i2s_channel_init_std_mode(rx, &std_cfg);
    if (err == ESP_OK)
    {
        err = i2s_channel_enable(rx);
    }
    if (err != ESP_OK)
    {
        printf("{\"cmd\":\"i2sprobe\",\"error\":\"init %s\"}\n", esp_err_to_name(err));
        i2s_del_channel(rx);
        return 1;
    }

    int16_t *buf = malloc(1024);
    size_t total = 0, nonzero = 0, reads = 0, timeouts = 0;
    int16_t smin = INT16_MAX, smax = INT16_MIN;
    uint8_t first[16] = {0};
    size_t first_n = 0;
    const int64_t t_end = esp_timer_get_time() + (int64_t)ms * 1000;
    while (buf != NULL && esp_timer_get_time() < t_end)
    {
        size_t got = 0;
        err = i2s_channel_read(rx, buf, 1024, &got, 200);
        if (err == ESP_ERR_TIMEOUT)
        {
            timeouts++;
        }
        if (got > 0)
        {
            reads++;
            if (first_n == 0)
            {
                first_n = got < sizeof(first) ? got : sizeof(first);
                memcpy(first, buf, first_n);
            }
            for (size_t i = 0; i < got / 2; i++)
            {
                if (buf[i] != 0) nonzero++;
                if (buf[i] < smin) smin = buf[i];
                if (buf[i] > smax) smax = buf[i];
            }
            total += got;
        }
        vTaskDelay(1);
    }
    free(buf);
    i2s_channel_disable(rx);
    i2s_del_channel(rx);
    for (int i = 0; i < 3; i++)
    {
        gpio_set_pull_mode(pins[i], GPIO_FLOATING);
        gpio_set_direction(pins[i], GPIO_MODE_DISABLE);
    }

    printf("{\"cmd\":\"i2sprobe\",\"phase\":\"i2s_slave_rx\",\"ms\":%d,\"bytes\":%u,\"reads\":%u,\"timeouts\":%u,"
           "\"nonzero_samples\":%u,\"min\":%d,\"max\":%d,\"first\":\"",
           ms, (unsigned)total, (unsigned)reads, (unsigned)timeouts, (unsigned)nonzero,
           total ? smin : 0, total ? smax : 0);
    xp_print_hexstr(first, first_n);
    printf("\",\"verdict\":\"%s\"}\n", total == 0 ? "no_clock (FPGA not driving BCLK/WS)" : (nonzero ? "clock+data" : "clock, data all zero"));
    return 0;
}

// ------------------------------------------------------------------------------------------------ register
static void reg(const char *name, const char *help, esp_console_cmd_func_t fn)
{
    const esp_console_cmd_t c = {.command = name, .help = help, .func = fn};
    esp_console_cmd_register(&c);
}

void XP_Init(const XP_Hooks_t *pHooks)
{
    if (pHooks != NULL)
    {
        g_xp_hooks = *pHooks;
    }
    reg("heap", "xp: free/largest/min heap per caps", cmd_heap);
    reg("bench", "xp: bench [KB=8] [vfs|raw] - console throughput", cmd_bench);
    reg("hall", "xp: hall sensor (not available in IDF 5.3, prints why)", cmd_hall);
    reg("temp", "xp: temp [samples] - undocumented ESP32 TSENS raw", cmd_temp);
    reg("touch", "xp: touch [samples] - raw touch counts on unused T-pads", cmd_touch);
    reg("adc", "xp: adc [samples] - ADC1 on unused pins", cmd_adc);
    reg("gpioscan", "xp: input level of unused GPIOs (float/pull-up/pull-down)", cmd_gpioscan);
    reg("i2sprobe", "xp: i2sprobe [ms=1000] - I2S slave RX on BCLK33/WS25/DIN26", cmd_i2sprobe);
    xp_register_radio_cmds();
    xp_register_fpga_cmds();
    xp_register_mwifi_cmds();
    xp_register_csi_cmds();
    xp_register_blehid_cmds();
    xp_register_blelog_cmds();
    xp_register_blehr_cmds();
    xp_register_sign_cmds();
    xp_register_boot_cmds();
}
