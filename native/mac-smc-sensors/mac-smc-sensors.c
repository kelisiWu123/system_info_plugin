#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <mach/mach.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SMC_SELECTOR 2
#define SMC_CMD_READ_BYTES 5
#define SMC_CMD_READ_INDEX 8
#define SMC_CMD_READ_KEYINFO 9
#define SMC_MAX_BYTES 32
#define MAX_SENSORS 512
#define MAX_ERRORS 16

typedef struct {
  unsigned char major;
  unsigned char minor;
  unsigned char build;
  unsigned char reserved;
  unsigned short release;
} SMCVersion;

typedef struct {
  uint16_t version;
  uint16_t length;
  uint32_t cpuPLimit;
  uint32_t gpuPLimit;
  uint32_t memPLimit;
} SMCPLimitData;

typedef struct {
  uint32_t dataSize;
  uint32_t dataType;
  unsigned char dataAttributes;
} SMCKeyInfoData;

typedef struct {
  uint32_t key;
  SMCVersion vers;
  SMCPLimitData pLimitData;
  SMCKeyInfoData keyInfo;
  unsigned char result;
  unsigned char status;
  unsigned char data8;
  uint32_t data32;
  unsigned char bytes[SMC_MAX_BYTES];
} SMCParamStruct;

typedef struct {
  char key[5];
  char name[64];
  char role[16];
  double value;
} TemperatureSensor;

typedef struct {
  int id;
  char key[5];
  char name[64];
  double rpm;
} FanSensor;

typedef struct {
  TemperatureSensor temperatures[MAX_SENSORS];
  size_t temperatureCount;
  FanSensor fans[MAX_SENSORS];
  size_t fanCount;
  char errors[MAX_ERRORS][160];
  size_t errorCount;
  bool enumerated;
} SensorSnapshot;

static uint32_t fourcc_to_u32(const char *key) {
  return ((uint32_t)(unsigned char)key[0] << 24)
       | ((uint32_t)(unsigned char)key[1] << 16)
       | ((uint32_t)(unsigned char)key[2] << 8)
       | ((uint32_t)(unsigned char)key[3]);
}

static void u32_to_fourcc(uint32_t value, char out[5]) {
  out[0] = (char)((value >> 24) & 0xff);
  out[1] = (char)((value >> 16) & 0xff);
  out[2] = (char)((value >> 8) & 0xff);
  out[3] = (char)(value & 0xff);
  out[4] = '\0';
}

static void add_error(SensorSnapshot *snapshot, const char *message) {
  if (!snapshot || snapshot->errorCount >= MAX_ERRORS) return;
  snprintf(snapshot->errors[snapshot->errorCount], sizeof(snapshot->errors[snapshot->errorCount]), "%s", message);
  snapshot->errorCount++;
}

static kern_return_t call_smc(io_connect_t connection, const SMCParamStruct *input, SMCParamStruct *output) {
  size_t inputSize = sizeof(SMCParamStruct);
  size_t outputSize = sizeof(SMCParamStruct);
  memset(output, 0, sizeof(*output));
  return IOConnectCallStructMethod(connection, SMC_SELECTOR, input, inputSize, output, &outputSize);
}

static io_service_t find_smc_service(void) {
  io_service_t service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMCKeysEndpoint"));
  if (service) return service;
  return IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSMC"));
}

static bool open_smc(io_connect_t *connection, SensorSnapshot *snapshot) {
  io_service_t service = find_smc_service();
  if (!service) {
    add_error(snapshot, "AppleSMC service not found");
    return false;
  }

  kern_return_t result = KERN_FAILURE;
  for (uint32_t type = 0; type <= 8; type++) {
    result = IOServiceOpen(service, mach_task_self(), type, connection);
    if (result == KERN_SUCCESS) {
      IOObjectRelease(service);
      return true;
    }
  }

  IOObjectRelease(service);
  char buffer[160];
  snprintf(buffer, sizeof(buffer), "IOServiceOpen AppleSMC failed for user client types 0-8; last error: 0x%x", result);
  add_error(snapshot, buffer);
  return false;
}

static bool read_key_info(io_connect_t connection, const char *key, SMCKeyInfoData *info) {
  SMCParamStruct input;
  SMCParamStruct output;
  memset(&input, 0, sizeof(input));
  input.key = fourcc_to_u32(key);
  input.data8 = SMC_CMD_READ_KEYINFO;

  kern_return_t result = call_smc(connection, &input, &output);
  if (result != KERN_SUCCESS || output.result != 0 || output.keyInfo.dataSize == 0) return false;
  *info = output.keyInfo;
  return true;
}

