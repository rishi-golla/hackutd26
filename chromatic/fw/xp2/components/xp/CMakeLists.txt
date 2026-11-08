cmake_minimum_required(VERSION 3.22)

idf_component_register(SRCS "xp.c" "xp_fpga.c" "xp_radio.c" "xp_mwifi.c" "xp_csi.c" "xp_blehid.c" "xp_blelog.c" "xp_blehr.c" "xp_sign.c" "xp_boot.c"
                    INCLUDE_DIRS "."
                    PRIV_REQUIRES console esp_timer esp_wifi esp_event esp_adc bt driver
                                  esp_driver_gpio esp_driver_i2s esp_driver_uart heap soc
                                  esp_netif esp_http_server lwip mbedtls nvs_flash)
