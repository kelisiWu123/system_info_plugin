#include <errno.h>
#include <math.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#define HELPER_SOCKET_PATH "/var/run/hwinfox-powermetrics-helper.sock"
#define MAX_VALUES 64
#define BUFFER_SIZE 8192

static volatile sig_atomic_t keep_running = 1;

static void handle_signal(int signal_number) {
  (void)signal_number;
  keep_running = 0;
}

static void json_escape(const char *input, char *output, size_t output_size) {
  size_t written = 0;
  if (!output_size) return;

  for (size_t i = 0; input && input[i] && written + 2 < output_size; i++) {
    unsigned char ch = (unsigned char)input[i];
    if (ch == '\\' || ch == '"') {
      if (written + 2 >= output_size) break;
      output[written++] = '\\';
      output[written++] = (char)ch;
    } else if (ch == '\n' || ch == '\r' || ch == '\t') {
      if (written + 2 >= output_size) break;
      output[written++] = ' ';
    } else if (ch >= 32) {
      output[written++] = (char)ch;
    }
  }

  output[written] = '\0';
}

static double round_frequency(double value) {
  return round(value * 100.0) / 100.0;
}

static double round_power(double value) {
  return round(value * 10.0) / 10.0;
}

static double round_gpu_power(double value) {
  if (value < 1.0) return round(value * 1000.0) / 1000.0;
  return round_power(value);
}

static double round_percent(double value) {
  return round(value * 10.0) / 10.0;
}

static double round_clock_mhz(double value) {
  return round(value);
}

static bool parse_frequency_line(const char *line, double *ghz_value) {
  if (!line || !strstr(line, "frequency")) return false;
  if (!strstr(line, "Cluster") && !strstr(line, "CPU")) return false;

  const char *cursor = line;
  while (*cursor) {
    char *end = NULL;
    double value = strtod(cursor, &end);
    if (end && end != cursor) {
      while (*end == ' ') end++;
      if (strncasecmp(end, "MHz", 3) == 0 || strncasecmp(end, "Mhz", 3) == 0) {
        *ghz_value = round_frequency(value / 1000.0);
        return *ghz_value > 0 && *ghz_value < 10;
      }
      if (strncasecmp(end, "GHz", 3) == 0 || strncasecmp(end, "Ghz", 3) == 0) {
        *ghz_value = round_frequency(value);
        return *ghz_value > 0 && *ghz_value < 10;
      }
      cursor = end;
    } else {
      cursor++;
    }
  }

  return false;
}

static bool parse_gpu_active_residency_line(const char *line, double *percent_value) {
  if (!line || !strstr(line, "GPU HW active residency")) return false;

  const char *cursor = line;
  while (*cursor) {
    char *end = NULL;
    double value = strtod(cursor, &end);
    if (end && end != cursor) {
      while (*end == ' ') end++;
      if (*end == '%') {
        *percent_value = round_percent(value);
        return *percent_value >= 0.0 && *percent_value <= 100.0;
      }
      cursor = end;
    } else {
      cursor++;
    }
  }

  return false;
}

static bool parse_gpu_idle_residency_line(const char *line, double *percent_value) {
  if (!line || !strstr(line, "GPU idle residency")) return false;

  const char *cursor = line;
  while (*cursor) {
    char *end = NULL;
    double value = strtod(cursor, &end);
    if (end && end != cursor) {
      while (*end == ' ') end++;
      if (*end == '%') {
        *percent_value = round_percent(value);
        return *percent_value >= 0.0 && *percent_value <= 100.0;
      }
      cursor = end;
    } else {
      cursor++;
    }
  }

  return false;
}

