$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
$data = ConvertFrom-Json -InputObject ([Console]::In.ReadToEnd())
if ($data.operation -eq 'public-parent') {
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner($sid)
    $security.SetAccessRuleProtection($true, $false)
    foreach ($entry in @(
        @($sid, [System.Security.AccessControl.FileSystemRights]::FullControl),
        @([System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'), [System.Security.AccessControl.FileSystemRights]::ReadAndExecute)
    )) {
        $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $entry[0], $entry[1],
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
    }
    $null = [System.IO.Directory]::CreateDirectory($data.path, $security)
    [Console]::Out.WriteLine('{"ok":true}')
    exit 0
}
if ($data.operation -eq 'widen-file') {
    $file = [System.IO.FileInfo]::new($data.path)
    $security = $file.GetAccessControl()
    $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'),
        [System.Security.AccessControl.FileSystemRights]::Read,
        [System.Security.AccessControl.AccessControlType]::Allow))
    $file.SetAccessControl($security)
    [Console]::Out.WriteLine('{"ok":true}')
    exit 0
}
if ($data.operation -ne 'cross-user') { throw 'Unknown fixture operation.' }

# Only the explicitly enabled hosted-native test creates this disposable account.
Add-Type -AssemblyName System.DirectoryServices.AccountManagement
$context = [System.DirectoryServices.AccountManagement.PrincipalContext]::new(
    [System.DirectoryServices.AccountManagement.ContextType]::Machine)
$account = [System.DirectoryServices.AccountManagement.UserPrincipal]::new($context)
$created = $false
try {
    $name = 'loomtest_' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
    $password = 'L00m!' + [Guid]::NewGuid().ToString('N') + 'aA9'
    $account.SamAccountName = $name
    $account.SetPassword($password)
    $account.Enabled = $true
    $account.Save()
    $created = $true
    $group = [System.DirectoryServices.AccountManagement.GroupPrincipal]::FindByIdentity($context, 'S-1-5-32-545')
    try { $group.Members.Add($account); $group.Save() } finally { $group.Dispose() }
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $data.node
    $start.Arguments = '"' + $data.probe + '"'
    $start.WorkingDirectory = [System.IO.Path]::GetDirectoryName($data.probe)
    $start.UserName = $name
    $start.Domain = '.'
    $start.Password = ConvertTo-SecureString -String $password -AsPlainText -Force
    $start.UseShellExecute = $false
    $start.LoadUserProfile = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($start)
    try {
        if (-not $process.WaitForExit(20000)) { $process.Kill(); throw 'Foreign-user probe timed out.' }
        $output = $process.StandardOutput.ReadToEnd()
        if ($process.ExitCode -ne 0) { throw 'Foreign-user probe failed.' }
        [Console]::Out.WriteLine($output.Trim())
    } finally { $process.Dispose() }
} finally {
    if ($created) { $account.Delete() }
    $account.Dispose()
    $context.Dispose()
}
