using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LibreHardwareMonitor.Hardware;

namespace HwmonHelper;

internal static class Program
{
    private static readonly string[] ExclusionTerms =
    [
        "acpi thermal zone",
        "thermal zone",
        "tmpin",
        "motherboard",
        "mainboard",
        "pch",
        "vrm",
        "chipset",
        "gpu",
        "ssd",
        "hdd",
        "nvme",
    ];

    private static readonly Regex CoreRegex = new(@"core\s*#?\d+", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static void Main()
    {
        var result = BuildResult();
        Console.OutputEncoding = Encoding.UTF8;
        Console.WriteLine(JsonSerializer.Serialize(result, new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        }));
    }

    private static HelperResult BuildResult()
    {
        Computer? computer = null;

        try
        {
            computer = new Computer
            {
                IsCpuEnabled = true,
                IsGpuEnabled = true,
                IsMotherboardEnabled = true,
                IsStorageEnabled = true,
            };

            computer.Open();

            var cpuHardware = new List<IHardware>();
            foreach (var hardware in computer.Hardware)
            {
                UpdateHardwareTree(hardware);
                CollectCpuHardware(hardware, cpuHardware);
            }

            if (cpuHardware.Count == 0)
            {
                return HelperResult.Fail("NO_CPU_HARDWARE", "LibreHardwareMonitorLib did not expose any CPU hardware nodes.");
            }

            var allSensors = cpuHardware
                .SelectMany(CollectCpuTemperatureSensors)
                .ToList();

            var supportedSensors = allSensors
                .Where(sensor => !IsExcludedCpuTemperatureSensor(sensor))
                .ToList();

            if (supportedSensors.Count == 0)
            {
                return HelperResult.Fail(
                    "NO_SUPPORTED_SENSOR",
                    "LibreHardwareMonitorLib did not expose a supported CPU temperature sensor.",
                    allSensors);
            }

            var selected = SelectCpuTemperatureSensor(supportedSensors);
            if (selected is null || !selected.Sensor.Value.HasValue)
            {
                return HelperResult.Fail(
                    "NO_CPU_TEMPERATURE_SENSOR",
                    "LibreHardwareMonitorLib did not provide a usable CPU temperature value.",
                    allSensors);
            }

            return HelperResult.Success(selected, allSensors);
        }
        catch (Exception ex)
        {
            return HelperResult.Fail("UNHANDLED_EXCEPTION", ex.Message);
        }
        finally
        {
            computer?.Close();
        }
    }

    private static void UpdateHardwareTree(IHardware hardware)
    {
        hardware.Update();
        foreach (var subHardware in hardware.SubHardware)
        {
            UpdateHardwareTree(subHardware);
        }
    }

    private static void CollectCpuHardware(IHardware hardware, ICollection<IHardware> target)
    {
        if (hardware.HardwareType == HardwareType.Cpu)
        {
            target.Add(hardware);
        }

        foreach (var subHardware in hardware.SubHardware)
        {
            CollectCpuHardware(subHardware, target);
        }
    }

    private static IEnumerable<SensorSnapshot> CollectCpuTemperatureSensors(IHardware hardware)
    {
        foreach (var sensor in hardware.Sensors.Where(sensor => sensor.SensorType == SensorType.Temperature))
        {
            yield return new SensorSnapshot(
                HardwareName: hardware.Name,
                SensorName: sensor.Name,
                Identifier: sensor.Identifier.ToString(),
                Value: sensor.Value,
                Haystack: $"{hardware.Name} {sensor.Name} {sensor.Identifier}".ToLowerInvariant());
        }
    }

    private static bool IsExcludedCpuTemperatureSensor(SensorSnapshot sensor)
    {
        return ExclusionTerms.Any(term => sensor.Haystack.Contains(term, StringComparison.OrdinalIgnoreCase));
    }

    private static SensorSelection? SelectCpuTemperatureSensor(IReadOnlyList<SensorSnapshot> sensors)
    {
        return SelectByPredicate(sensors, IsCpuPackage, "high")
            ?? SelectByPredicate(sensors, IsPackage, "high")
            ?? SelectByPredicate(sensors, IsTctlTdie, "high")
            ?? SelectByPredicate(sensors, IsTdie, "high")
            ?? SelectByPredicate(sensors, IsTctl, "high")
            ?? SelectByPredicate(sensors, IsCpuCoreMax, "medium")
            ?? SelectByPredicate(sensors, IsCoreMax, "medium")
            ?? SelectMaxCoreSensor(sensors)
            ?? SelectByPredicate(sensors, IsGenericCpuOrProcessor, "low");
    }

