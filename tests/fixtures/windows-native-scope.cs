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
    static readonly object OutputLock = new object();
    static readonly StringBuilder TerminalOutput = new StringBuilder();
    static Exception TerminalError;
    static IntPtr ActorConsoleOutput;

    [StructLayout(LayoutKind.Sequential)] struct Coord {
        public short X, Y;
        public Coord(short x, short y) { X = x; Y = y; }
    }
    [StructLayout(LayoutKind.Sequential)] struct ConsoleInfo {
        public Coord Size, Cursor;
        public ushort Attributes;
        public short Left, Top, Right, Bottom;
        public Coord Maximum;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ProcessEntry {
        public uint Size, Usage, ProcessId;
        public UIntPtr Heap;
        public uint Module, Threads, ParentId;
        public int Priority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Name;
    }

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
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder path, ref uint size);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int type, IntPtr buffer, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr key, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes,
        IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd,
        ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr attributes, uint size);
    [DllImport("kernel32.dll")] static extern int CreatePseudoConsole(Coord size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
    [DllImport("kernel32.dll")] static extern int ResizePseudoConsole(IntPtr console, Coord size);
    [DllImport("kernel32.dll")] static extern void ClosePseudoConsole(IntPtr console);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr file, byte[] buffer, uint size, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr file, byte[] buffer, uint size, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetConsoleMode(IntPtr console, out uint mode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleMode(IntPtr console, uint mode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetConsoleScreenBufferInfo(IntPtr console, out ConsoleInfo info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);

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
            Path.GetFileName(path).EndsWith("-ready") ? Path.GetFileName(path).Replace("-ready", ".error") :
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
    static List<uint> JobPids(IntPtr job) {
        int size = 8 + 32 * IntPtr.Size;
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            Check(QueryProcessList(job, 3, buffer, (uint)size, IntPtr.Zero), "query bounded job diagnostics");
            int count = Marshal.ReadInt32(buffer, 4);
            Require(count >= 0 && count <= 32, "Job diagnostics exceeded their bound.");
            Require(Marshal.ReadInt32(buffer) == count, "Incomplete job process census.");
            var pids = new List<uint>();
            for (int index = 0; index < count; index++) {
                uint pid = checked((uint)Marshal.ReadIntPtr(buffer, 8 + index * IntPtr.Size).ToInt64());
                Require(pid > 0 && !pids.Contains(pid), "Invalid job process census.");
                pids.Add(pid);
            }
            return pids;
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    static void CaptureConsole(uint pid, IntPtr job) {
        Require(CapturedPids.Add(pid), "Console host aliases an actor.");
        IntPtr handle = OpenProcess(SynchronizeQuery, false, pid);
        Check(handle != IntPtr.Zero, "retain original console host");
        Handles.Add(handle);
        Require(WaitForSingleObject(handle, 0) == Timeout, "Console host exited before capture.");
        var image = new StringBuilder(32768);
        uint size = (uint)image.Capacity;
        Check(QueryFullProcessImageNameW(handle, 0, image, ref size), "identify console host");
        Require(string.Equals(image.ToString(), Path.Combine(Environment.SystemDirectory, "conhost.exe"),
            StringComparison.OrdinalIgnoreCase), "Unexpected extra Job member: " + image);
        if (job != IntPtr.Zero) {
            bool member;
            Check(IsProcessInJob(handle, job, out member), "verify console host job membership");
            Require(member, "Console host escaped its Job Object.");
        }
    }
    static HashSet<uint> ChildPids() {
        return ChildPidsOf((uint)Process.GetCurrentProcess().Id);
    }
    static HashSet<uint> ChildPidsOf(uint parent) {
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        Check(snapshot != new IntPtr(-1), "snapshot fixture children");
        try {
            var entry = new ProcessEntry();
            entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            Check(Process32FirstW(snapshot, ref entry), "first fixture process");
            var result = new HashSet<uint>();
            do {
                if (entry.ParentId == parent) result.Add(entry.ProcessId);
            } while (Process32NextW(snapshot, ref entry));
            Require(Marshal.GetLastWin32Error() == 18, "Incomplete fixture process snapshot.");
            return result;
        } finally { Close(snapshot); }
    }
    static void DrainTerminal(IntPtr output) {
        try {
            byte[] buffer = new byte[4096];
            for (;;) {
                uint read;
                bool ok = ReadFile(output, buffer, (uint)buffer.Length, out read, IntPtr.Zero);
                if (!ok) {
                    if (Marshal.GetLastWin32Error() == 109) return;
                    Check(false, "drain pseudoconsole");
                }
                if (read == 0) return;
                lock (OutputLock) {
                    Require(TerminalOutput.Length + read <= 65536, "Pseudoconsole output exceeded its bound.");
                    TerminalOutput.Append(Encoding.ASCII.GetString(buffer, 0, (int)read));
                }
            }
        } catch (Exception error) { lock (OutputLock) TerminalError = error; }
    }
    static void RequireTerminalOutput(string expected) {
        var elapsed = Stopwatch.StartNew();
        for (;;) {
            lock (OutputLock) {
                if (TerminalError != null) throw new InvalidOperationException("Pseudoconsole drain failed.", TerminalError);
                if (TerminalOutput.ToString().Contains(expected)) return;
            }
            Require(elapsed.ElapsedMilliseconds < 5000, "Missing pseudoconsole output: " + expected);
            Thread.Sleep(20);
        }
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
    static void RunScope(string root, string executable, string profile, string mode, bool terminal = false) {
        string prefix = terminal ? "terminal-" : "";
        string workspace = Path.Combine(root, prefix + mode);
        IntPtr sid;
        Marshal.ThrowExceptionForHR(DeriveAppContainerSidFromAppContainerName(profile, out sid));
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero, capsBuffer = IntPtr.Zero, environment = IntPtr.Zero;
        IntPtr console = IntPtr.Zero, inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero;
        IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        Thread drain = null;
        uint consolePid = 0;
        bool initialized = false;
        WithCleanup(delegate {
            job = CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
            Check(job != IntPtr.Zero, "create unnamed non-inherited job");
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000;
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "set kill-on-close");
            IntPtr size = IntPtr.Zero;
            int attributeCount = terminal ? 2 : 1;
            bool sized = InitializeProcThreadAttributeList(IntPtr.Zero, attributeCount, 0, ref size);
            Require(!sized && Marshal.GetLastWin32Error() == 122 && size.ToInt64() > 0 && size.ToInt64() <= 65536,
                "Unexpected process attribute size.");
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, attributeCount, 0, ref size), "initialize process attributes");
            initialized = true;
            var caps = new Capabilities();
            caps.Sid = sid;
            capsBuffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Capabilities)));
            Marshal.StructureToPtr(caps, capsBuffer, false);
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20009), capsBuffer,
                new IntPtr(Marshal.SizeOf(typeof(Capabilities))), IntPtr.Zero, IntPtr.Zero), "set AppContainer");
            if (terminal) {
                var before = ChildPids();
                Check(CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0), "create pseudoconsole input");
                Check(CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0), "create pseudoconsole output");
                lock (OutputLock) { TerminalOutput.Clear(); TerminalError = null; }
                drain = new Thread(delegate() { DrainTerminal(outputRead); });
                drain.IsBackground = true;
                drain.Start();
                Marshal.ThrowExceptionForHR(CreatePseudoConsole(new Coord(80, 24), inputRead, outputWrite, 0, out console));
                Close(inputRead); inputRead = IntPtr.Zero;
                Close(outputWrite); outputWrite = IntPtr.Zero;
                var added = ChildPids();
                added.ExceptWith(before);
                Require(added.Count == 1, "Pseudoconsole must create exactly one original host child.");
                foreach (uint pid in added) consolePid = pid;
                CaptureConsole(consolePid, IntPtr.Zero);
                Marshal.ThrowExceptionForHR(ResizePseudoConsole(console, new Coord(100, 40)));
                Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20016), console,
                    new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "attach pseudoconsole");
            }
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
                Path.Combine(root, "reviewed.txt"), Process.GetCurrentProcess().Id.ToString(), terminal ? "terminal" : "ordinary")),
                IntPtr.Zero, IntPtr.Zero, false, Suspended | (terminal ? 0u : NoWindow) | ExtendedStartup | 0x400,
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
            if (terminal) {
                uint written;
                byte[] input = Encoding.ASCII.GetBytes("LS");
                Check(WriteFile(inputWrite, input, (uint)input.Length, out written, IntPtr.Zero), "write pseudoconsole input");
                Require(written == input.Length, "Incomplete pseudoconsole input.");
            }
            var expected = new SecurityIdentifier(sid);
            IntPtr worker = Capture(workspace, "worker", expected, job);
            Require(GetProcessId(worker) == actor.ProcessId, "Worker is not the originally suspended process.");
            IntPtr child = Capture(workspace, "child", expected, job);
            IntPtr grandchild = Capture(workspace, "grandchild", expected, job);
            List<uint> members = JobPids(job);
            if (terminal) {
                Require(members.Count == 3 && Active(job) == 3 && !members.Contains(consolePid),
                    "Pseudoconsole host and actor job scopes were not distinct.");
                foreach (uint pid in members) Require(CapturedPids.Contains(pid), "Untracked terminal Job member.");
                RequireTerminalOutput("LOOM_TERMINAL_READY");
                RequireTerminalOutput("LOOM_STDIO_VERIFIED");
                RequireTerminalOutput("LOOM_STDERR_VERIFIED");
            } else {
                Require(members.Count == 4 && Active(job) == 4, "Expected three actors and one console host.");
                foreach (uint pid in members) {
                    if (!CapturedPids.Contains(pid)) {
                        Require(consolePid == 0, "Unexpected additional Job member.");
                        consolePid = pid;
                    }
                }
                Require(consolePid != 0, "Missing console host.");
                CaptureConsole(consolePid, job);
                Require(CapturedPids.SetEquals(JobPids(job)), "Job census changed during handle capture.");
            }
            Require(File.ReadAllText(Path.Combine(workspace, "checks")) == "read;write-denied;dacl-denied;dup-denied;breakaway-denied",
                "Missing protection evidence.");
            if (mode == "owner-death" || mode == "owner-loss") {
                string ownerPrefix = prefix + (mode == "owner-loss" ? "lease-" : "");
                File.WriteAllText(Path.Combine(root, ownerPrefix + "conhost.pid"), consolePid.ToString());
                File.WriteAllText(Path.Combine(root, ownerPrefix + "broker-ready"), "verified");
                if (mode == "owner-loss") {
                    Require(Console.OpenStandardInput().ReadByte() == -1, "Invalid owner lease command.");
                    return;
                }
                Thread.Sleep(30000);
                throw new InvalidOperationException("Broker death probe was not interrupted.");
            }
            if (mode == "finish") {
                File.WriteAllText(Path.Combine(workspace, "finish"), "F");
                Require(WaitForSingleObject(actor.Process, 5000) == 0, "Direct worker failed to finish.");
                uint code;
                Check(GetExitCodeProcess(actor.Process, out code), "query direct worker exit");
                Require(code == 0 && WaitForSingleObject(child, 0) == Timeout &&
                    WaitForSingleObject(grandchild, 0) == Timeout,
                    "Direct completion did not retain both detached descendants.");
                foreach (uint pid in JobPids(job)) Require(CapturedPids.Contains(pid), "Untracked actor after direct completion.");
                if (terminal) RequireTerminalOutput("LOOM_TERMINAL_FINISHED");
            } else {
                Check(TerminateJobObject(job, 1), "abort job");
                foreach (IntPtr handle in Handles) {
                    if (!terminal || GetProcessId(handle) != consolePid)
                        Require(WaitForSingleObject(handle, 5000) == 0, "Abort left an actor alive.");
                }
                Require(Active(job) == 0, "Aborted job is not empty.");
            }
        }, delegate {
            WithCleanup(delegate { Close(job); }, delegate {
                WithCleanup(delegate {
                    if (console != IntPtr.Zero) ClosePseudoConsole(console);
                    if (drain != null) Require(drain.Join(5000), "Pseudoconsole drain did not exit naturally.");
                    lock (OutputLock) { if (TerminalError != null) throw TerminalError; }
                }, delegate {
                  WithCleanup(ReapHandles, delegate {
                    Close(inputRead); Close(inputWrite); Close(outputRead); Close(outputWrite);
                    if (initialized) DeleteProcThreadAttributeList(attributes);
                    if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                    if (capsBuffer != IntPtr.Zero) Marshal.FreeHGlobal(capsBuffer);
                    if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                    FreeSid(sid);
                  });
                });
            });
        });
    }
    static void OwnerDeath(string root, string executable, string profile, SecurityIdentifier sid, bool terminal = false, bool lease = false) {
        string prefix = terminal ? "terminal-" : "";
        string ownerPrefix = prefix + (lease ? "lease-" : "");
        string workspace = Path.Combine(root, prefix + (lease ? "owner-loss" : "owner-death"));
        var start = StartInfo(executable,
            Quote(ownerPrefix + (lease ? "owner" : "broker")) + " " + Quote(root) + " " + Quote(profile), workspace);
        IntPtr survivingBroker = IntPtr.Zero;
        using (Process broker = Process.Start(start)) {
            WithCleanup(delegate {
                WaitFile(Path.Combine(root, ownerPrefix + (lease ? "owner-ready" : "broker-ready")));
                Require(File.ReadAllText(Path.Combine(root, ownerPrefix + "broker-ready")) == "verified", "Invalid broker readiness.");
                if (lease) {
                    uint pid;
                    Require(uint.TryParse(File.ReadAllText(Path.Combine(root, ownerPrefix + "broker.pid")), out pid) &&
                        ChildPidsOf((uint)broker.Id).Contains(pid), "Owner did not create the expected broker.");
                    survivingBroker = OpenProcess(SynchronizeQuery, false, pid);
                    Check(survivingBroker != IntPtr.Zero, "retain original surviving broker");
                    Require(WaitForSingleObject(survivingBroker, 0) == Timeout, "Broker exited before owner death.");
                }
                Capture(workspace, "worker", sid, IntPtr.Zero);
                Capture(workspace, "child", sid, IntPtr.Zero);
                Capture(workspace, "grandchild", sid, IntPtr.Zero);
                uint consolePid;
                Require(uint.TryParse(File.ReadAllText(Path.Combine(root, ownerPrefix + "conhost.pid")), out consolePid),
                    "Invalid console host identity.");
                CaptureConsole(consolePid, IntPtr.Zero);
                Check(TerminateProcess(broker.Handle, 1), lease ? "kill actual owner" : "kill actual broker");
                Require(broker.WaitForExit(5000), "Original broker survived termination.");
                if (lease) {
                    Require(WaitForSingleObject(survivingBroker, 5000) == 0, "Broker did not exit after actual owner death.");
                    uint code;
                    Check(GetExitCodeProcess(survivingBroker, out code), "query surviving broker cleanup");
                    Require(code == 0, "Surviving broker failed owner-death cleanup.");
                }
            }, delegate {
                if (!broker.HasExited) {
                    Check(TerminateProcess(broker.Handle, 1), "cleanup broker");
                    Require(broker.WaitForExit(5000), "Broker cleanup timed out.");
                }
                WithCleanup(ReapHandles, delegate { Close(survivingBroker); });
            });
        }
        static int LeaseOwner(string root, string profile, bool terminal) {
            string prefix = terminal ? "terminal-lease-" : "lease-";
            string workspace = Path.Combine(root, terminal ? "terminal-owner-loss" : "owner-loss");
            string executable = typeof(WindowsNativeScopeFixture).Assembly.Location;
            var start = StartInfo(executable, CommandArguments(prefix + "broker", root, profile), workspace);
            start.RedirectStandardInput = true;
            using (Process broker = Process.Start(start)) {
                WithCleanup(delegate {
                    WaitFile(Path.Combine(root, prefix + "broker-ready"));
                    File.WriteAllText(Path.Combine(root, prefix + "broker.pid"), broker.Id.ToString());
                    File.WriteAllText(Path.Combine(root, prefix + "owner-ready"), "verified");
                    Thread.Sleep(30000);
                    throw new InvalidOperationException("Actual owner death was not exercised.");
                }, delegate {
                    broker.StandardInput.Close();
                    Require(broker.WaitForExit(5000) && broker.ExitCode == 0, "Owner failed to clean up broker.");
                });
            }
            return 0;
        }
        static string CommandArguments(params string[] arguments) {
            var result = new List<string>();
            foreach (string value in arguments) result.Add(Quote(value));
            return string.Join(" ", result.ToArray());
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
            foreach (string mode in new string[] { "finish", "abort", "owner-death", "owner-loss",
                "terminal-finish", "terminal-abort", "terminal-owner-death", "terminal-owner-loss" }) {
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
            OwnerDeath(root, executable, profile, app, false, true);
            RunScope(root, executable, profile, "finish", true);
            RunScope(root, executable, profile, "abort", true);
            OwnerDeath(root, executable, profile, app, true);
            OwnerDeath(root, executable, profile, app, true, true);
            Require(File.ReadAllText(Path.Combine(root, "reviewed.txt")) == "reviewed fixture content", "Reviewed bytes changed.");
            Console.WriteLine("{\"platform\":\"windows\",\"candidate\":\"appcontainer-job\",\"protectedWritesDenied\":true,\"breakawayDenied\":true,\"brokerHandleDuplicationDenied\":true,\"originalProcessesTerminated\":true,\"originalConsoleHostsTerminated\":true,\"conptyInputOutputResizeVerified\":true,\"conptyBrokerDeathVerified\":true,\"conptyInheritedStdioVerified\":true,\"actualOwnerDeathVerified\":true,\"modes\":[\"finish\",\"abort\",\"broker-death\",\"owner-death\"]}");
        }, delegate {
            FreeSid(sid);
            Marshal.ThrowExceptionForHR(DeleteAppContainerProfile(profile));
        });
    }
    static void WriteConsoleMarker(string marker) {
        byte[] output = Encoding.ASCII.GetBytes(marker + "\r\n");
        uint written;
        Check(WriteFile(ActorConsoleOutput, output, (uint)output.Length, out written, IntPtr.Zero), "write pseudoconsole marker");
        Require(written == output.Length, "Incomplete pseudoconsole marker.");
    }
    static int StandardConsoleProbe() {
        uint mode;
        Check(GetConsoleMode(GetStdHandle(-10), out mode), "verify inherited standard input");
        Check(GetConsoleMode(GetStdHandle(-11), out mode), "verify inherited standard output");
        Check(GetConsoleMode(GetStdHandle(-12), out mode), "verify inherited standard error");
        Require(Console.Read() == 'S', "Inherited standard input did not receive expected byte.");
        Console.WriteLine("LOOM_STDIO_VERIFIED");
        Console.Out.Flush();
        Console.Error.WriteLine("LOOM_STDERR_VERIFIED");
        Console.Error.Flush();
        return 0;
    }
    static void ProbeInheritedStdio(string executable, string workspace, IntPtr input, IntPtr output) {
        Check(SetHandleInformation(input, 1, 1), "mark console input inheritable");
        Check(SetHandleInformation(output, 1, 1), "mark console output inheritable");
        try {
            var startup = new StartupEx();
            startup.Basic.Size = (uint)Marshal.SizeOf(typeof(Startup));
            startup.Basic.Flags = 0x100;
            startup.Basic.Input = input;
            startup.Basic.Output = output;
            startup.Basic.Error = output;
            ProcessInfo probe;
            Check(CreateProcessW(executable, new StringBuilder(Command(executable, "stdio-probe", workspace)),
                IntPtr.Zero, IntPtr.Zero, true, 0, IntPtr.Zero, workspace, ref startup, out probe),
                "launch inherited standard-console probe");
            try {
                Require(WaitForSingleObject(probe.Process, 5000) == 0, "Standard-console probe did not exit.");
                uint code;
                Check(GetExitCodeProcess(probe.Process, out code), "query standard-console probe exit");
                if (code != 0) {
                    string errorPath = Path.Combine(workspace, "stdio-probe.error");
                    if (File.Exists(errorPath)) throw new InvalidOperationException(File.ReadAllText(errorPath));
                    throw new InvalidOperationException("Standard-console probe failed: " + code);
                }
            } finally { Close(probe.Thread); Close(probe.Process); }
        } finally {
            Check(SetHandleInformation(input, 1, 0), "clear console input inheritance");
            Check(SetHandleInformation(output, 1, 0), "clear console output inheritance");
        }
    }
    static int Actor(string[] args) {
        string role = args[0], workspace = args[1];
        string executable = typeof(WindowsNativeScopeFixture).Assembly.Location;
        if (role == "worker") {
            if (args.Length == 5 && args[4] == "terminal") {
                IntPtr input = CreateFileW("CONIN$", 0xc0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                Check(input != new IntPtr(-1), "open attached pseudoconsole input");
                IntPtr output = CreateFileW("CONOUT$", 0xc0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                Check(output != new IntPtr(-1), "open attached pseudoconsole output");
                ActorConsoleOutput = output;
                uint mode;
                Check(GetConsoleMode(input, out mode), "verify pseudoconsole input");
                Check(SetConsoleMode(input, mode & ~7u), "set raw fixture console input");
                ConsoleInfo info;
                Check(GetConsoleScreenBufferInfo(output, out info), "query resized pseudoconsole");
                Require(info.Size.X == 100 && info.Size.Y == 40, "Pseudoconsole resize did not reach worker.");
                byte[] byteRead = new byte[1];
                uint count;
                Check(ReadFile(input, byteRead, 1, out count, IntPtr.Zero), "read pseudoconsole input");
                Require(count == 1 && byteRead[0] == (byte)'L', "Wrong pseudoconsole input.");
                ProbeInheritedStdio(executable, workspace, input, output);
                WriteConsoleMarker("LOOM_TERMINAL_READY");
            }
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
                if (role == "worker") {
                    WaitFile(Path.Combine(workspace, "finish"));
                    if (args.Length == 5 && args[4] == "terminal") {
                        WriteConsoleMarker("LOOM_TERMINAL_FINISHED");
                    }
                    return 0;
                }
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
            if (args.Length == 2 && args[0] == "stdio-probe") return StandardConsoleProbe();
            if (args.Length == 3 && (args[0] == "lease-owner" || args[0] == "terminal-lease-owner"))
                return LeaseOwner(args[1], args[2], args[0].StartsWith("terminal-"));
            if (args.Length == 3 && (args[0] == "broker" || args[0] == "terminal-broker" ||
                args[0] == "lease-broker" || args[0] == "terminal-lease-broker")) {
                RunScope(args[1], typeof(WindowsNativeScopeFixture).Assembly.Location, args[2],
                    args[0].Contains("lease-") ? "owner-loss" : "owner-death", args[0].StartsWith("terminal-"));
                return 0;
            }
            Require(args.Length >= 2 && (args[0] == "worker" || args[0] == "child" || args[0] == "grandchild"), "Invalid fixture role.");
            return Actor(args);
        } catch (Exception error) {
            if (args.Length >= 2 && (args[0] == "worker" || args[0] == "child" || args[0] == "grandchild" ||
                args[0] == "broker" || args[0] == "terminal-broker" || args[0] == "lease-broker" ||
                args[0] == "terminal-lease-broker" || args[0] == "stdio-probe" ||
                args[0] == "lease-owner" || args[0] == "terminal-lease-owner")) {
                File.WriteAllText(Path.Combine(args[1], args[0] + ".error"), error.ToString());
            }
            Console.Error.WriteLine(error);
            return 1;
        }
    }
}