static bool parse_gpu_frequency_line(const char *line, double *mhz_value) {
  if (!line || !strstr(line, "GPU")) return false;

  const bool has_frequency_keyword = strstr(line, "frequency") != NULL;
  const bool has_residency_keyword = strstr(line, "residency") != NULL;
  if (!has_frequency_keyword && !has_residency_keyword) return false;

  const char *cursor = line;
  double weighted_frequency_sum = 0.0;
  double weighted_percent_sum = 0.0;

  while (*cursor) {
    char *end = NULL;
    double value = strtod(cursor, &end);
    if (end && end != cursor) {
      while (*end == ' ') end++;
      if (strncasecmp(end, "MHz", 3) == 0 || strncasecmp(end, "Mhz", 3) == 0) {
        double mhz = value;
        const char *after_unit = end + 3;
        while (*after_unit == ' ' || *after_unit == ':') after_unit++;

        if (has_residency_keyword) {
          char *percent_end = NULL;
          double percent = strtod(after_unit, &percent_end);
          if (percent_end && percent_end != after_unit) {
            while (*percent_end == ' ') percent_end++;
            if (*percent_end == '%') {
              weighted_frequency_sum += mhz * percent;
              weighted_percent_sum += percent;
            }
          }
        }

        if (has_frequency_keyword) {
          *mhz_value = round_clock_mhz(mhz);
          return *mhz_value > 0.0 && *mhz_value < 10000.0;
        }
      } else if (strncasecmp(end, "GHz", 3) == 0 || strncasecmp(end, "Ghz", 3) == 0) {
        double mhz = value * 1000.0;
        *mhz_value = round_clock_mhz(mhz);
        return *mhz_value > 0.0 && *mhz_value < 10000.0;
      }
      cursor = end;
    } else {
      cursor++;
    }
  }

  if (weighted_percent_sum > 0.0) {
    *mhz_value = round_clock_mhz(weighted_frequency_sum / weighted_percent_sum);
    return *mhz_value > 0.0 && *mhz_value < 10000.0;
  }

  return false;
}

static bool parse_power_line(const char *line, char name[64], double *watts_value) {
  if (!line || !strstr(line, "Power")) return false;
  if (!strstr(line, "CPU") && !strstr(line, "Cluster")) return false;

  const char *colon = strchr(line, ':');
  if (!colon) return false;

  size_t name_length = (size_t)(colon - line);
  while (name_length > 0 && (line[name_length - 1] == ' ' || line[name_length - 1] == '\t')) {
    name_length--;
  }
  if (name_length == 0 || name_length >= 64) return false;

  memcpy(name, line, name_length);
  name[name_length] = '\0';

  const char *cursor = colon + 1;
  while (*cursor) {
    char *end = NULL;
    double value = strtod(cursor, &end);
    if (end && end != cursor) {
      while (*end == ' ') end++;
      if (strncasecmp(end, "mW", 2) == 0) {
        *watts_value = round_power(value / 1000.0);
        return *watts_value > 0 && *watts_value < 500;
      }
      if (end[0] == 'W' || strncasecmp(end, "Watts", 5) == 0) {
        *watts_value = round_power(value);
        return *watts_value > 0 && *watts_value < 500;
      }
      cursor = end;
    } else {
      cursor++;
    }
  }

  return false;
}

static bool parse_gpu_power_line(const char *line, double *watts_value) {
  if (!line || !strstr(line, "GPU") || !strstr(line, "Power")) return false;

  const char *colon = strchr(line, ':');
  if (!colon) return false;

  const char *cursor = colon + 1;
  while (*cursor) {
    char *end = NULL;
    double value = strtod(cursor, &end);
    if (end && end != cursor) {
      while (*end == ' ') end++;
      if (strncasecmp(end, "mW", 2) == 0) {
        *watts_value = round_gpu_power(value / 1000.0);
        return *watts_value > 0.0 && *watts_value < 500.0;
      }
      if (end[0] == 'W' || strncasecmp(end, "Watts", 5) == 0) {
        *watts_value = round_gpu_power(value);
        return *watts_value > 0.0 && *watts_value < 500.0;
      }
      cursor = end;
    } else {
      cursor++;
    }
  }

  return false;
}