    private static SensorSelection? SelectByPredicate(
        IEnumerable<SensorSnapshot> sensors,
        Func<string, bool> predicate,
        string confidence)
    {
        var selected = sensors
            .Where(sensor => predicate(sensor.Haystack) && sensor.Value is > 0)
            .OrderByDescending(sensor => sensor.Value)
            .FirstOrDefault();

        return selected is null ? null : new SensorSelection(selected, confidence);
    }

    private static SensorSelection? SelectMaxCoreSensor(IEnumerable<SensorSnapshot> sensors)
    {
        var selected = sensors
            .Where(sensor => CoreRegex.IsMatch(sensor.Haystack) && sensor.Value is > 0)
            .OrderByDescending(sensor => sensor.Value)
            .FirstOrDefault();

        return selected is null ? null : new SensorSelection(selected, "medium");
    }

    private static bool IsCpuPackage(string haystack) =>
        haystack.Contains("cpu package", StringComparison.OrdinalIgnoreCase);

    private static bool IsPackage(string haystack) =>
        haystack.Contains("package", StringComparison.OrdinalIgnoreCase);

    private static bool IsTctlTdie(string haystack) =>
        haystack.Contains("tctl/tdie", StringComparison.OrdinalIgnoreCase);

    private static bool IsTdie(string haystack) =>
        haystack.Contains("tdie", StringComparison.OrdinalIgnoreCase);

    private static bool IsTctl(string haystack) =>
        haystack.Contains("tctl", StringComparison.OrdinalIgnoreCase);

    private static bool IsCpuCoreMax(string haystack) =>
        haystack.Contains("cpu core max", StringComparison.OrdinalIgnoreCase);

    private static bool IsCoreMax(string haystack) =>
        haystack.Contains("core max", StringComparison.OrdinalIgnoreCase);

    private static bool IsGenericCpuOrProcessor(string haystack) =>
        haystack.Contains("cpu", StringComparison.OrdinalIgnoreCase)
        || haystack.Contains("processor", StringComparison.OrdinalIgnoreCase);
}

internal sealed record SensorSnapshot(
    string HardwareName,
    string SensorName,
    string Identifier,
    float? Value,
    string Haystack);

internal sealed record SensorSelection(
    SensorSnapshot Sensor,
    string Confidence);

internal sealed class HelperResult
{
    public bool Ok { get; init; }
    public CpuTemperaturePayload CpuTemperature { get; init; } = new();
    public string Unit { get; init; } = "°C";
    public string Source { get; init; } = "LibreHardwareMonitorLib";
    public string? HardwareName { get; init; }
    public string? SensorName { get; init; }
    public string? Identifier { get; init; }
    public string Confidence { get; init; } = "unsupported";
    public IReadOnlyList<CpuTemperatureSensorPayload> AllCpuTemperatureSensors { get; init; } = [];
    public string? ErrorCode { get; init; }
    public string? Message { get; init; }

    public static HelperResult Success(SensorSelection selection, IReadOnlyList<SensorSnapshot> allSensors)
    {
        return new HelperResult
        {
            Ok = true,
            CpuTemperature = new CpuTemperaturePayload
            {
                Value = Round(selection.Sensor.Value),
            },
            HardwareName = selection.Sensor.HardwareName,
            SensorName = selection.Sensor.SensorName,
            Identifier = selection.Sensor.Identifier,
            Confidence = selection.Confidence,
            AllCpuTemperatureSensors = allSensors.Select(ToPayload).ToArray(),
            Message = "OK",
        };
    }

    public static HelperResult Fail(string errorCode, string message, IReadOnlyList<SensorSnapshot>? allSensors = null)
    {
        return new HelperResult
        {
            Ok = false,
            CpuTemperature = new CpuTemperaturePayload
            {
                Value = null,
            },
            Confidence = "unsupported",
            AllCpuTemperatureSensors = (allSensors ?? Array.Empty<SensorSnapshot>()).Select(ToPayload).ToArray(),
            ErrorCode = errorCode,
            Message = message,
        };
    }

    private static CpuTemperatureSensorPayload ToPayload(SensorSnapshot sensor)
    {
        return new CpuTemperatureSensorPayload
        {
            Name = sensor.SensorName,
            Identifier = sensor.Identifier,
            HardwareName = sensor.HardwareName,
            Value = Round(sensor.Value),
        };
    }

    private static double? Round(float? value)
    {
        return value.HasValue ? Math.Round(value.Value, 1) : null;
    }
}

internal sealed class CpuTemperaturePayload
{
    public double? Value { get; init; }
}

internal sealed class CpuTemperatureSensorPayload
{
    public string Name { get; init; } = string.Empty;
    public string Identifier { get; init; } = string.Empty;
    public double? Value { get; init; }
    public string? HardwareName { get; init; }
}
