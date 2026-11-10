#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static void probe_group_change(const char *operation, int new_session) {
  const pid_t original_group = getpgrp();
  const pid_t child = fork();
  if (child < 0) {
    printf("{\"operation\":\"%s\",\"forkDenied\":true,\"escaped\":false,\"error\":%d}\n",
           operation, errno);
    fflush(stdout);
    return;
  }
  if (child == 0) {
    errno = 0;
    const int result = new_session ? (int)setsid() : setpgid(0, 0);
    const int error = result < 0 ? errno : 0;
    printf("{\"operation\":\"%s\",\"forkDenied\":false,\"escaped\":%s,\"error\":%d}\n",
           operation, getpgrp() != original_group ? "true" : "false", error);
    fflush(stdout);
    _exit(0);
  }
  int status;
  if (waitpid(child, &status, 0) != child || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    fputs("The boundary fixture could not reap its own child.\n", stderr);
    exit(1);
  }
}

int main(void) {
  probe_group_change("setsid", 1);
  probe_group_change("setpgid", 0);
  return 0;
}
