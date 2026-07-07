#pragma once

#include <Arduino.h>

// Set to 1 and recompile only after changing the physical panel to GDEM0397F81.
// A build flag may override this value for compile verification.
#ifndef FRIDGE_USE_GDEM0397F81
#define FRIDGE_USE_GDEM0397F81 0
#endif

#if FRIDGE_USE_GDEM0397F81
static const char* PANEL_PROFILE = "gdem0397f81";
#else
static const char* PANEL_PROFILE = "gdem075f52";
#endif

static const char* DEVICE_NAME = "XianZhi Tie C3";
static const char* PROVISIONING_AP_PREFIX = "XianZhiTie-";
static const char* DEFAULT_API_BASE_URL = "http://192.168.0.2:8788";

// Hold the BOOT button while resetting to clear setup data and reopen the portal.
static const int CONFIG_BUTTON_PIN = 0;

static const uint16_t DISPLAY_WIDTH = 800;
static const uint16_t DISPLAY_HEIGHT = 480;
static const uint16_t DISPLAY_BYTES_PER_ROW = (DISPLAY_WIDTH + 3) / 4;
static const size_t DISPLAY_IMAGE_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_HEIGHT;
// ESP32-C3 Super Mini normally has no PSRAM. Keep the GxEPD2 page buffer small
// so Wi-Fi, FFat, and chunked native-frame drawing fit in internal SRAM.
static const uint16_t DISPLAY_PAGE_HEIGHT = 30;
static const uint16_t DISPLAY_DRAW_CHUNK_ROWS = 20;
static const size_t DISPLAY_DRAW_CHUNK_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_DRAW_CHUNK_ROWS;

static const char* IMAGE_PATH = "/fridge4c.bin";
static const char* TEMP_IMAGE_PATH = "/fridge4c.tmp";
static const char* BACKUP_IMAGE_PATH = "/fridge4c.bak";

static const uint64_t REFRESH_INTERVAL_US = 30ULL * 60ULL * 1000000ULL;
static const uint64_t FIRST_SETUP_RETRY_INTERVAL_US = 2ULL * 60ULL * 1000000ULL;
static const uint32_t WIFI_TIMEOUT_MS = 20000;
static const uint32_t DOWNLOAD_TIMEOUT_MS = 25000;
static const uint32_t WIFI_FAILURE_PORTAL_TIMEOUT_MS = 10UL * 60UL * 1000UL;
static const uint32_t SERIAL_BOOT_DELAY_MS = 2500;
static const uint32_t SERIAL_SLEEP_DELAY_MS = 750;
static const uint32_t SERIAL_BAUD_RATE = 115200;

// Local development commonly uses HTTP. When later using HTTPS, provision a
// trusted endpoint or replace this prototype setting with CA validation.
static const bool ALLOW_INSECURE_HTTPS = true;