static bool read_key_bytes(io_connect_t connection, const char *key, const SMCKeyInfoData *info, unsigned char bytes[SMC_MAX_BYTES]) {
  SMCParamStruct input;
  SMCParamStruct output;
  memset(&input, 0, sizeof(input));
  input.key = fourcc_to_u32(key);
  input.keyInfo.dataSize = info->dataSize;
  input.data8 = SMC_CMD_READ_BYTES;

  kern_return_t result = call_smc(connection, &input, &output);
  if (result != KERN_SUCCESS || output.result != 0) return false;
  memcpy(bytes, output.bytes, SMC_MAX_BYTES);
  return true;
}

static bool read_key_at_index(io_connect_t connection, uint32_t index, char key[5]) {
  SMCParamStruct input;
  SMCParamStruct output;
  memset(&input, 0, sizeof(input));
  input.data8 = SMC_CMD_READ_INDEX;
  input.data32 = index;

  kern_return_t result = call_smc(connection, &input, &output);
  if (result != KERN_SUCCESS || output.result != 0 || output.key == 0) return false;
  u32_to_fourcc(output.key, key);
  return true;
}

static double decode_sp78(const unsigned char *bytes) {
  int16_t raw = (int16_t)(((uint16_t)bytes[0] << 8) | bytes[1]);
  return (double)raw / 256.0;
}

static double decode_fpe2(const unsigned char *bytes) {
  uint16_t raw = (uint16_t)(((uint16_t)bytes[0] << 8) | bytes[1]);
  return (double)raw / 4.0;
}

static double decode_float32_be(const unsigned char *bytes) {
  uint32_t raw = ((uint32_t)bytes[0] << 24)
               | ((uint32_t)bytes[1] << 16)
               | ((uint32_t)bytes[2] << 8)
               | (uint32_t)bytes[3];
  float value;
  memcpy(&value, &raw, sizeof(value));
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
  unsigned char *p = (unsigned char *)&value;
  unsigned char tmp = p[0]; p[0] = p[3]; p[3] = tmp;
  tmp = p[1]; p[1] = p[2]; p[2] = tmp;
#endif
  return (double)value;
}

static uint32_t decode_uint_be(const unsigned char *bytes, uint32_t size) {
  uint32_t value = 0;
  for (uint32_t i = 0; i < size && i < 4; i++) {
    value = (value << 8) | bytes[i];
  }
  return value;
}

static bool decode_value(const SMCKeyInfoData *info, const unsigned char *bytes, double *value) {
  char type[5];
  u32_to_fourcc(info->dataType, type);

  if (strcmp(type, "sp78") == 0 && info->dataSize >= 2) {
    *value = decode_sp78(bytes);
    return true;
  }

  if (strcmp(type, "fpe2") == 0 && info->dataSize >= 2) {
    *value = decode_fpe2(bytes);
    return true;
  }

  if (strcmp(type, "flt ") == 0 && info->dataSize >= 4) {
    *value = decode_float32_be(bytes);
    return true;
  }

  if ((strcmp(type, "ui8 ") == 0 || strcmp(type, "ui16") == 0 || strcmp(type, "ui32") == 0) && info->dataSize >= 1) {
    *value = (double)decode_uint_be(bytes, info->dataSize);
    return true;
  }

  return false;
}

static bool is_plausible_temperature(double value) {
  return value > 0.0 && value < 130.0;
}

static bool is_plausible_fan(double value) {
  return value >= 0.0 && value < 12000.0;
}

static const char *temperature_role_for_key(const char *key) {
  if (key[0] != 'T') return "other";
  if (key[1] == 'C' || key[1] == 'P' || key[1] == 'E' || key[1] == 'D' || key[1] == 'p' || key[1] == 'e') return "cpu";
  if (key[1] == 'G' || key[1] == 'g') return "gpu";
  if (key[1] == 'A' || key[1] == 'B' || key[1] == 'a') return "ambient";
  return "other";
}

static void add_temperature(SensorSnapshot *snapshot, const char *key, double value) {
  if (!snapshot || snapshot->temperatureCount >= MAX_SENSORS || !is_plausible_temperature(value)) return;
  TemperatureSensor *sensor = &snapshot->temperatures[snapshot->temperatureCount++];
  snprintf(sensor->key, sizeof(sensor->key), "%s", key);
  snprintf(sensor->name, sizeof(sensor->name), "AppleSMC %s", key);
  snprintf(sensor->role, sizeof(sensor->role), "%s", temperature_role_for_key(key));
  sensor->value = value;
}

static void add_fan(SensorSnapshot *snapshot, const char *key, double value) {
  if (!snapshot || snapshot->fanCount >= MAX_SENSORS || !is_plausible_fan(value)) return;
  FanSensor *sensor = &snapshot->fans[snapshot->fanCount++];
  sensor->id = (key[1] >= '0' && key[1] <= '9') ? key[1] - '0' : (int)snapshot->fanCount - 1;
  snprintf(sensor->key, sizeof(sensor->key), "%s", key);
  snprintf(sensor->name, sizeof(sensor->name), "AppleSMC fan %d", sensor->id);
  sensor->rpm = value;
}

