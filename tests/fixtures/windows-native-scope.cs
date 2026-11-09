using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

public static class WindowsNativeScopeFixture {
    const uint Suspended = 4, NoWindow = 0x08000000, ExtendedStartup = 0x00080000;
    const uint SynchronizeQuery = 0x00101000, Timeout = 258;
    static readonly List<IntPtr> Handles = new List<IntPtr>();
    static readonly HashSet<uint> CapturedPids = new HashSet<uint>();

    [StructLayout(LayoutKind.Sequential)] struct Startup {
        public uint Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx {
        public Startup Basic;
        public IntPtr Attributes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
        public IntPtr Process, Thread;
        public uint ProcessId, ThreadId;
    }
    [StructLayout(LayoutKind.Sequential)] struct Capabilities {
        public IntPtr Sid, Entries;
        public uint Count, Reserved;
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }

    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(
        string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
    [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
    [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint version, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorSacl(
        IntPtr descriptor, out bool present, out IntPtr sacl, out bool defaulted);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern uint SetNamedSecurityInfoW(
        string path, uint type, uint sections, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, IntPtr name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting value, uint size, IntPtr returned);
    [DllImport("kernel32.dll", EntryPoint = "QueryInformationJobObject", SetLastError = true)]
    static extern bool QueryProcessList(IntPtr job, int type, IntPtr value, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetProcessId(IntPtr process);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int type, IntPtr buffer, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr key, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd,
        ref StartupEx startup, out ProcessInfo process);

    static void Check(bool success, string operation) {
        if (!success) {
            int code = Marshal.GetLastWin32Error();
            throw new Win32Exception(code, operation + " (Win32 " + code + "): " + new Win32Exception(code).Message);
        }
    }
    static void Require(bool success, string message) {
        if (!success) throw new InvalidOperationException(message);
    }
    static void Close(IntPtr handle) {
        if (handle != IntPtr.Zero) Check(CloseHandle(handle), "CloseHandle");
    }
    static string Quote(string value) {
        Require(value.IndexOf('"') < 0 && !value.EndsWith("\\"), "Unexpected fixture argument.");
        return "\"" + value + "\"";
    }
    static string Command(string executable, params string[] arguments) {
        string result = Quote(executable);
        foreach (string value in arguments) result += " " + Quote(value);
        return result;
    }
    static SortedDictionary<string, string> MinimumEnvironment(string workspace) {
        string windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        return new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            { "APPDATA", Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData) },
            { "LOCALAPPDATA", Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) },
            { "PATH", Environment.SystemDirectory },
            { "SystemDrive", Path.GetPathRoot(windows).TrimEnd('\\') },
            { "SystemRoot", windows },
            { "TEMP", workspace },
            { "TMP", workspace },
            { "USERPROFILE", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) },
            { "windir", windows }
        };
    }
    static ProcessStartInfo StartInfo(string executable, string arguments, string workspace) {
        var start = new ProcessStartInfo(executable, arguments);
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WorkingDirectory = workspace;
        start.EnvironmentVariables.Clear();
        foreach (var entry in MinimumEnvironment(workspace)) start.EnvironmentVariables[entry.Key] = entry.Value;
        return start;
    }
    static void WaitFile(string path) {
        var elapsed = Stopwatch.StartNew();
        string errorPath = Path.Combine(Path.GetDirectoryName(path),
            Path.GetFileName(path) == "broker-ready" ? "broker.error" :
            Path.GetFileNameWithoutExtension(path) + ".error");
        while (!File.Exists(path)) {
            if (File.Exists(errorPath)) {
                Require(new FileInfo(errorPath).Length <= 16384, "Fixture diagnostics exceeded their bound.");
                throw new InvalidOperationException(File.ReadAllText(errorPath));
            }
            Require(elapsed.ElapsedMilliseconds < 10000, "Fixture readiness timed out: " + Path.GetFileName(path));
            Thread.Sleep(20);
        }
    }
    static void LabelWorkspace(string workspace) {
        IntPtr descriptor;
        uint size;
        Check(ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;OICI;NW;;;LW)", 1, out descriptor, out size),
            "create fixture low-integrity label");
        try {
            bool present, defaulted;
            IntPtr sacl;
            Check(GetSecurityDescriptorSacl(descriptor, out present, out sacl, out defaulted), "read fixture label");
            Require(present && sacl != IntPtr.Zero, "Missing workspace label.");
            uint result = SetNamedSecurityInfoW(workspace, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
            if (result != 0) throw new Win32Exception((int)result, "label fixture workspace");
        } finally { Check(LocalFree(descriptor) == IntPtr.Zero, "free fixture label"); }
    }
    static void Ready(string workspace, string role) {
        string file = Path.Combine(workspace, role + ".pid");
        File.WriteAllText(file + ".tmp", Process.GetCurrentProcess().Id.ToString());
        File.Move(file + ".tmp", file);
    }
    static uint Active(IntPtr job) {
        Accounting value;
        Check(QueryInformationJobObject(job, 1, out value, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero), "query job");
        return value.ActiveProcesses;
    }
    static string DescribeJob(IntPtr job) {
        int size = 8 + 32 * IntPtr.Size;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            Check(QueryProcessList(job, 3, buffer, (uint)size, IntPtr.Zero), "query bounded job diagnostics");
            int count = Marshal.ReadInt32(buffer, 4);
            Require(count >= 0 && count <= 32, "Job diagnostics exceeded their bound.");
            var details = new List<string>();
            for (int index = 0; index < count; index++) {
                int pid = checked((int)Marshal.ReadIntPtr(buffer, 8 + index * IntPtr.Size).ToInt64());
                string name;
                try { using (Process process = Process.GetProcessById(pid)) name = process.ProcessName; }
                catch (ArgumentException) { name = "already-exited"; }
                details.Add(pid + ":" + name);
            }
            return string.Join(",", details.ToArray());
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static void VerifyToken(IntPtr process, SecurityIdentifier expected) {
        IntPtr token;
        Check(OpenProcessToken(process, 8, out token), "open actor token");
        try {
            uint size;
            bool queried = GetTokenInformation(token, 31, IntPtr.Zero, 0, out size);
            Require(!queried && Marshal.GetLastWin32Error() == 122 && size > 0 && size <= 4096,
                "Unexpected AppContainer token information.");
            IntPtr buffer = Marshal.AllocHGlobal((int)size);
            try {
                Check(GetTokenInformation(token, 31, buffer, size, out size), "query actor AppContainer");
                IntPtr sid = Marshal.ReadIntPtr(buffer);
                Require(sid != IntPtr.Zero && new SecurityIdentifier(sid).Equals(expected), "Wrong actor AppContainer.");
            } finally { Marshal.FreeHGlobal(buffer); }
        } finally { Close(token); }
    }
    static IntPtr Capture(string workspace, string role, SecurityIdentifier sid, IntPtr job) {
        string path = Path.Combine(workspace, role + ".pid");
        WaitFile(path);
        uint pid;
        Require(uint.TryParse(File.ReadAllText(path), out pid) && pid > 0, "Invalid actor PID.");
        Require(CapturedPids.Add(pid), "Actor roles must identify distinct original processes.");
        IntPtr handle = OpenProcess(SynchronizeQuery, false, pid);
        Check(handle != IntPtr.Zero, "retain actor process");
        Handles.Add(handle);
        Require(WaitForSingleObject(handle, 0) == Timeout, "Actor exited before capture.");
        VerifyToken(handle, sid);
        if (job != IntPtr.Zero) {
            bool member;
            Check(IsProcessInJob(handle, job, out member), "verify job membership");
            Require(member, "Actor escaped its Job Object.");
        }
        return handle;
    }
    static void ReapHandles() {
        var failures = new List<Exception>();
        foreach (IntPtr handle in Handles) {
            try { Require(WaitForSingleObject(handle, 5000) == 0, "Original actor did not terminate."); }
            catch (Exception error) { failures.Add(error); }
            try { Close(handle); }
            catch (Exception error) { failures.Add(error); }
        }
        Handles.Clear();
        CapturedPids.Clear();
        if (failures.Count > 0) throw new AggregateException("Actor cleanup failed.", failures);
    }
    static void WithCleanup(Action operation, Action cleanup) {
        Exception failure = null;
        try { operation(); }
        catch (Exception error) { failure = error; }
        try { cleanup(); }
        catch (Exception error) {
            if (failure != null) throw new AggregateException("Fixture and cleanup failed.", failure, error);
            throw;
        }
        if (failure != null) throw failure;
    }
    static void RunScope(string root, string executable, string profile, string mode) {
        string workspace = Path.Combine(root, mode);
        IntPtr sid;
        Marshal.ThrowExceptionForHR(DeriveAppContainerSidFromAppContainerName(profile, out sid));
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, capsBuffer = IntPtr.Zero, environment = IntPtr.Zero;
        bool initialized = false;
        WithCleanup(delegate {
            job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
            Check(job != IntPtr.Zero, "create unnamed non-inherited job");
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000;
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "set kill-on-close");
            IntPtr size = IntPtr.Zero;
            bool sized = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            Require(!sized && Marshal.GetLastWin32Error() == 122 && size.ToInt64() > 0 && size.ToInt64() <= 65536,
                "Unexpected process attribute size.");
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size), "initialize process attributes");
            initialized = true;
            var caps = new Capabilities();
            caps.Sid = sid;
            capsBuffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Capabilities)));
            Marshal.StructureToPtr(caps, capsBuffer, false);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20009), capsBuffer,
                new IntPtr(Marshal.SizeOf(typeof(Capabilities))), IntPtr.Zero, IntPtr.Zero), "set AppContainer");
            var environmentText = new StringBuilder();
            foreach (var entry in MinimumEnvironment(workspace)) environmentText.Append(entry.Key + "=" + entry.Value + "\0");
            byte[] environmentBytes = Encoding.Unicode.GetBytes(environmentText.ToString() + "\0");
            environment = Marshal.AllocHGlobal(environmentBytes.Length);
            Marshal.Copy(environmentBytes, 0, environment, environmentBytes.Length);
            var startup = new StartupEx();
            startup.Basic.Size = (uint)Marshal.SizeOf(typeof(StartupEx));
            startup.Attributes = attributes;
            ProcessInfo actor;
            Check(CreateProcessW(executable, new StringBuilder(Command(executable, "worker", workspace,
                Path.Combine(root, "reviewed.txt"), Process.GetCurrentProcess().Id.ToString())),
                IntPtr.Zero, IntPtr.Zero, false, Suspended | NoWindow | ExtendedStartup | 0x400,
                environment, workspace, ref startup, out actor), "create suspended AppContainer actor");
            Handles.Add(actor.Process);
            try {
                if (!AssignProcessToJobObject(job, actor.Process)) {
                    int error = Marshal.GetLastWin32Error();
                    Check(TerminateProcess(actor.Process, 1), "terminate unassigned suspended actor");
                    throw new Win32Exception(error, "assign actor before resume");
                }
                Require(ResumeThread(actor.Thread) != uint.MaxValue, "ResumeThread failed.");
            } finally { Close(actor.Thread); }
            var expected = new SecurityIdentifier(sid);
            IntPtr worker = Capture(workspace, "worker", expected, job);
            Require(GetProcessId(worker) == actor.ProcessId, "Worker is not the originally suspended process.");
            Capture(workspace, "child", expected, job);
            Capture(workspace, "grandchild", expected, job);
            Require(Active(job) == 3, "Unexpected active job membership: " + Active(job) + " [" + DescribeJob(job) + "].");
            Require(File.ReadAllText(Path.Combine(workspace, "checks")) == "read;write-denied;dacl-denied;dup-denied;breakaway-denied",
                "Missing protection evidence.");
            if (mode == "owner-death") {
                File.WriteAllText(Path.Combine(root, "broker-ready"), "verified");
                Thread.Sleep(30000);
                throw new InvalidOperationException("Broker death probe was not interrupted.");
            }
            if (mode == "finish") {
                File.WriteAllText(Path.Combine(workspace, "finish"), "F");
                Require(WaitForSingleObject(actor.Process, 5000) == 0, "Direct worker failed to finish.");
                uint code;
                Check(GetExitCodeProcess(actor.Process, out code), "query direct worker exit");
                Require(code == 0 && Active(job) == 2, "Direct completion did not retain both detached descendants.");
            } else {
                Check(TerminateJobObject(job, 1), "abort job");
                foreach (IntPtr handle in Handles) Require(WaitForSingleObject(handle, 5000) == 0, "Abort left an actor alive.");
                Require(Active(job) == 0, "Aborted job is not empty.");
            }
        }, delegate {
            WithCleanup(delegate { Close(job); }, delegate {
                WithCleanup(ReapHandles, delegate {
                    if (initialized) DeleteProcThreadAttributeList(attributes);
                    if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                    if (capsBuffer != IntPtr.Zero) Marshal.FreeHGlobal(capsBuffer);
                    if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                    FreeSid(sid);
                });
            });
        });
    }
    static void OwnerDeath(string root, string executable, string profile, SecurityIdentifier sid) {
        string workspace = Path.Combine(root, "owner-death");
        using (Process broker = Process.Start(StartInfo(executable,
            Quote("broker") + " " + Quote(root) + " " + Quote(profile), workspace))) {
            WithCleanup(delegate {
                WaitFile(Path.Combine(root, "broker-ready"));
                Require(File.ReadAllText(Path.Combine(root, "broker-ready")) == "verified", "Invalid broker readiness.");
                Capture(workspace, "worker", sid, IntPtr.Zero);
                Capture(workspace, "child", sid, IntPtr.Zero);
                Capture(workspace, "grandchild", sid, IntPtr.Zero);
                Check(TerminateProcess(broker.Handle, 1), "kill actual broker");
                Require(broker.WaitForExit(5000), "Original broker survived termination.");
            }, delegate {
                if (!broker.HasExited) {
                    Check(TerminateProcess(broker.Handle, 1), "cleanup broker");
                    Require(broker.WaitForExit(5000), "Broker cleanup timed out.");
                }
                ReapHandles();
            });
        }
    }
    public static void Probe(string root, string executable) {
        string profile = "loom-native-" + Guid.NewGuid().ToString("N");
        IntPtr sid;
        Marshal.ThrowExceptionForHR(CreateAppContainerProfile(profile, profile, "Disposable Skill Loom CI fixture",
            IntPtr.Zero, 0, out sid));
        WithCleanup(delegate {
            var app = new SecurityIdentifier(sid);
            var owner = WindowsIdentity.GetCurrent().User;
            var security = new DirectorySecurity();
            security.SetAccessRuleProtection(true, false);
            security.SetOwner(owner);
            var inherit = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
            security.AddAccessRule(new FileSystemAccessRule(owner, FileSystemRights.FullControl, inherit, PropagationFlags.None, AccessControlType.Allow));
            security.AddAccessRule(new FileSystemAccessRule(app, FileSystemRights.ReadAndExecute, inherit, PropagationFlags.None, AccessControlType.Allow));
            Directory.SetAccessControl(root, security);
            var executableSecurity = new FileSecurity();
            executableSecurity.SetAccessRuleProtection(true, false);
            executableSecurity.SetOwner(owner);
            executableSecurity.AddAccessRule(new FileSystemAccessRule(owner, FileSystemRights.FullControl, AccessControlType.Allow));
            executableSecurity.AddAccessRule(new FileSystemAccessRule(app, FileSystemRights.ReadAndExecute, AccessControlType.Allow));
            File.SetAccessControl(executable, executableSecurity);
            File.WriteAllText(Path.Combine(root, "reviewed.txt"), "reviewed fixture content");
            foreach (string mode in new string[] { "finish", "abort", "owner-death" }) {
                string workspace = Path.Combine(root, mode);
                Directory.CreateDirectory(workspace);
                var writable = Directory.GetAccessControl(workspace);
                writable.AddAccessRule(new FileSystemAccessRule(app, FileSystemRights.Modify, inherit, PropagationFlags.None, AccessControlType.Allow));
                Directory.SetAccessControl(workspace, writable);
                LabelWorkspace(workspace);
            }
            RunScope(root, executable, profile, "finish");
            RunScope(root, executable, profile, "abort");
            OwnerDeath(root, executable, profile, app);
            Require(File.ReadAllText(Path.Combine(root, "reviewed.txt")) == "reviewed fixture content", "Reviewed bytes changed.");
            Console.WriteLine("{\"platform\":\"windows\",\"candidate\":\"appcontainer-job\",\"protectedWritesDenied\":true,\"breakawayDenied\":true,\"brokerHandleDuplicationDenied\":true,\"originalProcessesTerminated\":true,\"modes\":[\"finish\",\"abort\",\"broker-death\"]}");
        }, delegate {
            FreeSid(sid);
            Marshal.ThrowExceptionForHR(DeleteAppContainerProfile(profile));
        });
    }
    static int Actor(string[] args) {
        string role = args[0], workspace = args[1];
        string executable = typeof(WindowsNativeScopeFixture).Assembly.Location;
        if (role == "worker") {
            string reviewed = args[2];
            Require(File.ReadAllText(reviewed) == "reviewed fixture content", "Reviewed read failed.");
            bool writeDenied = false, aclDenied = false;
            try { File.WriteAllText(reviewed, "changed"); }
            catch (UnauthorizedAccessException) { writeDenied = true; }
            try {
                var changedAcl = File.GetAccessControl(reviewed);
                changedAcl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,
                    FileSystemRights.FullControl, AccessControlType.Allow));
                File.SetAccessControl(reviewed, changedAcl);
            }
            catch (UnauthorizedAccessException) { aclDenied = true; }
            Require(writeDenied && aclDenied, "Protected write denied: " + writeDenied + "; actual ACL update denied: " + aclDenied + ".");
            IntPtr broker = OpenProcess(0x40, false, uint.Parse(args[3]));
            if (broker != IntPtr.Zero) { Close(broker); throw new InvalidOperationException("Broker handle duplication was permitted."); }
            Require(Marshal.GetLastWin32Error() == 5, "Unexpected broker access error.");
            var startup = new StartupEx();
            startup.Basic.Size = (uint)Marshal.SizeOf(typeof(Startup));
            ProcessInfo escape;
            bool escaped = CreateProcessW(executable, new StringBuilder(Command(executable, "nop")), IntPtr.Zero,
                IntPtr.Zero, false, Suspended | NoWindow | 0x01000000, IntPtr.Zero, workspace, ref startup, out escape);
            if (escaped) {
                try { Check(TerminateProcess(escape.Process, 1), "terminate escaped probe"); }
                finally { Close(escape.Thread); Close(escape.Process); }
                throw new InvalidOperationException("Job breakaway was permitted.");
            }
            Require(Marshal.GetLastWin32Error() == 5, "Unexpected job breakaway error.");
            File.WriteAllText(Path.Combine(workspace, "checks"), "read;write-denied;dacl-denied;dup-denied;breakaway-denied");
        }
        if (role != "grandchild") {
            string next = role == "worker" ? "child" : "grandchild";
            var startup = new StartupEx();
            startup.Basic.Size = (uint)Marshal.SizeOf(typeof(Startup));
            ProcessInfo child;
            Check(CreateProcessW(executable, new StringBuilder(Command(executable, next, workspace)),
                IntPtr.Zero, IntPtr.Zero, false, 0x8 | 0x200, IntPtr.Zero, workspace, ref startup, out child),
                "create detached descendant in a new process group");
            Close(child.Thread);
            try {
                Ready(workspace, role);
                if (role == "worker") { WaitFile(Path.Combine(workspace, "finish")); return 0; }
                Thread.Sleep(30000);
                throw new InvalidOperationException("Descendant safety deadline reached.");
            } finally { Close(child.Process); }
        }
        Ready(workspace, role);
        Thread.Sleep(30000);
        throw new InvalidOperationException("Grandchild safety deadline reached.");
    }
    public static int Main(string[] args) {
        try {
            if (args.Length == 1 && args[0] == "nop") return 0;
            if (args.Length == 3 && args[0] == "broker") {
                RunScope(args[1], typeof(WindowsNativeScopeFixture).Assembly.Location, args[2], "owner-death");
                return 0;
            }
            Require(args.Length >= 2 && (args[0] == "worker" || args[0] == "child" || args[0] == "grandchild"), "Invalid fixture role.");
            return Actor(args);
        } catch (Exception error) {
            if (args.Length >= 2 && (args[0] == "worker" || args[0] == "child" || args[0] == "grandchild" || args[0] == "broker")) {
                File.WriteAllText(Path.Combine(args[1], args[0] + ".error"), error.ToString());
            }
            Console.Error.WriteLine(error);
            return 1;
        }
    }
}