static void write_error_json(int client_fd, const char *code, const char *message) {
  char escaped[2048];
  char response[2300];
  json_escape(message, escaped, sizeof(escaped));
  snprintf(
    response,
    sizeof(response),
    "{\"ok\":false,\"source\":\"powermetrics\",\"privileged\":true,\"errorCode\":\"%s\",\"reason\":\"%s\",\"message\":\"%s\"}\n",
    code,
    code,
    escaped
  );
  write(client_fd, response, strlen(response));
}

static void write_frequency_json(int client_fd, const double *values, size_t count) {
  double min = values[0];
  double max = values[0];
  double sum = 0;
  char cores[1024] = "";
  size_t offset = 0;

  for (size_t i = 0; i < count; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
    sum += values[i];
    offset += (size_t)snprintf(
      cores + offset,
      sizeof(cores) > offset ? sizeof(cores) - offset : 0,
      "%s%.2f",
      i == 0 ? "" : ",",
      values[i]
    );
  }

  char response[1600];
  snprintf(
    response,
    sizeof(response),
    "{\"ok\":true,\"source\":\"powermetrics\",\"privileged\":true,\"helper\":true,\"sensorName\":\"HWInfoX powermetrics helper\",\"min\":%.2f,\"max\":%.2f,\"avg\":%.2f,\"cores\":[%s]}\n",
    round_frequency(min),
    round_frequency(max),
    round_frequency(sum / (double)count),
    cores
  );
  write(client_fd, response, strlen(response));
}

static void write_power_json(int client_fd, const char names[MAX_VALUES][64], const double *values, size_t count) {
  size_t main_index = 0;
  char sensors[2048] = "";
  size_t offset = 0;

  for (size_t i = 0; i < count; i++) {
    if (strstr(names[i], "CPU")) {
      main_index = i;
      break;
    }
    if (values[i] > values[main_index]) {
      main_index = i;
    }
  }

  for (size_t i = 0; i < count; i++) {
    char escaped_name[96];
    json_escape(names[i], escaped_name, sizeof(escaped_name));
    offset += (size_t)snprintf(
      sensors + offset,
      sizeof(sensors) > offset ? sizeof(sensors) - offset : 0,
      "%s{\"name\":\"%s\",\"value\":%.1f}",
      i == 0 ? "" : ",",
      escaped_name,
      round_power(values[i])
    );
  }

  char escaped_sensor_name[96];
  json_escape(names[main_index], escaped_sensor_name, sizeof(escaped_sensor_name));

  char response[2600];
  snprintf(
    response,
    sizeof(response),
    "{\"ok\":true,\"source\":\"powermetrics\",\"privileged\":true,\"helper\":true,\"sensorName\":\"%s\",\"value\":%.1f,\"sensors\":[%s]}\n",
    escaped_sensor_name,
    round_power(values[main_index]),
    sensors
  );
  write(client_fd, response, strlen(response));
}

static void write_gpu_telemetry_json(int client_fd, bool has_utilization, double utilization, bool has_idle_residency, double idle_residency, bool has_clock, double clock_mhz, bool has_power, double power_watts) {
  char utilization_json[32];
  char idle_residency_json[32];
  char clock_json[32];
  char power_json[32];

  if (has_utilization) {
    snprintf(utilization_json, sizeof(utilization_json), "%.1f", round_percent(utilization));
  } else {
    snprintf(utilization_json, sizeof(utilization_json), "null");
  }

  if (has_clock) {
    snprintf(clock_json, sizeof(clock_json), "%.0f", round_clock_mhz(clock_mhz));
  } else {
    snprintf(clock_json, sizeof(clock_json), "null");
  }

  if (has_idle_residency) {
    snprintf(idle_residency_json, sizeof(idle_residency_json), "%.1f", round_percent(idle_residency));
  } else {
    snprintf(idle_residency_json, sizeof(idle_residency_json), "null");
  }

  if (has_power) {
    if (power_watts < 1.0) {
      snprintf(power_json, sizeof(power_json), "%.3f", round_gpu_power(power_watts));
    } else {
      snprintf(power_json, sizeof(power_json), "%.1f", round_gpu_power(power_watts));
    }
  } else {
    snprintf(power_json, sizeof(power_json), "null");
  }

  char response[1024];
  snprintf(
    response,
    sizeof(response),
    "{\"ok\":true,\"source\":\"powermetrics\",\"privileged\":true,\"helper\":true,\"sensorName\":\"HWInfoX powermetrics helper GPU telemetry\",\"utilizationGpu\":%s,\"idleResidencyGpu\":%s,\"clockCore\":%s,\"powerDraw\":%s}\n",
    utilization_json,
    idle_residency_json,
    clock_json,
    power_json
  );
  write(client_fd, response, strlen(response));
}

