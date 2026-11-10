#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

#ifdef REPORT_IDENTITY
int main(void) {
  printf("{\"realUid\":%u,\"effectiveUid\":%u}\n",
         (unsigned)getuid(), (unsigned)geteuid());
  return 0;
}
#elif defined(TRY_WRITE)
#include <fcntl.h>

int main(int argc, char **argv) {
  if (argc != 2) return 1;
  errno = 0;
  const int file = open(argv[1], O_WRONLY | O_TRUNC);
  const int error = file < 0 ? errno : 0;
  if (file >= 0) close(file);
  printf("{\"writeDenied\":%s,\"error\":%d}\n", error == EACCES ? "true" : "false", error);
  return error == EACCES ? 0 : 1;
}
#elif defined(EXEC_CHILD)
#include <sys/wait.h>

int main(int argc, char **argv) {
  if (argc != 2) return 1;
  const pid_t child = fork();
  if (child < 0) return 1;
  if (child == 0) {
    if (setsid() < 0) _exit(1);
    execv(argv[1], &argv[1]);
    const int error = errno;
    printf("{\"forkAllowed\":true,\"setsidAllowed\":true,\"execDenied\":%s,\"error\":%d}\n",
           error == EPERM ? "true" : "false", error);
    fflush(stdout);
    _exit(error == EPERM ? 0 : 1);
  }
  int status;
  if (waitpid(child, &status, 0) != child || !WIFEXITED(status)) return 1;
  return WEXITSTATUS(status);
}
#else
#include "native-fixture-identity.h"

int main(int argc, char **argv) {
  if (argc < 3 || getuid() != 0 || geteuid() != 0) {
    fputs("The fixture launcher requires root and an explicit unprivileged UID.\n", stderr);
    return 1;
  }
  char *end = NULL;
  errno = 0;
  const unsigned long target = strtoul(argv[1], &end, 10);
  if (errno != 0 || end == argv[1] || *end != '\0' || target < 10000 || target > 60000) {
    fputs("Invalid fixture UID.\n", stderr);
    return 1;
  }
  drop_fixture_identity((uid_t)target);
  execv(argv[2], &argv[2]);
  perror("Could not execute the fixture after dropping identity");
  return 1;
}
#endif
