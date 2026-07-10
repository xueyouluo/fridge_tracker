#include <DNSServer.h>
#include <FFat.h>
#include <FS.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <SPI.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_heap_caps.h>
#include <esp_sleep.h>

#include <GxEPD2_4C.h>
#include <Fonts/FreeMonoBold9pt7b.h>

#include "Config.h"
#include "ProvisioningPage.h"

// Pin labels follow the photographed ESP32-C3 Super Mini board silkscreen.
// Avoid GPIO20/GPIO21; on some Super Mini boards wires near the antenna can
// make the provisioning AP difficult to discover.
#define EPD_CS    7
#define EPD_DC    3
#define EPD_RST   5
#define EPD_BUSY  10

#define EPD_SCK   4
#define EPD_MOSI  6
// The e-paper adapter is write-only in this project, so MISO is not wired.
#define EPD_MISO  -1

#if FRIDGE_USE_GDEM0397F81
GxEPD2_4C<GxEPD2_397c_GDEM0397F81, DISPLAY_PAGE_HEIGHT> display(
  GxEPD2_397c_GDEM0397F81(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#else
GxEPD2_4C<GxEPD2_750c_GDEM075F52, DISPLAY_PAGE_HEIGHT> display(
  GxEPD2_750c_GDEM075F52(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY)
);
#endif

struct DeviceSettings {
  String ssid;
  String password;
  String apiBaseUrl;
  String pairingCode;
  String serial;
  String deviceToken;
  String etag;
  uint32_t checkIntervalMinutes;
  bool forceRefreshEveryCheck;
};

enum FrameResult {
  FRAME_UPDATED,
  FRAME_UNCHANGED,
  FRAME_FAILED
};

Preferences prefs;
WebServer portalServer(80);
DNSServer dnsServer;
DeviceSettings settings;
uint8_t imageChunk[DISPLAY_DRAW_CHUNK_BYTES];
bool resumeAfterSave = false;
bool portalRoutesConfigured = false;
unsigned long resumeAt = 0;
char errorTitle[32] = "Refresh failed";
char errorDetail[52] = "";
char errorHint[52] = "Power cycle for setup";

String defaultSerial();
bool loadSettings();
bool settingsReady();
void clearSettings();
bool forceSetupRequested();
bool wokeFromTimer();
uint32_t configuredPortalTimeoutMs();
bool configureWifiRadio();
bool startProvisioningAccessPoint(const String& apName);
bool runProvisioningPortal(uint32_t timeoutMs = 0, bool showInstructions = true);
void stopProvisioningPortal();
void restartForConfigApply();
String provisioningPageHtml();
String scannedWifiOptionsHtml();
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
bool drawStoredImage();
void releaseNetwork();
void logHeap(const char* label);
void drawStatusText(const char* line1, const char* line2, const char* line3, const char* line4 = "");
void setError(const char* title, const char* detail, const char* hint);
void sleepForNextCheck(bool fastRetry, uint64_t elapsedUs = 0);

void setup() {
  Serial.begin(SERIAL_BAUD_RATE);
  delay(SERIAL_BOOT_DELAY_MS);
  Serial.println();
  Serial.println("=== XianZhi Tie C3 four-color e-paper boot ===");
  bool timerWakeup = wokeFromTimer();
  Serial.print("Wake source: ");
  Serial.println(timerWakeup ? "deep-sleep timer" : "power-on/reset");

  pinMode(CONFIG_BUTTON_PIN, INPUT_PULLUP);
  SPI.begin(EPD_SCK, EPD_MISO, EPD_MOSI, EPD_CS);
  display.init();
  display.setRotation(1);
  logHeap("Heap after display init");

  if (!FFat.begin(true)) {
    drawStatusText("Storage failed", "Cannot mount FATFS", "");
    display.hibernate();
    sleepForNextCheck(true);
  }
  logHeap("Heap after FFat mount");

  loadSettings();
  bool provisioningHandled = false;
  if (forceSetupRequested()) {
    clearSettings();
    loadSettings();
    runProvisioningPortal();
    provisioningHandled = true;
  }
  if (!settingsReady()) {
    runProvisioningPortal();
    provisioningHandled = true;
  }
  bool offerPowerOnPortal = !provisioningHandled && !timerWakeup;

  if (!connectWiFi()) {
    bool configSaved = false;
    uint64_t portalElapsedUs = 0;
    if (!timerWakeup) {
      unsigned long portalStartedAt = millis();
      configSaved = runProvisioningPortal(configuredPortalTimeoutMs());
      portalElapsedUs = uint64_t(millis() - portalStartedAt) * 1000ULL;
    }
    releaseNetwork();
    if (configSaved) {
      display.hibernate();
      restartForConfigApply();
    }
    drawStatusText("Wi-Fi failed", "Cannot connect", "Power cycle for setup");
    display.hibernate();
    sleepForNextCheck(!hasStoredImage(), portalElapsedUs);
  }

  if (settings.deviceToken.isEmpty() && !registerDevice()) {
    releaseNetwork();
    bool storedImageAvailable = hasStoredImage();
    uint64_t portalElapsedUs = 0;
    if (offerPowerOnPortal) {
      unsigned long portalStartedAt = millis();
      bool configSaved = runProvisioningPortal(configuredPortalTimeoutMs(), !storedImageAvailable);
      portalElapsedUs = uint64_t(millis() - portalStartedAt) * 1000ULL;
      if (configSaved) {
        restartForConfigApply();
      }
    }
    if (!storedImageAvailable) {
      drawStatusText(errorTitle, errorDetail, errorHint);
    }
    display.hibernate();
    sleepForNextCheck(true, portalElapsedUs);
  }

  FrameResult result = fetchNativeFrame();
  releaseNetwork();
  if (result == FRAME_UPDATED) {
    if (!drawStoredImage()) {
      drawStatusText(errorTitle, errorDetail, errorHint);
    }
  } else if (result == FRAME_UNCHANGED && settings.forceRefreshEveryCheck) {
    Serial.println("Debug refresh enabled; redrawing the cached frame after HTTP 304.");
    if (!drawStoredImage()) {
      drawStatusText(errorTitle, errorDetail, errorHint);
    }
  } else if (result == FRAME_FAILED && !hasStoredImage()) {
    drawStatusText(errorTitle, errorDetail, errorHint);
  } else {
    Serial.println("Retaining the current e-paper image.");
  }

  display.hibernate();
  uint64_t portalElapsedUs = 0;
  if (offerPowerOnPortal) {
    uint32_t portalTimeoutMs = configuredPortalTimeoutMs();
    Serial.print("Opening the post-refresh configuration window for seconds: ");
    Serial.println(portalTimeoutMs / 1000UL);
    unsigned long portalStartedAt = millis();
    if (runProvisioningPortal(portalTimeoutMs, false)) {
      restartForConfigApply();
    }
    portalElapsedUs = uint64_t(millis() - portalStartedAt) * 1000ULL;
  }
  sleepForNextCheck(false, portalElapsedUs);
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
  settings.pairingCode = prefs.getString("pair", "");
  settings.serial = prefs.getString("serial", defaultSerial());
  settings.deviceToken = prefs.getString("token", "");
  settings.etag = prefs.getString("etag", "");
  settings.checkIntervalMinutes = prefs.getUInt("interval", DEFAULT_CHECK_INTERVAL_MINUTES);
  settings.forceRefreshEveryCheck = prefs.getBool("force", false);
  prefs.end();
  if (settings.checkIntervalMinutes < MIN_CHECK_INTERVAL_MINUTES ||
      settings.checkIntervalMinutes > MAX_CHECK_INTERVAL_MINUTES) {
    settings.checkIntervalMinutes = DEFAULT_CHECK_INTERVAL_MINUTES;
  }
  return settingsReady();
}

bool settingsReady() {
  if (settings.ssid.isEmpty() || settings.apiBaseUrl.isEmpty()) {
    return false;
  }
  if (!settings.deviceToken.isEmpty()) {
    return true;
  }
  return !settings.pairingCode.isEmpty();
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

bool wokeFromTimer() {
  return esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER;
}

uint32_t configuredPortalTimeoutMs() {
  uint32_t checkIntervalMs = settings.checkIntervalMinutes * 60UL * 1000UL;
  return checkIntervalMs < MAX_POWER_ON_PORTAL_TIMEOUT_MS
    ? checkIntervalMs
    : MAX_POWER_ON_PORTAL_TIMEOUT_MS;
}

bool configureWifiRadio() {
  WiFi.setSleep(false);
  bool powerSet = WiFi.setTxPower(WIFI_POWER_8_5dBm);
  Serial.print("Wi-Fi reduced TX power: ");
  Serial.println(powerSet ? "set" : "failed");
  return powerSet;
}

bool startProvisioningAccessPoint(const String& apName) {
  for (uint8_t attempt = 1; attempt <= 2; attempt += 1) {
    WiFi.disconnect(true, false);
    delay(WIFI_MODE_TRANSITION_DELAY_MS);

    // AP+STA keeps the setup hotspot online while the portal scans nearby SSIDs.
    bool modeReady = WiFi.mode(WIFI_AP_STA);
    bool powerSet = configureWifiRadio();
    delay(WIFI_MODE_TRANSITION_DELAY_MS);

    bool apStarted = modeReady &&
      WiFi.softAP(apName.c_str(), nullptr, PROVISIONING_AP_CHANNEL,
                  false, PROVISIONING_AP_MAX_CLIENTS);
    Serial.print("Provisioning AP attempt ");
    Serial.print(attempt);
    Serial.print(": mode=");
    Serial.print(modeReady ? "ready" : "failed");
    Serial.print(", power=");
    Serial.print(powerSet ? "set" : "failed");
    Serial.print(", AP=");
    Serial.println(apStarted ? "started" : "failed");
    if (apStarted) {
      return true;
    }

    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    delay(WIFI_AP_RETRY_DELAY_MS);
  }
  return false;
}

bool runProvisioningPortal(uint32_t timeoutMs, bool showInstructions) {
  String apName = PROVISIONING_AP_PREFIX + settings.serial.substring(max(0, int(settings.serial.length()) - 6));
  resumeAfterSave = false;

  if (showInstructions) {
    drawStatusText("1 Connect phone Wi-Fi", apName.c_str(), "2 Open 192.168.4.1", "Follow setup page");
  }
  display.hibernate();

  if (!startProvisioningAccessPoint(apName)) {
    Serial.println("Provisioning AP failed after 2 attempts.");
    if (timeoutMs == 0) {
      drawStatusText("Wi-Fi AP failed", "Power cycle device", "Check serial log");
      display.hibernate();
      sleepForNextCheck(true);
    }
    return false;
  }

  IPAddress portalIp = WiFi.softAPIP();
  unsigned long startedAt = millis();
  Serial.print("Provisioning AP: ");
  Serial.println(apName);
  Serial.print("Portal URL: http://");
  Serial.println(portalIp);

  dnsServer.start(53, "*", portalIp);
  if (!portalRoutesConfigured) {
    portalServer.on("/", HTTP_GET, []() {
      portalServer.send(200, "text/html; charset=utf-8", provisioningPageHtml());
    });
    portalServer.on("/save", HTTP_POST, []() {
      String newSsid = portalServer.arg("ssid");
      String newApi = portalServer.arg("api");
      String newPassword = portalServer.arg("password");
      String newPairing = portalServer.arg("pairing");
      String newToken = portalServer.arg("token");
      uint32_t newIntervalMinutes = portalServer.arg("interval").toInt();
      bool newForceRefreshEveryCheck = portalServer.hasArg("force_refresh");
      newSsid.trim();
      newApi.trim();
      newPairing.trim();
      newPairing.replace(" ", "");
      newPairing.replace("-", "");
      newPairing.toUpperCase();

      bool identityChanged = newApi != settings.apiBaseUrl || newPairing != settings.pairingCode;
      bool keepsRegisteredToken = !settings.deviceToken.isEmpty() && !identityChanged && newToken.isEmpty();
      bool submitsToken = !newToken.isEmpty();
      if (newSsid.isEmpty() || newApi.isEmpty() ||
          (!keepsRegisteredToken && !submitsToken && newPairing.isEmpty())) {
        portalServer.send(400, "text/plain; charset=utf-8",
          "SSID and server URL are required. Provide a device token or a pairing code from the H5 device page.");
        return;
      }
      if (newIntervalMinutes < MIN_CHECK_INTERVAL_MINUTES ||
          newIntervalMinutes > MAX_CHECK_INTERVAL_MINUTES) {
        portalServer.send(400, "text/plain; charset=utf-8",
          "Check interval must be between 5 and 1440 minutes.");
        return;
      }

      prefs.begin("fridge", false);
      prefs.putString("ssid", newSsid);
      if (!newPassword.isEmpty()) {
        prefs.putString("pass", newPassword);
      }
      prefs.putString("api", newApi);
      prefs.putString("pair", newPairing);
      prefs.putUInt("interval", newIntervalMinutes);
      prefs.putBool("force", newForceRefreshEveryCheck);
      prefs.remove("prov");
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
      resumeAfterSave = true;
      resumeAt = millis() + 1000;
    });
    portalServer.onNotFound([]() {
      portalServer.sendHeader("Location", "/", true);
      portalServer.send(302, "text/plain", "");
    });
    portalRoutesConfigured = true;
  }
  portalServer.begin();

  while (true) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    if (resumeAfterSave && millis() >= resumeAt) {
      stopProvisioningPortal();
      loadSettings();
      Serial.println("Provisioning saved; continuing with the new settings.");
      return true;
    }
    if (timeoutMs > 0 && millis() - startedAt >= timeoutMs) {
      Serial.println("Provisioning portal timed out.");
      stopProvisioningPortal();
      return false;
    }
    delay(5);
  }
}

void stopProvisioningPortal() {
  portalServer.stop();
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
}

void restartForConfigApply() {
  Serial.println("Restarting in 1 second to apply the saved configuration.");
  Serial.flush();
  delay(SERIAL_SLEEP_DELAY_MS);
  esp_sleep_enable_timer_wakeup(CONFIG_APPLY_RESTART_DELAY_US);
  esp_deep_sleep_start();
}

String provisioningPageHtml() {
  String page = FPSTR(PROVISIONING_PAGE);
  page.replace("%SSID%", htmlEscape(settings.ssid));
  page.replace("%SSID_OPTIONS%", scannedWifiOptionsHtml());
  page.replace("%API%", htmlEscape(settings.apiBaseUrl));
  page.replace("%PAIRING%", htmlEscape(settings.pairingCode));
  page.replace("%INTERVAL%", String(settings.checkIntervalMinutes));
  page.replace("%FORCE_REFRESH_CHECKED%", settings.forceRefreshEveryCheck ? " checked" : "");
  page.replace("%PANEL%", PANEL_PROFILE);
  page.replace("%SERIAL%", htmlEscape(settings.serial));
  return page;
}

String scannedWifiOptionsHtml() {
  String options = "<option value=\"\">选择附近 Wi-Fi 或手动输入</option>";
  int count = WiFi.scanNetworks();
  if (count <= 0) {
    return options;
  }
  for (int index = 0; index < count; index += 1) {
    String ssid = WiFi.SSID(index);
    ssid.trim();
    if (ssid.isEmpty()) {
      continue;
    }
    String escaped = htmlEscape(ssid);
    options += "<option value=\"" + escaped + "\"";
    if (ssid == settings.ssid) {
      options += " selected";
    }
    options += ">" + escaped + " (" + String(WiFi.RSSI(index)) + " dBm)</option>";
  }
  WiFi.scanDelete();
  return options;
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
  logHeap("Heap before Wi-Fi");
  bool modeReady = WiFi.mode(WIFI_STA);
  delay(WIFI_MODE_TRANSITION_DELAY_MS);
  bool powerSet = configureWifiRadio();
  Serial.print("Wi-Fi station mode: ");
  Serial.print(modeReady ? "ready" : "failed");
  Serial.print(", power: ");
  Serial.println(powerSet ? "set" : "failed");
  if (!modeReady) {
    setError("Wi-Fi failed", "Cannot start radio", "Power cycle for setup");
    return false;
  }
  WiFi.begin(settings.ssid.c_str(), settings.password.c_str());
  Serial.print("Connecting Wi-Fi: ");
  Serial.print(settings.ssid);
  Serial.print(" ");
  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < WIFI_TIMEOUT_MS) {
    delay(400);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    setError("Wi-Fi failed", "Cannot connect", "Power cycle for setup");
    return false;
  }
  Serial.print("Wi-Fi IP: ");
  Serial.println(WiFi.localIP());
  logHeap("Heap after Wi-Fi");
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
  logHeap("Heap before register");
  HTTPClient http;
  WiFiClient client;
  WiFiClientSecure secureClient;
  String url = joinApiUrl("/api/device/register");
  if (!beginHttp(http, client, secureClient, url)) {
    setError("Register failed", "HTTP setup error", "Check server URL");
    return false;
  }

  String payload = "{\"serial\":\"" + jsonEscape(settings.serial) +
    "\",\"pairingCode\":\"" + jsonEscape(settings.pairingCode) +
    "\",\"panel\":\"" + String(PANEL_PROFILE) + "\"}";
  http.setTimeout(DOWNLOAD_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
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
  settings.pairingCode = "";
  settings.etag = "";
  prefs.begin("fridge", false);
  prefs.putString("token", settings.deviceToken);
  prefs.remove("pair");
  prefs.remove("etag");
  prefs.end();
  Serial.println("Device registration completed.");
  logHeap("Heap after register");
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
  logHeap("Heap before frame request");
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

  const char* keys[] = { "ETag" };
  http.collectHeaders(keys, 1);
  http.setTimeout(DOWNLOAD_TIMEOUT_MS);
  http.addHeader("Authorization", "Bearer " + settings.deviceToken);
  if (!settings.etag.isEmpty() && hasStoredImage()) {
    http.addHeader("If-None-Match", settings.etag);
  } else if (!settings.etag.isEmpty()) {
    Serial.println("Ignoring saved ETag because no valid local frame exists.");
  }

  int status = http.GET();
  if (status == HTTP_CODE_NOT_MODIFIED) {
    Serial.println("Frame is unchanged.");
    http.end();
    return FRAME_UNCHANGED;
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
  logHeap("Heap after frame request");
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

bool drawStoredImage() {
  File file = FFat.open(IMAGE_PATH, "r");
  if (!file || file.size() != DISPLAY_IMAGE_BYTES) {
    if (file) {
      file.close();
    }
    setError("Storage failed", "Bad saved frame", "Try again later");
    return false;
  }

  display.init();
  display.setRotation(0);
  logHeap("Heap before chunked drawNative");

  for (uint16_t y = 0; y < DISPLAY_HEIGHT; y += DISPLAY_DRAW_CHUNK_ROWS) {
    uint16_t rows = DISPLAY_DRAW_CHUNK_ROWS;
    if (y + rows > DISPLAY_HEIGHT) {
      rows = DISPLAY_HEIGHT - y;
    }
    size_t bytesToRead = size_t(DISPLAY_BYTES_PER_ROW) * rows;
    size_t count = file.read(imageChunk, bytesToRead);
    if (count != bytesToRead) {
      file.close();
      setError("Storage failed", "Frame read error", "Try again later");
      return false;
    }
    display.writeNative(imageChunk, nullptr, 0, y, DISPLAY_WIDTH, rows, false, false, false);
  }

  file.close();
  logHeap("Heap before full refresh");
  display.refresh(false);
  return true;
}

void releaseNetwork() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(250);
  logHeap("Heap after Wi-Fi off");
}

void logHeap(const char* label) {
  Serial.print(label);
  Serial.print(": free=");
  Serial.print(ESP.getFreeHeap());
  Serial.print(" largest=");
  Serial.println(heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
}

void drawStatusText(const char* line1, const char* line2, const char* line3, const char* line4) {
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
    display.setCursor(30, 370);
    display.print(line4);
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

void sleepForNextCheck(bool fastRetry, uint64_t elapsedUs) {
  uint64_t targetInterval = fastRetry
    ? FIRST_SETUP_RETRY_INTERVAL_US
    : uint64_t(settings.checkIntervalMinutes) * 60ULL * 1000000ULL;
  uint64_t interval = targetInterval > elapsedUs
    ? targetInterval - elapsedUs
    : CONFIG_APPLY_RESTART_DELAY_US;
  if (interval < CONFIG_APPLY_RESTART_DELAY_US) {
    interval = CONFIG_APPLY_RESTART_DELAY_US;
  }
  if (elapsedUs > 0) {
    Serial.print("Elapsed configuration window seconds: ");
    Serial.println(elapsedUs / 1000000ULL);
  }
  Serial.print("Sleeping for seconds: ");
  Serial.println(interval / 1000000ULL);
  Serial.flush();
  delay(SERIAL_SLEEP_DELAY_MS);
  esp_sleep_enable_timer_wakeup(interval);
  esp_deep_sleep_start();
}
