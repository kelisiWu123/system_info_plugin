using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Web.Script.Serialization;
using OpenHardwareMonitor.Hardware;

namespace HWInfoX.WindowsSensorHelper
{
    internal sealed class SensorRow
    {
        public string name { get; set; }
        public string identifier { get; set; }
        public string parent { get; set; }
        public string parentIdentifier { get; set; }
        public string hardwareType { get; set; }
        public string sensorType { get; set; }
        public float? value { get; set; }
        public float? min { get; set; }
        public float? max { get; set; }
    }

    internal sealed class SnapshotResponse
    {
        public int protocolVersion { get; set; }
        public bool ok { get; set; }
        public string helperVersion { get; set; }
        public string backend { get; set; }
        public long generatedAt { get; set; }
        public bool elevated { get; set; }
        public SensorRow[] sensors { get; set; }
        public string error { get; set; }
    }

    internal sealed class StatusResponse
    {
        public int protocolVersion { get; set; }
        public bool ok { get; set; }
        public string helperVersion { get; set; }
        public string backend { get; set; }
        public bool elevated { get; set; }
        public int processId { get; set; }
        public string error { get; set; }
    }

    internal static class Program
    {
        private const int ProtocolVersion = 1;
        private const string HelperVersion = "1.0.1";
        private const string DefaultPipeName = "hwinfox-sensor-helper-v1";
        private const int SeKernelObject = 6;
        private const uint LabelSecurityInformation = 0x00000010;
        private const int SnapshotCacheMilliseconds = 700;
        private const int IdleExitMilliseconds = 1800000;
        private const int AcceptPollMilliseconds = 5000;

        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
        private static readonly object SnapshotLock = new object();

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint SetSecurityInfo(
            IntPtr handle,
            int objectType,
            uint securityInfo,
            IntPtr owner,
            IntPtr group,
            IntPtr dacl,
            IntPtr sacl);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetSecurityDescriptorSacl(
            IntPtr securityDescriptor,
            [MarshalAs(UnmanagedType.Bool)] out bool saclPresent,
            out IntPtr sacl,
            [MarshalAs(UnmanagedType.Bool)] out bool saclDefaulted);

        private static Computer _computer;
        private static string _cachedSnapshotJson;
        private static long _cachedSnapshotAt;
        private static long _lastClientAt;
        private static volatile bool _shutdownRequested;

        private static int Main(string[] args)
        {
            var pipeName = ParsePipeName(args);
            bool ownsMutex;
            using (var mutex = new System.Threading.Mutex(true, "Local\\HWInfoXSensorHelper-v1", out ownsMutex))
            {
                if (!ownsMutex)
                {
                    return 0;
                }

                TryDeleteCrashLog();

                try
                {
                    InitializeComputer();
                    _lastClientAt = UtcNowMilliseconds();
                    RunServer(pipeName);
                    return 0;
                }
                catch (Exception error)
                {
                    TryWriteCrashLog(error);
                    return 1;
                }
                finally
                {
                    CloseComputer();
                }
            }
        }