static void handle_cpu_frequency(int client_fd) {
  FILE *pipe = popen("/usr/bin/powermetrics --samplers cpu_power -n 1 -i 200 2>&1", "r");
  if (!pipe) {
    write_error_json(client_fd, "HELPER_POWERMETRICS_SPAWN_FAILED", strerror(errno));
    return;
  }

  double values[MAX_VALUES];
  size_t value_count = 0;
  char output[BUFFER_SIZE] = "";
  size_t output_offset = 0;
  char line[1024];

  while (fgets(line, sizeof(line), pipe)) {
    size_t line_length = strlen(line);
    if (output_offset + line_length + 1 < sizeof(output)) {
      memcpy(output + output_offset, line, line_length);
      output_offset += line_length;
      output[output_offset] = '\0';
    }

    double ghz_value = 0;
    if (value_count < MAX_VALUES && parse_frequency_line(line, &ghz_value)) {
      values[value_count++] = ghz_value;
    }
  }

  int status = pclose(pipe);
  if (value_count > 0) {
    write_frequency_json(client_fd, values, value_count);
    return;
  }

  char message[BUFFER_SIZE + 128];
  snprintf(message, sizeof(message), "powermetrics exited with status %d; output: %s", status, output);
  write_error_json(client_fd, "HELPER_POWERMETRICS_EMPTY", message);
}

static void handle_cpu_power(int client_fd) {
  FILE *pipe = popen("/usr/bin/powermetrics --samplers cpu_power -n 1 -i 200 2>&1", "r");
  if (!pipe) {
    write_error_json(client_fd, "HELPER_POWERMETRICS_SPAWN_FAILED", strerror(errno));
    return;
  }

  char names[MAX_VALUES][64];
  double values[MAX_VALUES];
  size_t value_count = 0;
  char output[BUFFER_SIZE] = "";
  size_t output_offset = 0;
  char line[1024];

  while (fgets(line, sizeof(line), pipe)) {
    size_t line_length = strlen(line);
    if (output_offset + line_length + 1 < sizeof(output)) {
      memcpy(output + output_offset, line, line_length);
      output_offset += line_length;
      output[output_offset] = '\0';
    }

    char name[64] = "";
    double watts_value = 0;
    if (value_count < MAX_VALUES && parse_power_line(line, name, &watts_value)) {
      snprintf(names[value_count], sizeof(names[value_count]), "%s", name);
      values[value_count++] = watts_value;
    }
  }

  int status = pclose(pipe);
  if (value_count > 0) {
    write_power_json(client_fd, names, values, value_count);
    return;
  }

  char message[BUFFER_SIZE + 128];
  snprintf(message, sizeof(message), "powermetrics exited with status %d; output: %s", status, output);
  write_error_json(client_fd, "HELPER_POWERMETRICS_POWER_EMPTY", message);
}

