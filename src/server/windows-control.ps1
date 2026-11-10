$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false, $true)

function Fail([string]$code) {
    [Console]::Out.WriteLine(('{"ok":false,"code":"' + $code + '"}'))
    exit 1
}

function Is-Trusted([string]$sid, [string]$user) {
    return $sid -eq $user -or $sid -eq 'S-1-5-18' -or $sid -eq 'S-1-5-32-544' -or
        $sid -eq 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
}

function Read-DirectoryAcl([System.IO.DirectoryInfo]$directory) {
    if ($PSVersionTable.PSEdition -eq 'Core') {
        return [System.IO.FileSystemAclExtensions]::GetAccessControl($directory)
    }
    return $directory.GetAccessControl()
}

function Check-Acl($security, [string]$user, [bool]$private) {
    $owner = $security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if (-not (Is-Trusted $owner $user)) { Fail 'WINDOWS_PROFILE_UNSAFE' }
    if ($private -and -not $security.AreAccessRulesProtected) { Fail 'WINDOWS_PROFILE_UNSAFE' }
    $rules = $security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    $userAccess = $false
    foreach ($rule in $rules) {
        if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
        $sid = $rule.IdentityReference.Value
        if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
            # Untrusted ancestors must not permit replacement or ACL takeover.
            $dangerous = [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
                [System.Security.AccessControl.FileSystemRights]::Delete -bor
                [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
                [System.Security.AccessControl.FileSystemRights]::TakeOwnership -bor 0x10000000
            if (-not (Is-Trusted $sid $user) -and ($private -or ($rule.FileSystemRights -band $dangerous) -ne 0)) {
                Fail 'WINDOWS_PROFILE_UNSAFE'
            }
            if ($sid -eq $user -and ($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq
                [System.Security.AccessControl.FileSystemRights]::FullControl) { $userAccess = $true }
        }
    }
    if ($private -and -not $userAccess) { Fail 'WINDOWS_PROFILE_UNSAFE' }
}

function Check-Parents([string]$path, [string]$user) {
    $current = [System.IO.DirectoryInfo]::new($path)
    while ($null -ne $current) {
        if ($current.Exists) {
            if (($current.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Fail 'WINDOWS_PROFILE_UNSAFE' }
            Check-Acl (Read-DirectoryAcl $current) $user $false
        }
        $current = $current.Parent
    }
}

function Local-Path([string]$path) {
    if ($path -notmatch '^[A-Za-z]:[\\/][^:]*$' -or $path.Length -gt 1024) { Fail 'WINDOWS_PROFILE_INVALID' }
    $path = [System.IO.Path]::GetFullPath($path)
    $drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($path))
    if ($drive.DriveType -ne [System.IO.DriveType]::Fixed -or $drive.DriveFormat -notin @('NTFS', 'ReFS')) {
        Fail 'WINDOWS_PROFILE_INVALID'
    }
    return $path
}

function New-Certificate([string]$name, [string]$usage) {
    $rsa = [System.Security.Cryptography.RSACng]::new(2048)
    try {
        $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
            ('CN=' + $name), $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256,
            [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
        $usages = [System.Security.Cryptography.OidCollection]::new()
        $null = $usages.Add([System.Security.Cryptography.Oid]::new($usage))
        $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usages, $true))
        $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $san.AddDnsName('localhost')
        $request.CertificateExtensions.Add($san.Build())
        $now = [System.DateTimeOffset]::UtcNow
        $certificate = $request.CreateSelfSigned($now.AddMinutes(-5), $now.AddDays(365))
        try {
            return @{
                certificate = [Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
                pfx = [Convert]::ToBase64String($certificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, ''))
            }
        } finally { $certificate.Dispose() }
    } finally { $rsa.Dispose() }
}

try {
    if (($PSVersionTable.PSEdition -eq 'Core' -and
         ($PSVersionTable.PSVersion.Major -ne 7 -or $PSVersionTable.PSVersion.PreReleaseLabel)) -or
        ($PSVersionTable.PSEdition -ne 'Core' -and $PSVersionTable.PSVersion -lt [Version]'5.1')) {
        Fail 'WINDOWS_PROFILE_CHECK_FAILED'
    }
    $text = [Console]::In.ReadToEnd()
    if ($text.Length -gt 8192) { Fail 'WINDOWS_PROFILE_INVALID' }
    $inputData = ConvertFrom-Json -InputObject $text
    if ($inputData.version -ne 1) { Fail 'WINDOWS_PROFILE_INVALID' }
    if ($inputData.operation -eq 'certificates') {
        $server = New-Certificate 'Skill Loom local service' '1.3.6.1.5.5.7.3.1'
        $client = New-Certificate 'Skill Loom local client' '1.3.6.1.5.5.7.3.2'
        [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 4 -InputObject @{ ok = $true; server = $server; client = $client }))
        exit 0
    }
    $path = Local-Path ([string]$inputData.path)
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    try { $user = $identity.User.Value } finally { $identity.Dispose() }
    Check-Parents $path $user
    if ($inputData.operation -eq 'prepare' -and -not [System.IO.Directory]::Exists($path)) {
        $security = [System.Security.AccessControl.DirectorySecurity]::new()
        $sid = [System.Security.Principal.SecurityIdentifier]::new($user)
        $security.SetOwner($sid)
        $security.SetAccessRuleProtection($true, $false)
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid, [System.Security.AccessControl.FileSystemRights]::FullControl,
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        $security.AddAccessRule($rule)
        if ($PSVersionTable.PSEdition -eq 'Core') {
            $null = [System.IO.FileSystemAclExtensions]::CreateDirectory($security, $path)
        } else {
            $null = [System.IO.Directory]::CreateDirectory($path, $security)
        }
    }
    Check-Parents $path $user
    $directory = [System.IO.DirectoryInfo]::new($path)
    if (-not $directory.Exists -or ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Fail 'WINDOWS_PROFILE_UNSAFE' }
    Check-Acl (Read-DirectoryAcl $directory) $user $true
    if ($inputData.operation -ne 'prepare') {
        $canonical = Local-Path ([string]$inputData.canonicalPath)
        Check-Parents $canonical $user
        $canonicalDirectory = [System.IO.DirectoryInfo]::new($canonical)
        if (-not $canonicalDirectory.Exists) { Fail 'WINDOWS_PROFILE_UNSAFE' }
        Check-Acl (Read-DirectoryAcl $canonicalDirectory) $user $true
    }
    if ($inputData.operation -eq 'prepare' -or $inputData.operation -eq 'check') {
        [Console]::Out.WriteLine('{"ok":true}')
        exit 0
    }
    if ($inputData.operation -ne 'metadata' -and $inputData.operation -ne 'lock') { Fail 'WINDOWS_PROFILE_INVALID' }
    $name = if ($inputData.operation -eq 'metadata') { 'control.json' } else { 'profile-owner.sqlite' }
    $filePath = [System.IO.Path]::Combine($path, $name)
    if (-not [System.IO.File]::Exists($filePath)) {
        [Console]::Out.WriteLine('{"ok":true,"content":null}')
        exit 0
    }
    $file = [System.IO.FileInfo]::new($filePath)
    if (($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Fail 'WINDOWS_PROFILE_UNSAFE' }
    $share = if ($inputData.operation -eq 'lock') { [System.IO.FileShare]::ReadWrite } else { [System.IO.FileShare]::Read }
    $stream = [System.IO.File]::Open($filePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $share)
    try {
        # Files may inherit the already-protected directory's private DACL.
        $security = if ($PSVersionTable.PSEdition -eq 'Core') {
            [System.IO.FileSystemAclExtensions]::GetAccessControl($stream)
        } else { $stream.GetAccessControl() }
        Check-Acl $security $user $false
        foreach ($rule in $security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                -not (Is-Trusted $rule.IdentityReference.Value $user)) { Fail 'WINDOWS_PROFILE_UNSAFE' }
        }
        if ($inputData.operation -eq 'metadata') {
            if ($stream.Length -gt 32768) { Fail 'WINDOWS_PROFILE_UNSAFE' }
            $reader = [System.IO.StreamReader]::new($stream, [System.Text.UTF8Encoding]::new($false, $true), $false)
            try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
            [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ ok = $true; content = $content }))
        } else { [Console]::Out.WriteLine('{"ok":true}') }
    } finally { $stream.Dispose() }
} catch {
    # Never print exception messages, paths, metadata, keys, or PowerShell diagnostics.
    Fail 'WINDOWS_PROFILE_CHECK_FAILED'
}
