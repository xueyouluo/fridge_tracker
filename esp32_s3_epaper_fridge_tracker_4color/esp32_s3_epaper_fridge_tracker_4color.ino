#include <DNSServer.h>
#include <FFat.h>
#include <FS.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <SPI.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include <GxEPD2_4C.h>
#include <Fonts/FreeMonoBold9pt7b.h>

#include "Config.h"
#include "ProvisioningPage.h"

#define EPD_CS    10
#define EPD_DC    8
#define EPD_RST   7
#define EPD_BUSY  9

#define EPD_SCK   12
#define EPD_MOSI  11
#define EPD_MISO  13

#if FRIDGE_USE_GDEM0397F81
GxEPD2_4C<GxEPD2_397c_GDEM0397F81, GxEPD2_397c_GDEM0397F81::HEIGHT / 2> display(
  GxEPD2_397c_GDEM0397F81(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#else
GxEPD2_4C<GxEPD2_750c_GDEM075F52, GxEPD2_750c_GDEM075F52::HEIGHT / 2> display(
  GxEPD2_750c_GDEM075F52(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#endif

struct DeviceSettings {
  String ssid;
  String password;
  String apiBaseUrl;
  String provisioningKey;
  String claimCode;
  String serial;
  String deviceToken;
  String etag;
};

enum FrameResult {
  FRAME_UPDATED,
  FRAME_UNCHANGED,
  FRAME_FAILED,
  FRAME_NOT_CLAIMED
};

Preferences prefs;
WebServer portalServer(80);
DNSServer dnsServer;
DeviceSettings settings;
uint8_t* imageData = nullptr;
bool restartAfterSave = false;
unsigned long restartAt = 0;
char errorTitle[32] = "Refresh failed";
char errorDetail[52] = "";
char errorHint[52] = "Hold BOOT for setup";

String defaultSerial();
bool loadSettings();
bool settingsReady();
void clearSettings();
bool forceSetupRequested();
void runProvisioningPortal();
String provisioningPageHtml();
String htmlEscape(const String& text);
String jsonEscape(const String& text);
String joinApiUrl(const char* resource);
bool connectWiFi();
bool beginHttp(HTTPClient& http, WiFiClient& client, WiFiClientSecure& secureClient, const String& url);
bool registerDevice();
String jsonStringField(const String& body, const char* key);
FrameResult fetchNativeFrame();
bool storeDownloadedFrame(HTTPClient& http);
bool hasStoredImage();
bool loadImageData();
bool drawStoredImage();
void drawStatusText(const char* line1, const char* line2, const char* line3);
void setError(const char* title, const char* detail, const char* hint);
void sleepForNextCheck(bool fastRetry);

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  delay(SERIAL_BOOT_DELAY_MS);
  Serial.println();
  Serial.println("=== XianZhi Tie four-color e-paper boot ===");

  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);
  SPI.begin(EPD_SCK, EPD_MISO, EPD_MOSI, EPD_CS);
  display.init();
  display.setRotation(1);

  if (!FFat.begin(true)) {
    drawStatusText("Storage failed", "Cannot mount FATFS", "");
    display.hibernate();
    sleepForNextCheck(true);
  }

  imageData = static_cast<uint8_t*>(ps_malloc(DISPLAY_IMAGE_BYTES));
  if (!imageData) {
    imageData = static_cast<uint8_t*>(malloc(DISPLAY_IMAGE_BYTES));
  }
  if (!imageData) {
    drawStatusText("Memory failed", "Frame allocation", "");
    display.hibernate();
    sleepForNextCheck(true);
  }

  loadSettings();
  if (forceSetupRequested()) {
    clearSettings();
    loadSettings();
    runProvisioningPortal();
  }
  if (!settingsReady()) {
    runProvisioningPortal();
  }

  if (!connectWiFi()) {
    if (!hasStoredImage()) {
      drawStatusText("Wi-Fi failed", "Cannot connect", "Hold BOOT for setup");
    }
    display.hibernate();
    sleepForNextCheck(!hasStoredImage());
  }

  if (settings.deviceToken.isEmpty() && !registerDevice()) {
    if (!hasStoredImage()) {
      drawStatusText(errorTitle, errorDetail, errorHint);
    }
    WiFi.disconnect(true);
    WiFi.mode(WIFI_OFF);
    display.hibernate();
    sleepForNextCheck(true);
  }

  FrameResult result = fetchNativeFrame();
  if (result == FRAME_UPDATED) {
    drawStoredImage();
  } else if (result == FRAME_NOT_CLAIMED && !hasStoredImage()) {
    drawStatusText("Pair this display", settings.claimCode.c_str(), "Open tracker H5");
  } else if (result == FRAME_FAILED && !hasStoredImage()) {
    drawStatusText(errorTitle, errorDetail, errorHint);
  } else {
    Serial.println("Retaining the current e-paper image.");
  }

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  display.hibernate();
  sleepForNextCheck(result == FRAME_NOT_CLAIMED && !hasStoredImage());
}

void loop() {
}

String defaultSerial() {
  uint64_t chip = ESP.getEfuseMac();
  char serial[32];
  snprintf(serial, sizeof(serial), "fridge-%04X%08X",
           static_cast<uint16_t>(chip >> 32), static_cast<uint32_t>(chip));
  return String(serial);
}

bool loadSettings() {
  prefs.begin("fridge", true);
  settings.ssid = prefs.getString("ssid", "");
  settings.password = prefs.getString("pass", "");
  settings.apiBaseUrl = prefs.getString("api", DEFAULT_API_BASE_URL);
  settings.provisioningKey = prefs.getString("prov", "");
  settings.claimCode = prefs.getString("claim", "");
  settings.serial = prefs.getString("serial", defaultSerial());
  settings.deviceToken = prefs.getString("token", "");
  settings.etag = prefs.getString("etag", "");
  prefs.end();
  return settingsReady();
}

bool settingsReady() {
  if (settings.ssid.isEmpty() || settings.apiBaseUrl.isEmpty()) {
    return false;
  }
  if (!settings.deviceToken.isEmpty()) {
    return true;
  }
  return !settings.provisioningKey.isEmpty() && !settings.claimCode.isEmpty();
}

void clearSettings() {
  prefs.begin("fridge", false);
  prefs.clear();
  prefs.end();
  FFat.remove(IMAGE_PATH);
  FFat.remove(TEMP_IMAGE_PATH);
  FFat.remove(BACKUP_IMAGE_PATH);
  Serial.println("Provisioning settings cleared.");
}

bool forceSetupRequested() {
  if (digitalRead(CONFIG_BUTTON_PIN) != LOW) {
    return false;
  }
  delay(80);
  return digitalRead(CONFIG_BUTTON_PIN) == LOW;
}

void runProvisioningPortal() {
  String apName = PROVISIONING_AP_PREFIX + settings.serial.substring(max(0, int(settings.serial.length()) - 6));
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str());
  IPAddress portalIp = WiFi.softAPIP();

  Serial.print("Provisioning AP: ");
  Serial.println(apName);
  Serial.print("Portal URL: http://");
  Serial.println(portalIp);

  drawStatusText("Setup required", apName.c_str(), portalIp.toString().c_str());
  display.hibernate();

  dnsServer.start(53, "*", portalIp);
  portalServer.on("/", HTTP_GET, []() {
    portalServer.send(200, "text/html; charset=utf-8", provisioningPageHtml());
  });
  portalServer.on("/save", HTTP_POST, []() {
    String newSsid = portalServer.arg("ssid");
    String newApi = portalServer.arg("api");
    String newPassword = portalServer.arg("password");
    String newClaim = portalServer.arg("claim");
    String newProvisioning = portalServer.arg("provisioning");
    String newToken = portalServer.arg("token");
    newSsid.trim();
    newApi.trim();
    newClaim.trim();
    newClaim.toUpperCase();

    bool identityChanged = newApi != settings.apiBaseUrl || newClaim != settings.claimCode;
    bool keepsRegisteredToken = !settings.deviceToken.isEmpty() && !identityChanged && newToken.isEmpty();
    bool submitsToken = !newToken.isEmpty();
    if (newSsid.isEmpty() || newApi.isEmpty() ||
        (!keepsRegisteredToken && !submitsToken && (newClaim.isEmpty() || newProvisioning.isEmpty()))) {
      portalServer.send(400, "text/plain; charset=utf-8",
        "SSID and server URL are required. Provide a device token, or a binding code and provisioning key.");
      return;
    }

    prefs.begin("fridge", false);
    prefs.putString("ssid", newSsid);
    if (!newPassword.isEmpty()) {
      prefs.putString("pass", newPassword);
    }
    prefs.putString("api", newApi);
    prefs.putString("claim", newClaim);
    prefs.putString("prov", newProvisioning);
    prefs.putString("serial", settings.serial);
    if (!newToken.isEmpty()) {
      prefs.putString("token", newToken);
      prefs.remove("etag");
    } else if (identityChanged) {
      prefs.remove("token");
      prefs.remove("etag");
    }
    prefs.end();
    if (submitsToken || identityChanged) {
      FFat.remove(IMAGE_PATH);
      FFat.remove(TEMP_IMAGE_PATH);
      FFat.remove(BACKUP_IMAGE_PATH);
    }

    portalServer.send_P(200, "text/html; charset=utf-8", PROVISIONING_SAVED_PAGE);
    restartAfterSave = true;
    restartAt = millis() + 1000;
  });
  portalServer.onNotFound([]() {
    portalServer.sendHeader("Location", "/", true);
    portalServer.send(302, "text/plain", "");
  });
  portalServer.begin();

  while (true) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    if (restartAfterSave && millis() >= restartAt) {
      ESP.restart();
    }
    delay(5);
  }
}

