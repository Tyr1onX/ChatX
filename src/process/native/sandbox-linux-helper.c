#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#ifndef LANDLOCK_ACCESS_FS_IOCTL_DEV
#define LANDLOCK_ACCESS_FS_IOCTL_DEV (1ULL << 15)
#endif

static void die(const char *what) {
  int e = errno;
  dprintf(STDERR_FILENO, "chatx-landlock-helper: %s: %s\n", what, strerror(e));
  _exit(125);
}

static uint64_t handled_fs_for_abi(int abi) {
  uint64_t mask =
      LANDLOCK_ACCESS_FS_EXECUTE |
      LANDLOCK_ACCESS_FS_WRITE_FILE |
      LANDLOCK_ACCESS_FS_READ_FILE |
      LANDLOCK_ACCESS_FS_READ_DIR |
      LANDLOCK_ACCESS_FS_REMOVE_DIR |
      LANDLOCK_ACCESS_FS_REMOVE_FILE |
      LANDLOCK_ACCESS_FS_MAKE_CHAR |
      LANDLOCK_ACCESS_FS_MAKE_DIR |
      LANDLOCK_ACCESS_FS_MAKE_REG |
      LANDLOCK_ACCESS_FS_MAKE_SOCK |
      LANDLOCK_ACCESS_FS_MAKE_FIFO |
      LANDLOCK_ACCESS_FS_MAKE_BLOCK |
      LANDLOCK_ACCESS_FS_MAKE_SYM;
  if (abi >= 2) mask |= LANDLOCK_ACCESS_FS_REFER;
  if (abi >= 3) mask |= LANDLOCK_ACCESS_FS_TRUNCATE;
  if (abi >= 5) mask |= LANDLOCK_ACCESS_FS_IOCTL_DEV;
  return mask;
}

static uint64_t rw_access_for_abi(int abi) {
  uint64_t mask =
      LANDLOCK_ACCESS_FS_EXECUTE |
      LANDLOCK_ACCESS_FS_WRITE_FILE |
      LANDLOCK_ACCESS_FS_READ_FILE |
      LANDLOCK_ACCESS_FS_READ_DIR |
      LANDLOCK_ACCESS_FS_REMOVE_DIR |
      LANDLOCK_ACCESS_FS_REMOVE_FILE |
      LANDLOCK_ACCESS_FS_MAKE_DIR |
      LANDLOCK_ACCESS_FS_MAKE_REG |
      LANDLOCK_ACCESS_FS_MAKE_SOCK |
      LANDLOCK_ACCESS_FS_MAKE_FIFO |
      LANDLOCK_ACCESS_FS_MAKE_SYM;
  if (abi >= 2) mask |= LANDLOCK_ACCESS_FS_REFER;
  if (abi >= 3) mask |= LANDLOCK_ACCESS_FS_TRUNCATE;
  return mask;
}

static uint64_t ro_access(void) {
  return LANDLOCK_ACCESS_FS_EXECUTE |
         LANDLOCK_ACCESS_FS_READ_FILE |
         LANDLOCK_ACCESS_FS_READ_DIR;
}

static void add_path_rule(int ruleset_fd, const char *path, uint64_t access) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) die(path);
  struct stat st;
  if (fstat(fd, &st) != 0) {
    int e = errno;
    close(fd);
    errno = e;
    die("fstat rule path");
  }
  if (!S_ISDIR(st.st_mode)) {
    access &= LANDLOCK_ACCESS_FS_EXECUTE |
              LANDLOCK_ACCESS_FS_WRITE_FILE |
              LANDLOCK_ACCESS_FS_READ_FILE |
              LANDLOCK_ACCESS_FS_TRUNCATE |
              LANDLOCK_ACCESS_FS_IOCTL_DEV;
  }
  struct landlock_path_beneath_attr rule = {
      .allowed_access = access,
      .parent_fd = fd,
  };
  if (syscall(SYS_landlock_add_rule, ruleset_fd,
              LANDLOCK_RULE_PATH_BENEATH, &rule, 0) != 0) {
    int e = errno;
    close(fd);
    errno = e;
    die("landlock_add_rule");
  }
  close(fd);
}

