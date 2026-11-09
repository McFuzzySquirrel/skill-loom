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
#else
#include <grp.h>

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
  if (setgroups(0, NULL) != 0 || setgid(65534) != 0 || setuid((uid_t)target) != 0 ||
      getuid() != target || geteuid() != target) {
    perror("Could not drop fixture identity");
    return 1;
  }
  execv(argv[2], &argv[2]);
  perror("Could not execute the fixture after dropping identity");
  return 1;
}
#endif