static void handle_gpu_telemetry(int client_fd) {
  FILE *pipe = popen("/usr/bin/powermetrics --samplers gpu_power -n 1 -i 200 2>&1", "r");
  if (!pipe) {
    write_error_json(client_fd, "HELPER_GPU_POWERMETRICS_SPAWN_FAILED", strerror(errno));
    return;
  }

  bool has_utilization = false;
  bool has_idle_residency = false;
  bool has_clock = false;
  bool has_power = false;
  double utilization = 0.0;
  double idle_residency = 0.0;
  double clock_mhz = 0.0;
  double power_watts = 0.0;
  char output[BUFFER_SIZE] = "";
  size_t output_offset = 0;
  char line[1024];

  while (fgets(line, sizeof(line), pipe)) {
    size_t line_length = strlen(line);
    if (output_offset + line_length + 1 < sizeof(output)) {
      memcpy(output + output_offset, line, line_length);
      output_offset += line_length;
      output[output_offset] = '\0';
    }

    double parsed_value = 0.0;
    if (!has_utilization && parse_gpu_active_residency_line(line, &parsed_value)) {
      utilization = parsed_value;
      has_utilization = true;
    }
    if (!has_idle_residency && parse_gpu_idle_residency_line(line, &parsed_value)) {
      idle_residency = parsed_value;
      has_idle_residency = true;
    }
    if (!has_clock && parse_gpu_frequency_line(line, &parsed_value)) {
      clock_mhz = parsed_value;
      has_clock = true;
    }
    if (!has_power && parse_gpu_power_line(line, &parsed_value)) {
      power_watts = parsed_value;
      has_power = true;
    }
  }

  int status = pclose(pipe);
  if (has_utilization || has_idle_residency || has_clock || has_power) {
    write_gpu_telemetry_json(client_fd, has_utilization, utilization, has_idle_residency, idle_residency, has_clock, clock_mhz, has_power, power_watts);
    return;
  }

  char message[BUFFER_SIZE + 128];
  snprintf(message, sizeof(message), "powermetrics exited with status %d; output: %s", status, output);
  write_error_json(client_fd, "HELPER_GPU_POWERMETRICS_EMPTY", message);
}

static void handle_client(int client_fd) {
  char command[128] = "";
  ssize_t bytes_read = read(client_fd, command, sizeof(command) - 1);
  if (bytes_read <= 0) {
    write_error_json(client_fd, "HELPER_EMPTY_COMMAND", "empty helper command");
    return;
  }

  command[bytes_read] = '\0';
  if (strncmp(command, "cpu_frequency", strlen("cpu_frequency")) == 0) {
    handle_cpu_frequency(client_fd);
    return;
  }

  if (strncmp(command, "cpu_power", strlen("cpu_power")) == 0) {
    handle_cpu_power(client_fd);
    return;
  }

  if (strncmp(command, "gpu_telemetry", strlen("gpu_telemetry")) == 0) {
    handle_gpu_telemetry(client_fd);
    return;
  }

  write_error_json(client_fd, "HELPER_UNSUPPORTED_COMMAND", "unsupported helper command");
}

int main(void) {
  signal(SIGINT, handle_signal);
  signal(SIGTERM, handle_signal);

  int server_fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (server_fd < 0) {
    perror("socket");
    return 1;
  }

  unlink(HELPER_SOCKET_PATH);

  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  snprintf(address.sun_path, sizeof(address.sun_path), "%s", HELPER_SOCKET_PATH);

  if (bind(server_fd, (struct sockaddr *)&address, sizeof(address)) < 0) {
    perror("bind");
    close(server_fd);
    return 1;
  }

  chmod(HELPER_SOCKET_PATH, 0666);

  if (listen(server_fd, 8) < 0) {
    perror("listen");
    close(server_fd);
    unlink(HELPER_SOCKET_PATH);
    return 1;
  }

  while (keep_running) {
    int client_fd = accept(server_fd, NULL, NULL);
    if (client_fd < 0) {
      if (errno == EINTR) continue;
      break;
    }

    handle_client(client_fd);
    close(client_fd);
  }

  close(server_fd);
  unlink(HELPER_SOCKET_PATH);
  return 0;
}
