const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_ABSOLUTE_PATH = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

/** Recognize absolute paths from POSIX and Windows hosts in browser code. */
export function isAbsolutePath(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    WINDOWS_DRIVE_ABSOLUTE_PATH.test(value) ||
    WINDOWS_UNC_ABSOLUTE_PATH.test(value)
  );
}
