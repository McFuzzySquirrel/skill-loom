#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/capability.h>
#include <sched.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/select.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

static void fail(const char *message) {
  perror(message);
  exit(1);
}

static void drop_capabilities(void) {
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) fail("no-new-privileges");
  if (prctl(PR_CAP_AMBIENT, PR_CAP_AMBIENT_CLEAR_ALL, 0, 0, 0) != 0) fail("clear ambient capabilities");
  for (int cap = 0; cap <= CAP_LAST_CAP; cap++) {
    if (prctl(PR_CAPBSET_DROP, cap, 0, 0, 0) != 0) fail("drop bounding capability");
  }
  struct __user_cap_header_struct header = { _LINUX_CAPABILITY_VERSION_3, 0 };
  struct __user_cap_data_struct data[2] = { {0}, {0} };
  if (syscall(SYS_capset, &header, data) != 0) fail("drop capabilities");
}

static void hold(void) {
  alarm(30);
  for (;;) pause();
}

static void require_readonly(const char *path) {
  const int readable = open(path, O_RDONLY);
  if (readable < 0) fail("read reviewed content");
  char byte;
  if (read(readable, &byte, 1) != 1) fail("read reviewed byte");
  if (close(readable) != 0) fail("close reviewed read");
  errno = 0;
  const int writable = open(path, O_WRONLY | O_TRUNC);
  if (writable >= 0) {
    close(writable);
    fputs("Reviewed content was unexpectedly writable.\n", stderr);
    exit(1);
  }
  if (errno != EROFS) fail("reviewed write was not blocked by a read-only mount");
}

static void require_unprivileged_mapping(const char *path) {
  FILE *mapping = fopen(path, "r");
  if (mapping == NULL) fail("open namespace identity mapping");
  unsigned long inner, outer, length;
  char extra;
  const int count = fscanf(mapping, "%lu %lu %lu %c", &inner, &outer, &length, &extra);
  if (fclose(mapping) != 0) fail("close namespace identity mapping");
  if (count != 3 || inner != 0 || outer == 0 || length != 1) {
    fputs("The fixture must map only an unprivileged host identity to namespace root.\n", stderr);
    exit(1);
  }
}

static void worker(const char *path) {
  const int limit = getdtablesize();
  for (int fd = 3; fd < limit; fd++) close(fd);
  drop_capabilities();
  require_readonly(path);
  errno = 0;
  if (mount(NULL, path, NULL, MS_BIND | MS_REMOUNT, NULL) == 0 || errno != EPERM) {
    fail("read-only remount was not protected");
  }
  const pid_t nested = fork();
  if (nested < 0) fail("fork nested probe");
  if (nested == 0) {
    if (unshare(CLONE_NEWUSER | CLONE_NEWNS) != 0) {
      if (errno == EPERM) _exit(0);
      fprintf(stderr, "Nested namespace creation failed with errno %d.\n", errno);
      _exit(1);
    }
    require_readonly(path);
    errno = 0;
    const int changed = mount(NULL, path, NULL, MS_BIND | MS_REMOUNT, NULL);
    if (changed == 0 || (errno != EPERM && errno != EACCES)) {
      fprintf(stderr, "Nested read-only remount returned %d with errno %d.\n", changed, errno);
      _exit(1);
    }
    require_readonly(path);
    _exit(0);
  }
  int status;
  if (waitpid(nested, &status, 0) != nested || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    fail("nested namespace bypass was not blocked");
  }
  int ready[2];
  if (pipe(ready) != 0) fail("descendant ready pipe");
  const pid_t child = fork();
  if (child < 0) fail("fork descendant");
  if (child == 0) {
    close(ready[0]);
    if (setsid() < 0) _exit(1);
    const pid_t grandchild = fork();
    if (grandchild < 0) _exit(1);
    if (grandchild == 0) {
      if (setsid() < 0 || write(ready[1], "R", 1) != 1) _exit(1);
      close(ready[1]);
      hold();
    }
    close(ready[1]);
    hold();
  }
  close(ready[1]);
  char byte;
  if (read(ready[0], &byte, 1) != 1) fail("descendant readiness");
  close(ready[0]);
  puts("ACTORS_READY");
  fflush(stdout);
  if (read(STDIN_FILENO, &byte, 1) != 1 || byte != 'F') _exit(1);
  _exit(0);
}

int main(int argc, char **argv) {
  if (argc != 2 || getpid() != 1) {
    fputs("The fixture requires its own PID namespace.\n", stderr);
    return 1;
  }
  alarm(30);
  require_unprivileged_mapping("/proc/self/uid_map");
  require_unprivileged_mapping("/proc/self/gid_map");
  // unshare --mount-proc has already installed a private procfs. NSpid in the
  // outer parent's procfs is measured by the unprivileged test driver instead.
  if (prctl(PR_SET_DUMPABLE, 0) != 0) fail("protect namespace init");
  if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0) fail("private mount propagation");
  if (mount(argv[1], argv[1], NULL, MS_BIND, NULL) != 0) fail("bind reviewed content");
  if (mount(NULL, argv[1], NULL, MS_BIND | MS_REMOUNT | MS_RDONLY | MS_NOSUID | MS_NODEV, NULL) != 0) {
    fail("protect reviewed mount");
  }
  int input[2];
  if (pipe(input) != 0) fail("worker input pipe");
  const pid_t child = fork();
  if (child < 0) fail("fork worker");
  if (child == 0) {
    close(input[1]);
    if (dup2(input[0], STDIN_FILENO) < 0) fail("worker stdin");
    worker(argv[1]);
  }
  close(input[0]);
  for (;;) {
    int status;
    const pid_t ended = waitpid(child, &status, WNOHANG);
    if (ended == child) return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
    if (ended < 0) fail("wait for worker");
    fd_set readers;
    FD_ZERO(&readers);
    FD_SET(STDIN_FILENO, &readers);
    struct timeval timeout = { 0, 100000 };
    const int count = select(STDIN_FILENO + 1, &readers, NULL, NULL, &timeout);
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) fail("read owner lease");
    if (count == 0) continue;
    char command;
    const ssize_t size = read(STDIN_FILENO, &command, 1);
    if (size == 0 || (size == 1 && command == 'A')) return 0;
    if (size == 1 && command == 'F') {
      if (write(input[1], "F", 1) != 1) fail("complete worker");
    } else {
      fputs("Invalid fixture command.\n", stderr);
      return 1;
    }
  }
}
