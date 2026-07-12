#pragma once

#include <Arduino.h>

#if CONFIG_IDF_TARGET_ESP32C3

#define FRIDGE_BOARD_ESP32C3 1
#define FRIDGE_BOARD_ESP32S3 0
#define FRIDGE_BOARD_NAME "ESP32-C3 Super Mini"
#define FRIDGE_DEVICE_NAME "XianZhi Tie C3"

static const int EPD_CS = 7;
static const int EPD_DC = 3;
static const int EPD_RST = 5;
static const int EPD_BUSY = 10;
static const int EPD_SCK = 4;
static const int EPD_MOSI = 6;
static const int EPD_MISO = -1;
static const int CONFIG_BUTTON_PIN = 0;

// The C3 Super Mini normally has no PSRAM, so four-color frames are read from
// FFat in small chunks. Reduced TX power also lowers peak current on this board.
#define FRIDGE_USE_CHUNKED_4C_DRAW 1
#define FRIDGE_LIMIT_WIFI_TX_POWER 1

#elif CONFIG_IDF_TARGET_ESP32S3

#define FRIDGE_BOARD_ESP32C3 0
#define FRIDGE_BOARD_ESP32S3 1
#define FRIDGE_BOARD_NAME "ESP32-S3 N16R8"
#define FRIDGE_DEVICE_NAME "XianZhi Tie S3"

static const int EPD_CS = 10;
static const int EPD_DC = 8;
static const int EPD_RST = 7;
static const int EPD_BUSY = 9;
static const int EPD_SCK = 12;
static const int EPD_MOSI = 11;
static const int EPD_MISO = -1;
static const int CONFIG_BUTTON_PIN = 0;

// Keep the established S3 path: load a four-color frame into PSRAM and pass it
// to drawNative() in one call. Wi-Fi uses the board/core default TX power.
#define FRIDGE_USE_CHUNKED_4C_DRAW 0
#define FRIDGE_LIMIT_WIFI_TX_POWER 0

#else

#error "Unsupported ESP32 target; select an ESP32-C3 or ESP32-S3 board"

#endif
