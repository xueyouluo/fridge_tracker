#pragma once

#include <Arduino.h>

// Select the physical panel before compiling. The legacy
// FRIDGE_USE_GDEM0397F81 flag remains supported for existing build commands.
#define FRIDGE_PANEL_GDEM075F52 0
#define FRIDGE_PANEL_GDEM0397F81 1
#define FRIDGE_PANEL_GDEY042Z98 2

#ifndef FRIDGE_PANEL_TYPE
  #if defined(FRIDGE_USE_GDEM0397F81) && FRIDGE_USE_GDEM0397F81
    #define FRIDGE_PANEL_TYPE FRIDGE_PANEL_GDEM0397F81
  #else
    #define FRIDGE_PANEL_TYPE FRIDGE_PANEL_GDEM075F52
  #endif
#endif

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM0397F81
static const char* PANEL_PROFILE = "gdem0397f81";
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98
static const char* PANEL_PROFILE = "gdey042z98";
#elif FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEM075F52
static const char* PANEL_PROFILE = "gdem075f52";
#else
  #error "Unsupported FRIDGE_PANEL_TYPE"
#endif

static const char* DEVICE_NAME = "XianZhi Tie C3";
static const char* PROVISIONING_AP_PREFIX = "XianZhiTie-";
static const char* DEFAULT_API_BASE_URL = "http://192.168.0.2:8788";
static const uint8_t PROVISIONING_AP_CHANNEL = 1;
static const uint8_t PROVISIONING_AP_MAX_CLIENTS = 4;

// Hold the BOOT button while resetting to clear setup data and reopen the portal.
static const int CONFIG_BUTTON_PIN = 0;

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98
static const uint16_t DISPLAY_WIDTH = 400;
static const uint16_t DISPLAY_HEIGHT = 300;
static const uint16_t DISPLAY_BYTES_PER_ROW = (DISPLAY_WIDTH + 7) / 8;
static const size_t DISPLAY_PLANE_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_HEIGHT;
static const size_t DISPLAY_IMAGE_BYTES = DISPLAY_PLANE_BYTES * 2;
#else
static const uint16_t DISPLAY_WIDTH = 800;
static const uint16_t DISPLAY_HEIGHT = 480;
static const uint16_t DISPLAY_BYTES_PER_ROW = (DISPLAY_WIDTH + 3) / 4;
static const size_t DISPLAY_PLANE_BYTES = 0;
static const size_t DISPLAY_IMAGE_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_HEIGHT;
#endif
// ESP32-C3 Super Mini normally has no PSRAM. Keep the GxEPD2 page buffer small
// so Wi-Fi, FFat, and chunked native-frame drawing fit in internal SRAM.
static const uint16_t DISPLAY_PAGE_HEIGHT = 30;
static const uint16_t DISPLAY_DRAW_CHUNK_ROWS = 20;
static const size_t DISPLAY_DRAW_CHUNK_BYTES = size_t(DISPLAY_BYTES_PER_ROW) * DISPLAY_DRAW_CHUNK_ROWS;

#if FRIDGE_PANEL_TYPE == FRIDGE_PANEL_GDEY042Z98
static const char* IMAGE_PATH = "/fridge3c.bin";
static const char* TEMP_IMAGE_PATH = "/fridge3c.tmp";
static const char* BACKUP_IMAGE_PATH = "/fridge3c.bak";
#else
static const char* IMAGE_PATH = "/fridge4c.bin";
static const char* TEMP_IMAGE_PATH = "/fridge4c.tmp";
static const char* BACKUP_IMAGE_PATH = "/fridge4c.bak";
#endif

static const uint32_t DEFAULT_CHECK_INTERVAL_MINUTES = 30;
static const uint32_t MIN_CHECK_INTERVAL_MINUTES = 5;
static const uint32_t MAX_CHECK_INTERVAL_MINUTES = 24UL * 60UL;
static const uint64_t FIRST_SETUP_RETRY_INTERVAL_US = 2ULL * 60ULL * 1000000ULL;
static const uint32_t WIFI_TIMEOUT_MS = 20000;
static const uint32_t WIFI_MODE_TRANSITION_DELAY_MS = 100;
static const uint32_t WIFI_AP_RETRY_DELAY_MS = 250;
static const uint32_t DOWNLOAD_TIMEOUT_MS = 25000;
static const uint32_t MAX_POWER_ON_PORTAL_TIMEOUT_MS = 10UL * 60UL * 1000UL;
static const uint64_t CONFIG_APPLY_RESTART_DELAY_US = 1ULL * 1000000ULL;
static const uint32_t SERIAL_BOOT_DELAY_MS = 2500;
static const uint32_t SERIAL_SLEEP_DELAY_MS = 750;
static const uint32_t SERIAL_BAUD_RATE = 115200;

// Local development commonly uses HTTP. When later using HTTPS, provision a
// trusted endpoint or replace this prototype setting with CA validation.
static const bool ALLOW_INSECURE_HTTPS = true;
