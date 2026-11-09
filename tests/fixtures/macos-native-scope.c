#include <errno.h>
#include <libproc.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc.h>
#include <sys/select.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "native-fixture-identity.h"

static double now(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) {
    perror("Could not read the fixture clock");
    exit(1);
  }
  return value.tv_sec + value.tv_nsec / 1000000000.0;
}

static int inspect_scope(uid_t uid, int terminate) {
  const int capacity = 65536;
  pid_t *pids = calloc((size_t)capacity, sizeof(pid_t));
  if (pids == NULL) return -1;
  errno = 0;
  const int bytes = proc_listpids(PROC_UID_ONLY, uid, pids, capacity * (int)sizeof(pid_t));
  if (bytes < 0 || (bytes == 0 && errno != 0) || bytes >= capacity * (int)sizeof(pid_t)) {
    fputs("The fixture could not obtain a complete process list.\n", stderr);
    free(pids);
    return -1;
  }
  int remaining = 0;
  for (int index = 0; index < bytes / (int)sizeof(pid_t); index++) {
    const pid_t pid = pids[index];
    if (pid <= 0 || pid == getpid()) continue;
    struct proc_bsdinfo info;
    errno = 0;
    const int size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
    if (size == 0 && errno == ESRCH) continue;
    if (size != (int)sizeof(info)) {
      fputs("The fixture could not inspect a process identity.\n", stderr);
      free(pids);
      return -1;
    }
    if (info.pbi_uid != uid || info.pbi_status == SZOMB) continue;
    remaining++;
    // The cleanup worker has irreversibly dropped to this unique UID. The
    // kernel rechecks signal permission, even if a PID is reused after lookup.
    if (terminate && kill(pid, SIGKILL) != 0 && errno != ESRCH) {
      perror("Could not terminate a fixture process");
      free(pids);
      return -1;
    }
  }
  free(pids);
  return remaining;
}

static int clean_scope(uid_t uid) {
  const pid_t cleanup = fork();
  if (cleanup < 0) return 1;
  if (cleanup == 0) {
    drop_fixture_identity(uid);
    const double deadline = now() + 5.0;
    for (;;) {
      const int remaining = inspect_scope(uid, 1);
      if (remaining < 0) _exit(1);
      if (remaining == 0) _exit(0);
      if (now() >= deadline) _exit(1);
      usleep(10000);
    }
  }
  int status;
  if (waitpid(cleanup, &status, 0) != cleanup || !WIFEXITED(status) || WEXITSTATUS(status) != 0) return 1;
  while (waitpid(-1, &status, WNOHANG) > 0) {}
  const double deadline = now() + 5.0;
  for (;;) {
    const int remaining = inspect_scope(uid, 0);
    if (remaining == 0) return 0;
    if (remaining < 0 || now() >= deadline) return 1;
    usleep(10000);
  }
}

int main(int argc, char **argv) {
  if (argc < 3 || getuid() != 0 || geteuid() != 0) return 1;
  char *end = NULL;
  errno = 0;
  const unsigned long target = strtoul(argv[1], &end, 10);
  if (errno != 0 || *end != '\0' || end == argv[1] || target < 10000 || target > 60000) return 1;
  const uid_t uid = (uid_t)target;
  if (argc == 3 && strcmp(argv[2], "--verify-empty") == 0) {
    return inspect_scope(uid, 0) == 0 ? 0 : 1;
  }
  if (argc != 4) return 1;
  signal(SIGPIPE, SIG_IGN);
  int input[2];
  if (pipe(input) != 0) return 1;
  const pid_t worker = fork();
  if (worker < 0) return 1;
  if (worker == 0) {
    close(input[1]);
    if (dup2(input[0], STDIN_FILENO) < 0) _exit(1);
    const int limit = getdtablesize();
    for (int fd = 3; fd < limit; fd++) close(fd);
    drop_fixture_identity(uid);
    char *args[] = { "/usr/bin/sandbox-exec", "-f", argv[2], argv[3], NULL };
    execv(args[0], args);
    perror("Could not start the sandboxed fixture");
    _exit(1);
  }
  close(input[0]);
  int worker_status = 0;
  int failed = 0;
  for (;;) {
    const pid_t exited = waitpid(worker, &worker_status, WNOHANG);
    if (exited == worker) {
      if (!WIFEXITED(worker_status) || WEXITSTATUS(worker_status) != 0) failed = 1;
      break;
    }
    if (exited < 0) { failed = 1; break; }
    fd_set readers;
    FD_ZERO(&readers);
    FD_SET(STDIN_FILENO, &readers);
    struct timeval timeout = { 0, 100000 };
    const int ready = select(STDIN_FILENO + 1, &readers, NULL, NULL, &timeout);
    if (ready < 0 && errno == EINTR) continue;
    if (ready < 0) { failed = 1; break; }
    if (ready == 0) continue;
    char command;
    const ssize_t count = read(STDIN_FILENO, &command, 1);
    if (count < 0 && errno == EINTR) continue;
    if (count == 0 || (count == 1 && command == 'A')) break;
    if (count == 1 && command == 'F') {
      if (write(input[1], "F", 1) != 1) { failed = 1; break; }
    } else {
      failed = 1;
      break;
    }
  }
  close(input[1]);
  if (clean_scope(uid) != 0) {
    fputs("Fixture scope cleanup is unverified.\n", stderr);
    return 1;
  }
  if (printf("SCOPE_EMPTY\n") < 0 || fflush(stdout) != 0) {
    if (errno != EPIPE) return 1;
  }
  return failed;
}