String provisioningPageHtml() {
  String page = FPSTR(PROVISIONING_PAGE);
  page.replace("%SSID%", htmlEscape(settings.ssid));
  page.replace("%API%", htmlEscape(settings.apiBaseUrl));
  page.replace("%CLAIM%", htmlEscape(settings.claimCode));
  page.replace("%PANEL%", PANEL_PROFILE);
  page.replace("%SERIAL%", htmlEscape(settings.serial));
  return page;
}

String htmlEscape(const String& text) {
  String escaped = text;
  escaped.replace("&", "&amp;");
  escaped.replace("<", "&lt;");
  escaped.replace(">", "&gt;");
  escaped.replace("\"", "&quot;");
  return escaped;
}

String jsonEscape(const String& text) {
  String escaped = text;
  escaped.replace("\\", "\\\\");
  escaped.replace("\"", "\\\"");
  escaped.replace("\r", "\\r");
  escaped.replace("\n", "\\n");
  return escaped;
}

String joinApiUrl(const char* resource) {
  String url = settings.apiBaseUrl;
  while (url.endsWith("/")) {
    url.remove(url.length() - 1);
  }
  url += resource;
  return url;
}

bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(settings.ssid.c_str(), settings.password.c_str());
  Serial.print("Connecting Wi-Fi");
  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_TIMEOUT_MS) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    setError("Wi-Fi failed", "Cannot connect", "Hold BOOT for setup");
    return false;
  }
  Serial.print("Wi-Fi IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

bool beginHttp(HTTPClient& http, WiFiClient& client, WiFiClientSecure& secureClient, const String& url) {
  if (url.startsWith("https://")) {
    if (ALLOW_INSECURE_HTTPS) {
      secureClient.setInsecure();
    }
    return http.begin(secureClient, url);
  }
  return http.begin(client, url);
}

bool registerDevice() {
  HTTPClient http;
  WiFiClient client;
  WiFiClientSecure secureClient;
  String url = joinApiUrl("/api/device/register");
  if (!beginHttp(http, client, secureClient, url)) {
    setError("Register failed", "HTTP setup error", "Check server URL");
    return false;
  }

  String payload = "{\"serial\":\"" + jsonEscape(settings.serial) +
    "\",\"claimCode\":\"" + jsonEscape(settings.claimCode) +
    "\",\"panel\":\"" + String(PANEL_PROFILE) + "\"}";
  http.setTimeout(DOWNLOAD_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Provisioning-Key", settings.provisioningKey);
  int status = http.sendRequest("POST", payload);
  String body = http.getString();
  http.end();

  if (status != HTTP_CODE_CREATED) {
    char detail[32];
    snprintf(detail, sizeof(detail), "HTTP %d", status);
    setError("Register failed", detail, "Check setup values");
    return false;
  }

  String token = jsonStringField(body, "deviceToken");
  if (token.isEmpty()) {
    setError("Register failed", "Missing token", "Check server");
    return false;
  }

  settings.deviceToken = token;
  settings.etag = "";
  prefs.begin("fridge", false);
  prefs.putString("token", settings.deviceToken);
  prefs.remove("etag");
  prefs.end();
  Serial.println("Device registration completed.");
  return true;
}

String jsonStringField(const String& body, const char* key) {
  String prefix = "\"" + String(key) + "\":\"";
  int start = body.indexOf(prefix);
  if (start < 0) {
    return "";
  }
  start += prefix.length();
  int end = body.indexOf('"', start);
  if (end < 0) {
    return "";
  }
  return body.substring(start, end);
}

FrameResult fetchNativeFrame() {
  HTTPClient http;
  WiFiClient client;
  WiFiClientSecure secureClient;
  String url = joinApiUrl("/api/device/frame.bin?panel=");
  url += PANEL_PROFILE;
  Serial.print("Downloading frame: ");
  Serial.println(url);

  if (!beginHttp(http, client, secureClient, url)) {
    setError("Request failed", "HTTP setup error", "Check server URL");
    return FRAME_FAILED;
  }

  const char* keys[] = { "ETag", "X-Frame-Revision" };
  http.collectHeaders(keys, 2);
  http.setTimeout(DOWNLOAD_TIMEOUT_MS);
  http.addHeader("Authorization", "Bearer " + settings.deviceToken);
  if (!settings.etag.isEmpty()) {
    http.addHeader("If-None-Match", settings.etag);
  }

  int status = http.GET();
  if (status == HTTP_CODE_NOT_MODIFIED) {
    Serial.println("Frame is unchanged.");
    http.end();
    return FRAME_UNCHANGED;
  }
  if (status == HTTP_CODE_CONFLICT) {
    Serial.println("Device is registered but not yet claimed.");
    http.end();
    return FRAME_NOT_CLAIMED;
  }
  if (status != HTTP_CODE_OK) {
    char detail[32];
    snprintf(detail, sizeof(detail), "HTTP %d", status);
    setError("Request failed", detail, "Check server");
    http.end();
    return FRAME_FAILED;
  }

  String newEtag = http.header("ETag");
  if (!storeDownloadedFrame(http)) {
    http.end();
    return FRAME_FAILED;
  }
  http.end();
  if (!newEtag.isEmpty()) {
    settings.etag = newEtag;
    prefs.begin("fridge", false);
    prefs.putString("etag", settings.etag);
    prefs.end();
  }
  return FRAME_UPDATED;
}

bool storeDownloadedFrame(HTTPClient& http) {
  int contentLength = http.getSize();
  if (contentLength >= 0 && contentLength != int(DISPLAY_IMAGE_BYTES)) {
    setError("Image failed", "Wrong frame size", "Check panel");
    return false;
  }

  FFat.remove(TEMP_IMAGE_PATH);
  File temporary = FFat.open(TEMP_IMAGE_PATH, "w");
  if (!temporary) {
    setError("Storage failed", "Cannot write frame", "Check FATFS");
    return false;
  }

  WiFiClient* stream = http.getStreamPtr();
  uint8_t buffer[1024];
  size_t total = 0;
  unsigned long lastDataAt = millis();
  while (http.connected()) {
    size_t available = stream->available();
    if (available == 0) {
      if (contentLength >= 0 && total >= size_t(contentLength)) {
        break;
      }
      if (millis() - lastDataAt > DOWNLOAD_TIMEOUT_MS) {
        temporary.close();
        FFat.remove(TEMP_IMAGE_PATH);
        setError("Request failed", "Download timeout", "Try again later");
        return false;
      }
      delay(10);
      continue;
    }
    size_t toRead = min(available, sizeof(buffer));
    int count = stream->readBytes(buffer, toRead);
    if (count <= 0) {
      break;
    }
    lastDataAt = millis();
    total += count;
    if (total > DISPLAY_IMAGE_BYTES || temporary.write(buffer, count) != size_t(count)) {
      temporary.close();
      FFat.remove(TEMP_IMAGE_PATH);
      setError("Storage failed", "Frame write error", "Check FATFS");
      return false;
    }
  }
  temporary.close();

  if (total != DISPLAY_IMAGE_BYTES) {
    FFat.remove(TEMP_IMAGE_PATH);
    setError("Request failed", "Incomplete frame", "Try again later");
    return false;
  }

  bool hadImage = hasStoredImage();
  FFat.remove(BACKUP_IMAGE_PATH);
  if (hadImage && !FFat.rename(IMAGE_PATH, BACKUP_IMAGE_PATH)) {
    FFat.remove(TEMP_IMAGE_PATH);
    setError("Storage failed", "Cannot backup frame", "Check FATFS");
    return false;
  }
  if (!hadImage) {
    FFat.remove(IMAGE_PATH);
  }
  if (!FFat.rename(TEMP_IMAGE_PATH, IMAGE_PATH)) {
    if (hadImage) {
      FFat.rename(BACKUP_IMAGE_PATH, IMAGE_PATH);
    }
    FFat.remove(TEMP_IMAGE_PATH);
    setError("Storage failed", "Cannot store frame", "Check FATFS");
    return false;
  }
  FFat.remove(BACKUP_IMAGE_PATH);
  Serial.print("Stored frame bytes: ");
  Serial.println(total);
  return true;
}

bool hasStoredImage() {
  File file = FFat.open(IMAGE_PATH, "r");
  if (!file) {
    return false;
  }
  bool valid = file.size() == DISPLAY_IMAGE_BYTES;
  file.close();
  return valid;
}

bool loadImageData() {
  File file = FFat.open(IMAGE_PATH, "r");
  if (!file || file.size() != DISPLAY_IMAGE_BYTES) {
    if (file) {
      file.close();
    }
    return false;
  }
  size_t count = file.read(imageData, DISPLAY_IMAGE_BYTES);
  file.close();
  return count == DISPLAY_IMAGE_BYTES;
}

bool drawStoredImage() {
  if (!loadImageData()) {
    setError("Storage failed", "Cannot read frame", "Try again later");
    return false;
  }
  display.init();
  display.setRotation(0);
  display.drawNative(imageData, nullptr, 0, 0, DISPLAY_WIDTH, DISPLAY_HEIGHT, false, false, false);
  return true;
}

void drawStatusText(const char* line1, const char* line2, const char* line3) {
  display.init();
  display.setRotation(1);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.drawRect(12, 12, 456, 776, GxEPD_BLACK);
    display.fillRect(12, 12, 456, 54, GxEPD_YELLOW);
    display.setFont(&FreeMonoBold9pt7b);
    display.setTextColor(GxEPD_BLACK);
    display.setCursor(24, 47);
    display.print(DEVICE_NAME);
    display.setCursor(30, 196);
    display.print(line1);
    display.setCursor(30, 254);
    display.print(line2);
    display.setCursor(30, 312);
    display.print(line3);
  } while (display.nextPage());
}

void setError(const char* title, const char* detail, const char* hint) {
  snprintf(errorTitle, sizeof(errorTitle), "%s", title);
  snprintf(errorDetail, sizeof(errorDetail), "%s", detail);
  snprintf(errorHint, sizeof(errorHint), "%s", hint);
  Serial.print(title);
  Serial.print(": ");
  Serial.println(detail);
}

void sleepForNextCheck(bool fastRetry) {
  uint64_t interval = fastRetry ? FIRST_SETUP_RETRY_INTERVAL_US : REFRESH_INTERVAL_US;
  Serial.print("Sleeping for seconds: ");
  Serial.println(interval / 1000000ULL);
  Serial.flush();
  delay(SERIAL_SLEEP_DELAY_MS);
  esp_sleep_enable_timer_wakeup(interval);
  esp_deep_sleep_start();
}
