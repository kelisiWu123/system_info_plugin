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
        private const string SecurityPrivilegeName = "SeSecurityPrivilege";
        private const int SeKernelObject = 6;
        private const uint LabelSecurityInformation = 0x00000010;
        private const uint SePrivilegeEnabled = 0x00000002;
        private const int ErrorNotAllAssigned = 1300;
        private const int SnapshotCacheMilliseconds = 700;
        private const int IdleExitMilliseconds = 1800000;
        private const int AcceptPollMilliseconds = 5000;

        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
        private static readonly object SnapshotLock = new object();

        [StructLayout(LayoutKind.Sequential)]
        private struct Luid
        {
            public uint lowPart;
            public int highPart;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LuidAndAttributes
        {
            public Luid luid;
            public uint attributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct TokenPrivileges
        {
            public uint privilegeCount;
            public LuidAndAttributes privileges;
        }

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

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool LookupPrivilegeValue(
            string systemName,
            string name,
            out Luid luid);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AdjustTokenPrivileges(
            IntPtr tokenHandle,
            [MarshalAs(UnmanagedType.Bool)] bool disableAllPrivileges,
            ref TokenPrivileges newState,
            uint bufferLength,
            out TokenPrivileges previousState,
            out uint returnLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool AdjustTokenPrivileges(
            IntPtr tokenHandle,
            [MarshalAs(UnmanagedType.Bool)] bool disableAllPrivileges,
            ref TokenPrivileges newState,
            uint bufferLength,
            IntPtr previousState,
            IntPtr returnLength);

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
                    var clientSid = ParseClientSid(args);
                    InitializeComputer();
                    _lastClientAt = UtcNowMilliseconds();
                    RunServer(pipeName, clientSid);
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

        private static SecurityIdentifier ParseClientSid(string[] args)
        {
            for (var i = 0; i < args.Length; i++)
            {
                if (!string.Equals(args[i], "--client-sid", StringComparison.OrdinalIgnoreCase)) continue;
                if (i + 1 >= args.Length)
                {
                    throw new ArgumentException("The --client-sid option requires a Windows account SID value.");
                }

                var value = (args[i + 1] ?? string.Empty).Trim();
                if (value.Length == 0)
                {
                    throw new ArgumentException("The --client-sid option requires a Windows account SID value.");
                }

                try
                {
                    var sid = new SecurityIdentifier(value);
                    if (!sid.IsAccountSid())
                    {
                        throw new ArgumentException("The --client-sid option must identify a Windows account SID.");
                    }
                    return sid;
                }
                catch (ArgumentException error)
                {
                    throw new ArgumentException("The --client-sid option contains an invalid Windows account SID.", error);
                }
            }

            return null;
        }

        private sealed class TokenPrivilegeScope : IDisposable
        {
            private WindowsIdentity _identity;
            private readonly TokenPrivileges _previousState;
            private readonly bool _restorePreviousState;

            public TokenPrivilegeScope(WindowsIdentity identity, TokenPrivileges previousState, bool restorePreviousState)
            {
                _identity = identity;
                _previousState = previousState;
                _restorePreviousState = restorePreviousState;
            }

            public void Dispose()
            {
                var identity = _identity;
                if (identity == null) return;
                _identity = null;

                try
                {
                    if (_restorePreviousState)
                    {
                        var previousState = _previousState;
                        AdjustTokenPrivileges(
                            identity.Token,
                            false,
                            ref previousState,
                            0,
                            IntPtr.Zero,
                            IntPtr.Zero);
                    }
                }
                finally
                {
                    identity.Dispose();
                }
            }
        }

        private static TokenPrivilegeScope EnableTokenPrivilege(string privilegeName)
        {
            var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.AdjustPrivileges | TokenAccessLevels.Query);
            if (identity == null)
            {
                throw new InvalidOperationException("Unable to open the current process token for " + privilegeName + ".");
            }

            try
            {
                Luid luid;
                if (!LookupPrivilegeValue(null, privilegeName, out luid))
                {
                    throw CreateWin32Exception("Unable to resolve " + privilegeName + ".");
                }

                var requestedState = new TokenPrivileges
                {
                    privilegeCount = 1,
                    privileges = new LuidAndAttributes
                    {
                        luid = luid,
                        attributes = SePrivilegeEnabled
                    }
                };
                TokenPrivileges previousState;
                uint previousStateLength;
                if (!AdjustTokenPrivileges(
                    identity.Token,
                    false,
                    ref requestedState,
                    (uint)Marshal.SizeOf(typeof(TokenPrivileges)),
                    out previousState,
                    out previousStateLength))
                {
                    throw CreateWin32Exception("Unable to enable " + privilegeName + ".");
                }

                if (Marshal.GetLastWin32Error() == ErrorNotAllAssigned)
                {
                    throw new UnauthorizedAccessException(
                        "The elevated sensor helper does not hold " + privilegeName + ".");
                }

                return new TokenPrivilegeScope(identity, previousState, previousStateLength > 0);
            }
            catch
            {
                identity.Dispose();
                throw;
            }
        }

        private static InvalidOperationException CreateWin32Exception(string message)
        {
            return new InvalidOperationException(message + " Win32 error: " + Marshal.GetLastWin32Error() + ".");
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

        private static void RunServer(string pipeName, SecurityIdentifier clientSid)
        {
            while (!_shutdownRequested)
            {
                using (var server = CreatePipeServer(pipeName, clientSid))
                {
                    try
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
                    catch (IOException)
                    {
                        // A client can close its pipe immediately after connecting. Recreate the
                        // server instance instead of taking down the shared sensor process.
                    }
                    catch (ObjectDisposedException)
                    {
                        // Treat an aborted connection like a disconnected client.
                    }
                    catch (InvalidOperationException)
                    {
                        // Begin/EndWaitForConnection can report an aborted pipe this way.
                    }
                }
            }
        }

        private static NamedPipeServerStream CreatePipeServer(string pipeName, SecurityIdentifier clientSid)
        {
            var security = BuildPipeSecurity(clientSid);
            // LABEL_SECURITY_INFORMATION needs WRITE_OWNER on the server handle, while
            // ACCESS_SYSTEM_SECURITY is required to write the pipe SACL. Enable the
            // latter's privilege only while the mandatory label is being installed.
            using (EnableTokenPrivilege(SecurityPrivilegeName))
            {
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
                    PipeAccessRights.TakeOwnership | PipeAccessRights.AccessSystemSecurity);

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
        }

        private static PipeSecurity BuildPipeSecurity(SecurityIdentifier clientSid)
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
                PipeAccessRights.ReadWrite,
                AccessControlType.Allow));

            // When UAC credentials belong to a different administrator account, the
            // elevated helper's current SID is not the Electron client's SID. Grant the
            // caller supplied account only the read/write access needed to use the pipe.
            if (clientSid != null && !clientSid.Equals(currentUser))
            {
                security.AddAccessRule(new PipeAccessRule(
                    clientSid,
                    PipeAccessRights.ReadWrite,
                    AccessControlType.Allow));
            }
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
