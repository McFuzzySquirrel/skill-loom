#ifndef LOOM_NATIVE_FIXTURE_IDENTITY_H
#define LOOM_NATIVE_FIXTURE_IDENTITY_H

#include <grp.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

static void drop_fixture_identity(uid_t target) {
  if (getuid() != 0 || geteuid() != 0 || target < 10000 || target > 60000) {
    fputs("The fixture requires root and an explicit unprivileged UID.\n", stderr);
    exit(1);
  }
  if (setgroups(0, NULL) != 0 || setgid(65534) != 0 || setuid(target) != 0 ||
      getuid() != target || geteuid() != target) {
    perror("Could not drop fixture identity");
    exit(1);
  }
}

#endif