static void close_unintended_fds(int ready_fd) {
#ifdef SYS_close_range
  if (ready_fd == 3) {
    if (syscall(SYS_close_range, 4U, ~0U, 0U) == 0) return;
    if (errno != ENOSYS && errno != EINVAL) die("close_range");
  }
#endif
  long max_fd = sysconf(_SC_OPEN_MAX);
  if (max_fd < 0 || max_fd > 1048576) max_fd = 65536;
  for (int fd = 4; fd < max_fd; ++fd) close(fd);
}

static void usage(void) {
  dprintf(STDERR_FILENO,
      "usage: helper --ready-fd N --workspace PATH --home PATH --temp PATH "
      "[--ro PATH ...] --cwd PATH -- COMMAND [ARG ...]\n");
  _exit(124);
}

int main(int argc, char **argv) {
  int ready_fd = -1;
  const char *workspace = NULL;
  const char *home = NULL;
  const char *temp = NULL;
  const char *cwd = NULL;
  const char *ro_paths[64];
  size_t ro_count = 0;
  int command_index = -1;

  for (int i = 1; i < argc; ++i) {
    if (strcmp(argv[i], "--") == 0) {
      command_index = i + 1;
      break;
    } else if (strcmp(argv[i], "--ready-fd") == 0 && i + 1 < argc) {
      ready_fd = atoi(argv[++i]);
    } else if (strcmp(argv[i], "--workspace") == 0 && i + 1 < argc) {
      workspace = argv[++i];
    } else if (strcmp(argv[i], "--home") == 0 && i + 1 < argc) {
      home = argv[++i];
    } else if (strcmp(argv[i], "--temp") == 0 && i + 1 < argc) {
      temp = argv[++i];
    } else if (strcmp(argv[i], "--cwd") == 0 && i + 1 < argc) {
      cwd = argv[++i];
    } else if (strcmp(argv[i], "--ro") == 0 && i + 1 < argc) {
      if (ro_count >= 64) usage();
      ro_paths[ro_count++] = argv[++i];
    } else {
      usage();
    }
  }

  if (ready_fd != 3 || !workspace || !home || !temp || !cwd ||
      command_index < 0 || command_index >= argc || argv[command_index][0] != '/') {
    usage();
  }

  close_unintended_fds(ready_fd);

  long abi = syscall(SYS_landlock_create_ruleset, NULL, 0,
                     LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 0) die("landlock ABI query");
  if (abi < 5) {
    dprintf(STDERR_FILENO,
            "chatx-landlock-helper: Landlock ABI %ld is below required ABI 5\n",
            abi);
    return 123;
  }

  struct landlock_ruleset_attr ruleset = {
      .handled_access_fs = handled_fs_for_abi((int)abi),
  };
  int ruleset_fd = syscall(SYS_landlock_create_ruleset, &ruleset,
                           sizeof(ruleset), 0);
  if (ruleset_fd < 0) die("landlock_create_ruleset");

  const uint64_t rw = rw_access_for_abi((int)abi);
  add_path_rule(ruleset_fd, workspace, rw);
  add_path_rule(ruleset_fd, home, rw);
  add_path_rule(ruleset_fd, temp, rw);
  for (size_t i = 0; i < ro_count; ++i)
    add_path_rule(ruleset_fd, ro_paths[i], ro_access());
  add_path_rule(ruleset_fd, argv[command_index],
                LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE);

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0)
    die("prctl(PR_SET_NO_NEW_PRIVS)");
  if (syscall(SYS_landlock_restrict_self, ruleset_fd, 0) != 0)
    die("landlock_restrict_self");
  close(ruleset_fd);

  if (chdir(cwd) != 0) die("chdir");

  char ready[64];
  int n = snprintf(ready, sizeof(ready), "READY ABI=%ld\n", abi);
  if (write(ready_fd, ready, (size_t)n) != n) die("ready handshake");
  close(ready_fd);

  execve(argv[command_index], &argv[command_index], environ);
  die("execve");
}
