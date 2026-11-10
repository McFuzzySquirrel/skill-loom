#include <signal.h>
#include <stdio.h>
#include <sys/types.h>
#include <unistd.h>

static void hold(void) {
  alarm(30);
  for (;;) pause();
}

int main(void) {
  alarm(30);
  int ready[2];
  if (pipe(ready) != 0) return 1;
  const pid_t child = fork();
  if (child < 0) return 1;
  if (child == 0) {
    close(ready[0]);
    if (setsid() < 0) _exit(1);
    const pid_t grandchild = fork();
    if (grandchild < 0) _exit(1);
    if (grandchild == 0) {
      if (setsid() < 0) _exit(1);
      const pid_t self = getpid();
      if (write(ready[1], &self, sizeof(self)) != (ssize_t)sizeof(self)) _exit(1);
      close(ready[1]);
      hold();
    }
    close(ready[1]);
    hold();
  }
  close(ready[1]);
  pid_t grandchild;
  if (read(ready[0], &grandchild, sizeof(grandchild)) != (ssize_t)sizeof(grandchild)) return 1;
  close(ready[0]);
  printf("{\"ready\":[%d,%d,%d]}\n", getpid(), child, grandchild);
  fflush(stdout);
  char command;
  return read(STDIN_FILENO, &command, 1) == 1 && command == 'F' ? 0 : 1;
}
