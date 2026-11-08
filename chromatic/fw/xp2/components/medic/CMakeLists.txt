cmake_minimum_required(VERSION 3.22)

idf_component_register(SRCS "medic.c" "medic_hw.c" "vitals.c"
                    INCLUDE_DIRS "."
                    REQUIRES lvgl button
                    PRIV_REQUIRES console mbedtls esp_timer nvs_flash)