static bool read_numeric_key(io_connect_t connection, const char *key, double *value) {
  SMCKeyInfoData info;
  unsigned char bytes[SMC_MAX_BYTES];
  if (!read_key_info(connection, key, &info)) return false;
  if (!read_key_bytes(connection, key, &info, bytes)) return false;
  return decode_value(&info, bytes, value);
}

static void read_sensor_key(io_connect_t connection, SensorSnapshot *snapshot, const char *key) {
  double value = 0;
  if (!read_numeric_key(connection, key, &value)) return;

  if (key[0] == 'T') {
    add_temperature(snapshot, key, value);
  } else if (key[0] == 'F' && key[2] == 'A' && key[3] == 'c') {
    add_fan(snapshot, key, value);
  }
}

static uint32_t read_key_count(io_connect_t connection) {
  double count = 0;
  if (!read_numeric_key(connection, "#KEY", &count) || count <= 0) return 0;
  return (uint32_t)count;
}

static void read_enumerated_sensors(io_connect_t connection, SensorSnapshot *snapshot) {
  uint32_t keyCount = read_key_count(connection);
  if (keyCount == 0) {
    add_error(snapshot, "Unable to read #KEY count");
    return;
  }

  if (keyCount > 20000) keyCount = 20000;
  snapshot->enumerated = true;

  for (uint32_t index = 0; index < keyCount; index++) {
    char key[5];
    if (!read_key_at_index(connection, index, key)) continue;
    if (key[0] == 'T' || (key[0] == 'F' && key[2] == 'A' && key[3] == 'c')) {
      read_sensor_key(connection, snapshot, key);
    }
  }
}

static void read_candidate_sensors(io_connect_t connection, SensorSnapshot *snapshot) {
  const char *keys[] = {
    "TC0P", "TC0E", "TC0F", "TC0D", "TC0H", "TC0p",
    "Tp09", "Tp0T", "Tp0P", "Te05", "Te0T", "Te0P",
    "TG0P", "TG0D", "Ta0P",
    "F0Ac", "F1Ac", "F2Ac",
  };

  for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); i++) {
    read_sensor_key(connection, snapshot, keys[i]);
  }
}

static void json_escape(const char *input) {
  for (const unsigned char *p = (const unsigned char *)input; *p; p++) {
    if (*p == '"' || *p == '\\') {
      putchar('\\');
      putchar(*p);
    } else if (*p >= 32 && *p < 127) {
      putchar(*p);
    }
  }
}

static void print_json(const SensorSnapshot *snapshot) {
  printf("{\"source\":\"apple-smc\",\"enumerated\":%s,\"temperatures\":[", snapshot->enumerated ? "true" : "false");
  for (size_t i = 0; i < snapshot->temperatureCount; i++) {
    const TemperatureSensor *sensor = &snapshot->temperatures[i];
    if (i > 0) printf(",");
    printf("{\"key\":\"");
    json_escape(sensor->key);
    printf("\",\"name\":\"");
    json_escape(sensor->name);
    printf("\",\"role\":\"");
    json_escape(sensor->role);
    printf("\",\"value\":%.1f}", sensor->value);
  }
  printf("],\"fans\":[");
  for (size_t i = 0; i < snapshot->fanCount; i++) {
    const FanSensor *sensor = &snapshot->fans[i];
    if (i > 0) printf(",");
    printf("{\"id\":%d,\"key\":\"", sensor->id);
    json_escape(sensor->key);
    printf("\",\"name\":\"");
    json_escape(sensor->name);
    printf("\",\"rpm\":%.0f}", sensor->rpm);
  }
  printf("],\"errors\":[");
  for (size_t i = 0; i < snapshot->errorCount; i++) {
    if (i > 0) printf(",");
    printf("\"");
    json_escape(snapshot->errors[i]);
    printf("\"");
  }
  printf("]}\n");
}

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;

  SensorSnapshot snapshot;
  memset(&snapshot, 0, sizeof(snapshot));

  io_connect_t connection = IO_OBJECT_NULL;
  if (open_smc(&connection, &snapshot)) {
    read_enumerated_sensors(connection, &snapshot);
    if (snapshot.temperatureCount == 0 && snapshot.fanCount == 0) {
      read_candidate_sensors(connection, &snapshot);
    }
    IOServiceClose(connection);
  }

  print_json(&snapshot);
  return snapshot.temperatureCount > 0 || snapshot.fanCount > 0 ? 0 : 2;
}