        private static string ParsePipeName(string[] args)
        {
            for (var i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], "--pipe-name", StringComparison.OrdinalIgnoreCase))
                {
                    var value = (args[i + 1] ?? string.Empty).Trim();
                    if (value.Length > 0) return value;
                }
            }

            return DefaultPipeName;
        }

        private static void InitializeComputer()
        {
            _computer = new Computer();
            SetComputerFlag("IsCpuEnabled");
            SetComputerFlag("IsGpuEnabled");
            SetComputerFlag("IsMotherboardEnabled");
            SetComputerFlag("IsMemoryEnabled");

            var type = typeof(Computer);
            var openWithBool = type.GetMethod("Open", new[] { typeof(bool) });
            if (openWithBool != null)
            {
                openWithBool.Invoke(_computer, new object[] { false });
                return;
            }

            var open = type.GetMethod("Open", Type.EmptyTypes);
            if (open == null) throw new InvalidOperationException("OpenHardwareMonitor Computer.Open is unavailable.");
            open.Invoke(_computer, null);
        }

        private static void SetComputerFlag(string propertyName)
        {
            var property = typeof(Computer).GetProperty(propertyName);
            if (property != null && property.CanWrite && property.PropertyType == typeof(bool))
            {
                property.SetValue(_computer, true, null);
            }
        }

        private static void CloseComputer()
        {
            if (_computer == null) return;
            try
            {
                var close = typeof(Computer).GetMethod("Close", Type.EmptyTypes);
                if (close != null) close.Invoke(_computer, null);
            }
            catch
            {
                // best effort during shutdown
            }
            finally
            {
                _computer = null;
            }
        }

        private static void RunServer(string pipeName)
        {
            while (!_shutdownRequested)
            {
                using (var server = CreatePipeServer(pipeName))
                {
                    var wait = server.BeginWaitForConnection(null, null);
                    var connected = wait.AsyncWaitHandle.WaitOne(AcceptPollMilliseconds);

                    if (!connected)
                    {
                        if (UtcNowMilliseconds() - _lastClientAt >= IdleExitMilliseconds)
                        {
                            return;
                        }
                        continue;
                    }

                    server.EndWaitForConnection(wait);
                    _lastClientAt = UtcNowMilliseconds();
                    HandleClient(server);
                }
            }
        }

        private static NamedPipeServerStream CreatePipeServer(string pipeName)
        {
            var security = BuildPipeSecurity();
            var server = new NamedPipeServerStream(
                pipeName,
                PipeDirection.InOut,
                4,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous,
                16384,
                16384,
                security,
                HandleInheritability.None,
                PipeAccessRights.TakeOwnership);

            try
            {
                ApplyMediumIntegrityLabel(server);
                return server;
            }
            catch
            {
                server.Dispose();
                throw;
            }
        }

        private static PipeSecurity BuildPipeSecurity()
        {
            var security = new PipeSecurity();
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
                PipeAccessRights.FullControl,
                AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(
                new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
                PipeAccessRights.FullControl,
                AccessControlType.Allow));

            var currentUser = WindowsIdentity.GetCurrent().User;
            if (currentUser == null)
            {
                throw new InvalidOperationException("Unable to resolve the current Windows user SID for the sensor helper pipe.");
            }

            security.AddAccessRule(new PipeAccessRule(
                currentUser,
                PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance,
                AccessControlType.Allow));
            return security;
        }

        private static void ApplyMediumIntegrityLabel(NamedPipeServerStream server)
        {
            var descriptor = new RawSecurityDescriptor("S:(ML;;NW;;;ME)");
            var binaryDescriptor = new byte[descriptor.BinaryLength];
            descriptor.GetBinaryForm(binaryDescriptor, 0);

            var pinnedDescriptor = GCHandle.Alloc(binaryDescriptor, GCHandleType.Pinned);
            try
            {
                var descriptorPointer = pinnedDescriptor.AddrOfPinnedObject();
                bool saclPresent;
                bool saclDefaulted;
                IntPtr sacl;
                if (!GetSecurityDescriptorSacl(descriptorPointer, out saclPresent, out sacl, out saclDefaulted) || !saclPresent || sacl == IntPtr.Zero)
                {
                    throw new InvalidOperationException("Unable to construct the medium-integrity label for the sensor helper pipe.");
                }

                var result = SetSecurityInfo(
                    server.SafePipeHandle.DangerousGetHandle(),
                    SeKernelObject,
                    LabelSecurityInformation,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    sacl);
                if (result != 0)
                {
                    throw new IOException("Unable to apply the medium-integrity label to the sensor helper pipe. Win32 error: " + result + ".");
                }
            }
            finally
            {
                pinnedDescriptor.Free();
            }
        }

        private static void HandleClient(Stream stream)
        {
            using (var reader = new StreamReader(stream, new UTF8Encoding(false), false, 4096, true))
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true })
            {
                var command = (reader.ReadLine() ?? string.Empty).Trim().ToLowerInvariant();
                switch (command)
                {
                    case "ping":
                        writer.WriteLine(Serializer.Serialize(BuildStatusResponse()));
                        break;
                    case "snapshot":
                        writer.WriteLine(GetSnapshotJson());
                        break;
                    case "shutdown":
                        writer.WriteLine(Serializer.Serialize(BuildStatusResponse()));
                        _shutdownRequested = true;
                        break;
                    default:
                        writer.WriteLine(Serializer.Serialize(new StatusResponse
                        {
                            protocolVersion = ProtocolVersion,
                            ok = false,
                            helperVersion = HelperVersion,
                            backend = "OpenHardwareMonitorLib",
                            elevated = IsElevated(),
                            processId = Process.GetCurrentProcess().Id,
                            error = "UNKNOWN_COMMAND"
                        }));
                        break;
                }
            }
        }

        private static StatusResponse BuildStatusResponse()
        {
            return new StatusResponse
            {
                protocolVersion = ProtocolVersion,
                ok = true,
                helperVersion = HelperVersion,
                backend = "OpenHardwareMonitorLib",
                elevated = IsElevated(),
                processId = Process.GetCurrentProcess().Id
            };
        }

        private static string GetSnapshotJson()
        {
            lock (SnapshotLock)
            {
                var now = UtcNowMilliseconds();
                if (!string.IsNullOrEmpty(_cachedSnapshotJson) && now - _cachedSnapshotAt < SnapshotCacheMilliseconds)
                {
                    return _cachedSnapshotJson;
                }

                try
                {
                    var sensors = new List<SensorRow>();
                    foreach (var hardware in _computer.Hardware)
                    {
                        CollectHardware(hardware, sensors);
                    }

                    _cachedSnapshotJson = Serializer.Serialize(new SnapshotResponse
                    {
                        protocolVersion = ProtocolVersion,
                        ok = true,
                        helperVersion = HelperVersion,
                        backend = "OpenHardwareMonitorLib",
                        generatedAt = now,
                        elevated = IsElevated(),
                        sensors = sensors.ToArray()
                    });
                    _cachedSnapshotAt = now;
                    return _cachedSnapshotJson;
                }
                catch (Exception error)
                {
                    return Serializer.Serialize(new SnapshotResponse
                    {
                        protocolVersion = ProtocolVersion,
                        ok = false,
                        helperVersion = HelperVersion,
                        backend = "OpenHardwareMonitorLib",
                        generatedAt = now,
                        elevated = IsElevated(),
                        sensors = new SensorRow[0],
                        error = error.GetType().Name + ": " + error.Message
                    });
                }
            }
        }

        private static void CollectHardware(IHardware hardware, List<SensorRow> rows)
        {
            if (hardware == null) return;

            hardware.Update();
            foreach (var sensor in hardware.Sensors)
            {
                if (!sensor.Value.HasValue) continue;
                rows.Add(new SensorRow
                {
                    name = sensor.Name ?? string.Empty,
                    identifier = sensor.Identifier != null ? sensor.Identifier.ToString() : string.Empty,
                    parent = hardware.Name ?? string.Empty,
                    parentIdentifier = hardware.Identifier != null ? hardware.Identifier.ToString() : string.Empty,
                    hardwareType = hardware.HardwareType.ToString(),
                    sensorType = sensor.SensorType.ToString(),
                    value = sensor.Value,
                    min = sensor.Min,
                    max = sensor.Max
                });
            }

            foreach (var subHardware in hardware.SubHardware)
            {
                CollectHardware(subHardware, rows);
            }
        }

        private static bool IsElevated()
        {
            try
            {
                var identity = WindowsIdentity.GetCurrent();
                var principal = new WindowsPrincipal(identity);
                return principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        }

        private static long UtcNowMilliseconds()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        private static void TryDeleteCrashLog()
        {
            try
            {
                var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "HWInfoXSensorHelper.error.log");
                if (File.Exists(path)) File.Delete(path);
            }
            catch
            {
                // stale diagnostics are non-fatal
            }
        }

        private static void TryWriteCrashLog(Exception error)
        {
            try
            {
                var path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "HWInfoXSensorHelper.error.log");
                File.WriteAllText(path, DateTime.Now.ToString("s") + Environment.NewLine + error);
            }
            catch
            {
                // no-op
            }
        }
    }
}
