/*
 * Penglai Windows native host.
 *
 * Holds a Job Object for the owned DSH tree (CREATE_SUSPENDED, assign,
 * resume, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, no breakaway) and exposes
 * current-user ACL / owner / reparse probes plus capability-bound delete.
 *
 * Compile on Windows x64 only:
 *   cl /nologo /O2 /W3 penglai_windows_host.c advapi32.lib bcrypt.lib
 *   x86_64-w64-mingw32-gcc -O2 -o penglai-windows-host.exe penglai_windows_host.c -ladvapi32 -lbcrypt
 *
 * This file is the production source of Windows process/ACL facts.
 * Returning applied=true without executing these APIs is forbidden.
 */
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <tlhelp32.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
#define JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 0x00002000
#endif
#ifndef JOB_OBJECT_LIMIT_BREAKAWAY_OK
#define JOB_OBJECT_LIMIT_BREAKAWAY_OK 0x00000800
#endif
#ifndef JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
#define JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK 0x00001000
#endif

static void json_escape(FILE *out, const char *s) {
  fputc('"', out);
  if (!s) {
    fputc('"', out);
    return;
  }
  for (; *s; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') {
      fputc('\\', out);
      fputc(c, out);
    } else if (c < 0x20) {
      fprintf(out, "\\u%04x", c);
    } else {
      fputc(c, out);
    }
  }
  fputc('"', out);
}

static void fail(const char *error) {
  fputs("{\"ok\":false,\"error\":", stdout);
  json_escape(stdout, error);
  fputs("}\n", stdout);
  fflush(stdout);
  exit(2);
}

static void win_fail(const char *prefix) {
  char buf[256];
  snprintf(buf, sizeof(buf), "%s:%lu", prefix, (unsigned long)GetLastError());
  fail(buf);
}

static wchar_t *utf8_to_wide(const char *utf8) {
  if (!utf8) return NULL;
  int n = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
  if (n <= 0) return NULL;
  wchar_t *out = (wchar_t *)calloc((size_t)n, sizeof(wchar_t));
  if (!out) return NULL;
  if (!MultiByteToWideChar(CP_UTF8, 0, utf8, -1, out, n)) {
    free(out);
    return NULL;
  }
  return out;
}

static char *wide_to_utf8(const wchar_t *wide) {
  if (!wide) return NULL;
  int n = WideCharToMultiByte(CP_UTF8, 0, wide, -1, NULL, 0, NULL, NULL);
  if (n <= 0) return NULL;
  char *out = (char *)calloc((size_t)n, 1);
  if (!out) return NULL;
  if (!WideCharToMultiByte(CP_UTF8, 0, wide, -1, out, n, NULL, NULL)) {
    free(out);
    return NULL;
  }
  return out;
}

static char *current_sid_string(void) {
  HANDLE token = NULL;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return NULL;
  DWORD needed = 0;
  GetTokenInformation(token, TokenUser, NULL, 0, &needed);
  TOKEN_USER *user = (TOKEN_USER *)calloc(1, needed ? needed : 1);
  char *sid = NULL;
  if (user && GetTokenInformation(token, TokenUser, user, needed, &needed)) {
    LPSTR raw = NULL;
    if (ConvertSidToStringSidA(user->User.Sid, &raw) && raw) {
      size_t n = strlen(raw) + 5;
      sid = (char *)malloc(n);
      if (sid) snprintf(sid, n, "sid:%s", raw);
      LocalFree(raw);
    }
  }
  free(user);
  CloseHandle(token);
  return sid;
}

static int has_reparse(const wchar_t *path) {
  DWORD attrs = GetFileAttributesW(path);
  if (attrs == INVALID_FILE_ATTRIBUTES) {
    if (GetLastError() == ERROR_FILE_NOT_FOUND || GetLastError() == ERROR_PATH_NOT_FOUND) return 0;
    return -1;
  }
  return (attrs & FILE_ATTRIBUTE_REPARSE_POINT) ? 1 : 0;
}

static char *owner_sid_for_path(const wchar_t *path) {
  PSID owner = NULL;
  PSECURITY_DESCRIPTOR sd = NULL;
  DWORD rc = GetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION, &owner, NULL, NULL, NULL, &sd);
  if (rc != ERROR_SUCCESS) return NULL;
  LPSTR raw = NULL;
  char *out = NULL;
  if (ConvertSidToStringSidA(owner, &raw) && raw) {
    size_t n = strlen(raw) + 5;
    out = (char *)malloc(n);
    if (out) snprintf(out, n, "sid:%s", raw);
    LocalFree(raw);
  }
  if (sd) LocalFree(sd);
  return out;
}

static int path_under(const wchar_t *root, const wchar_t *candidate) {
  wchar_t a[MAX_PATH * 4];
  wchar_t b[MAX_PATH * 4];
  DWORD na = GetFullPathNameW(root, MAX_PATH * 4, a, NULL);
  DWORD nb = GetFullPathNameW(candidate, MAX_PATH * 4, b, NULL);
  if (!na || !nb || na >= MAX_PATH * 4 || nb >= MAX_PATH * 4) return 0;
  for (wchar_t *p = a; *p; p++) if (*p == L'/') *p = L'\\';
  for (wchar_t *p = b; *p; p++) if (*p == L'/') *p = L'\\';
  size_t la = wcslen(a);
  if (_wcsnicmp(a, b, la) != 0) return 0;
  return b[la] == 0 || b[la] == L'\\';
}

static DWORD apply_current_user_acl(const wchar_t *path) {
  HANDLE token = NULL;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return GetLastError();
  DWORD needed = 0;
  GetTokenInformation(token, TokenUser, NULL, 0, &needed);
  TOKEN_USER *user = (TOKEN_USER *)calloc(1, needed ? needed : 1);
  DWORD owner_needed = 0;
  GetTokenInformation(token, TokenOwner, NULL, 0, &owner_needed);
  TOKEN_OWNER *token_owner = (TOKEN_OWNER *)calloc(1, owner_needed ? owner_needed : 1);
  DWORD result = ERROR_SUCCESS;
  EXPLICIT_ACCESS_W ea[3];
  PSID system = NULL;
  PSID admins = NULL;
  PSID existing_owner = NULL;
  PSECURITY_DESCRIPTOR owner_sd = NULL;
  PACL dacl = NULL;
  SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
  if (!user || !token_owner) {
    result = ERROR_NOT_ENOUGH_MEMORY;
    goto done;
  }
  if (!GetTokenInformation(token, TokenUser, user, needed, &needed)) {
    result = GetLastError();
    goto done;
  }
  if (!GetTokenInformation(token, TokenOwner, token_owner, owner_needed, &owner_needed)) {
    result = GetLastError();
    goto done;
  }
  result = GetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION,
                                 &existing_owner, NULL, NULL, NULL, &owner_sd);
  if (result != ERROR_SUCCESS) goto done;
  /* An elevated or hosted-runner token may legitimately create a directory
     owned by its TokenOwner (commonly BUILTIN\\Administrators) rather than
     TokenUser. Accept only those two token-bound identities; arbitrary owners
     still fail closed before the DACL is replaced. */
  if (!existing_owner ||
      (!EqualSid(existing_owner, user->User.Sid) &&
       !EqualSid(existing_owner, token_owner->Owner))) {
    result = ERROR_INVALID_OWNER;
    goto done;
  }
  if (!AllocateAndInitializeSid(&nt, 1, SECURITY_LOCAL_SYSTEM_RID, 0, 0, 0, 0, 0, 0, 0, &system)) {
    result = GetLastError();
    goto done;
  }
  if (!AllocateAndInitializeSid(&nt, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0, &admins)) {
    result = GetLastError();
    goto done;
  }
  ZeroMemory(ea, sizeof(ea));
  ea[0].grfAccessPermissions = GENERIC_ALL;
  ea[0].grfAccessMode = SET_ACCESS;
  ea[0].grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
  ea[0].Trustee.TrusteeForm = TRUSTEE_IS_SID;
  ea[0].Trustee.TrusteeType = TRUSTEE_IS_USER;
  ea[0].Trustee.ptstrName = (LPWSTR)user->User.Sid;
  ea[1].grfAccessPermissions = GENERIC_ALL;
  ea[1].grfAccessMode = SET_ACCESS;
  ea[1].grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
  ea[1].Trustee.TrusteeForm = TRUSTEE_IS_SID;
  ea[1].Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  ea[1].Trustee.ptstrName = (LPWSTR)system;
  ea[2].grfAccessPermissions = GENERIC_ALL;
  ea[2].grfAccessMode = SET_ACCESS;
  ea[2].grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
  ea[2].Trustee.TrusteeForm = TRUSTEE_IS_SID;
  ea[2].Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  ea[2].Trustee.ptstrName = (LPWSTR)admins;
  /* A protected DACL containing only these three allow ACEs denies every
     omitted principal. Explicit DENY_ACCESS ACEs for Users or Everyone would
     also deny the current user because that user belongs to both groups. */
  result = SetEntriesInAclW(3, ea, NULL, &dacl);
  if (result != ERROR_SUCCESS) goto done;
  result = SetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT,
                                 DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                                 NULL, NULL, dacl, NULL);
  if (result != ERROR_SUCCESS) {
    goto done;
  }
done:
  if (dacl) LocalFree(dacl);
  if (system) FreeSid(system);
  if (admins) FreeSid(admins);
  if (owner_sd) LocalFree(owner_sd);
  free(user);
  free(token_owner);
  if (token) CloseHandle(token);
  return result;
}

static ULONGLONG filetime_ms(const FILETIME *ft) {
  ULARGE_INTEGER u;
  u.LowPart = ft->dwLowDateTime;
  u.HighPart = ft->dwHighDateTime;
  return (u.QuadPart - 116444736000000000ULL) / 10000ULL;
}

static int process_start_ms(DWORD pid, ULONGLONG *out) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return 0;
  FILETIME create, exit_t, kernel, user;
  int ok = GetProcessTimes(h, &create, &exit_t, &kernel, &user);
  if (ok) *out = filetime_ms(&create);
  CloseHandle(h);
  return ok;
}

static char *process_image(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return NULL;
  wchar_t buf[MAX_PATH * 4];
  DWORD n = MAX_PATH * 4;
  char *out = NULL;
  if (QueryFullProcessImageNameW(h, 0, buf, &n)) out = wide_to_utf8(buf);
  CloseHandle(h);
  return out;
}

static int configure_job(HANDLE job) {
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION info;
  ZeroMemory(&info, sizeof(info));
  info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  /* BREAKAWAY_OK and SILENT_BREAKAWAY_OK stay unset on purpose. */
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info, sizeof(info))) return 0;
  return 1;
}

static DWORD WINAPI wait_for_owner_stop(LPVOID parameter) {
  HANDLE input = (HANDLE)parameter;
  char unused[8];
  DWORD got = 0;
  if (input && input != INVALID_HANDLE_VALUE) {
    /* A byte or EOF both mean the owning desktop process released the helper. */
    ReadFile(input, unused, sizeof(unused), &got, NULL);
  }
  return 0;
}

static int job_supervise(const char *exe_utf8, char *cmdline_utf8) {
  wchar_t *exe = utf8_to_wide(exe_utf8);
  wchar_t *cmd = utf8_to_wide(cmdline_utf8);
  if (!exe || !cmd) fail("utf16");
  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (!job) win_fail("CreateJobObjectW");
  if (!configure_job(job)) win_fail("SetInformationJobObject");
  STARTUPINFOEXW si;
  PROCESS_INFORMATION pi;
  ZeroMemory(&si, sizeof(si));
  ZeroMemory(&pi, sizeof(pi));
  si.StartupInfo.cb = sizeof(si);

  /* DSH alpha prints its one-time browser-auth URL to stdout. Forward only
   * the helper's stdout/stderr pipes to the owned process; never broadly
   * inherit every handle held by the desktop process. The child gets a private
   * NUL stdin because the helper exclusively owns its stdin as the desktop
   * lifetime signal. */
  HANDLE parent_stdout = GetStdHandle(STD_OUTPUT_HANDLE);
  HANDLE parent_stderr = GetStdHandle(STD_ERROR_HANDLE);
  if (!parent_stdout || parent_stdout == INVALID_HANDLE_VALUE ||
      !parent_stderr || parent_stderr == INVALID_HANDLE_VALUE) {
    fail("job-supervise-stdio");
  }
  HANDLE child_stdout = NULL;
  HANDLE child_stderr = NULL;
  if (!DuplicateHandle(GetCurrentProcess(), parent_stdout, GetCurrentProcess(),
                       &child_stdout, 0, TRUE, DUPLICATE_SAME_ACCESS) ||
      !DuplicateHandle(GetCurrentProcess(), parent_stderr, GetCurrentProcess(),
                       &child_stderr, 0, TRUE, DUPLICATE_SAME_ACCESS)) {
    win_fail("DuplicateHandle");
  }
  SECURITY_ATTRIBUTES sa;
  ZeroMemory(&sa, sizeof(sa));
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = TRUE;
  HANDLE child_stdin = CreateFileW(L"NUL", GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, NULL);
  if (!child_stdin || child_stdin == INVALID_HANDLE_VALUE) {
    win_fail("CreateFileW-NUL");
  }
  HANDLE inherited[3] = { child_stdin, child_stdout, child_stderr };
  SIZE_T attribute_bytes = 0;
  InitializeProcThreadAttributeList(NULL, 1, 0, &attribute_bytes);
  si.lpAttributeList = (LPPROC_THREAD_ATTRIBUTE_LIST)HeapAlloc(
      GetProcessHeap(), 0, attribute_bytes);
  if (!si.lpAttributeList ||
      !InitializeProcThreadAttributeList(si.lpAttributeList, 1, 0, &attribute_bytes) ||
      !UpdateProcThreadAttribute(si.lpAttributeList, 0,
          PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherited, sizeof(inherited), NULL, NULL)) {
    win_fail("ProcThreadAttributeList");
  }
  si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  si.StartupInfo.hStdInput = child_stdin;
  si.StartupInfo.hStdOutput = child_stdout;
  si.StartupInfo.hStdError = child_stderr;

  DWORD flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT |
      CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT;
  BOOL created = CreateProcessW(exe, cmd, NULL, NULL, TRUE, flags, NULL, NULL,
                                &si.StartupInfo, &pi);
  DWORD create_error = created ? ERROR_SUCCESS : GetLastError();
  DeleteProcThreadAttributeList(si.lpAttributeList);
  HeapFree(GetProcessHeap(), 0, si.lpAttributeList);
  CloseHandle(child_stdin);
  CloseHandle(child_stdout);
  CloseHandle(child_stderr);
  if (!created) {
    SetLastError(create_error);
    win_fail("CreateProcessW");
  }
  if (!AssignProcessToJobObject(job, pi.hProcess)) {
    TerminateProcess(pi.hProcess, 1);
    win_fail("AssignProcessToJobObject");
  }
  ULONGLONG startMs = 0;
  process_start_ms(pi.dwProcessId, &startMs);
  char *owner = current_sid_string();
  printf(
      "{\"ok\":true,\"command\":\"job-supervise\",\"pid\":%lu,\"startMs\":%llu,\"owner\":",
      (unsigned long)pi.dwProcessId,
      (unsigned long long)startMs);
  json_escape(stdout, owner ? owner : "");
  fputs(",\"jobAssigned\":true,\"killOnJobClose\":true,\"breakawayOk\":false,"
        "\"childExitMonitored\":true,\"ownerStopMonitored\":true,"
        "\"stdioForwarded\":true}\n", stdout);
  fflush(stdout);
  free(owner);
  /* The handshake must be the first stdout line. Only then can the child emit
   * the alpha launch URL into the same restricted pipe. */
  if (ResumeThread(pi.hThread) == (DWORD)-1) {
    TerminateProcess(pi.hProcess, 1);
    win_fail("ResumeThread");
  }

  /* The helper is the process Electron observes. Wait for either the owned DSH
   * root to exit or the desktop owner to close/write stdin. The old one-sided
   * stdin wait left this helper alive after a DSH crash, hiding the crash from
   * the restart policy. Closing the Job Object reaps every remaining child. */
  HANDLE std_in = GetStdHandle(STD_INPUT_HANDLE);
  HANDLE owner_stop = NULL;
  if (std_in && std_in != INVALID_HANDLE_VALUE) {
    owner_stop = CreateThread(NULL, 0, wait_for_owner_stop, std_in, 0, NULL);
    if (!owner_stop) win_fail("CreateThread");
  }
  HANDLE waits[2];
  DWORD wait_count = 1;
  waits[0] = pi.hProcess;
  if (owner_stop) waits[wait_count++] = owner_stop;
  DWORD wake = WaitForMultipleObjects(wait_count, waits, FALSE, INFINITE);
  if (wake == WAIT_FAILED || wake >= WAIT_OBJECT_0 + wait_count) {
    win_fail("WaitForMultipleObjects");
  }
  int child_exited = wake == WAIT_OBJECT_0;
  DWORD child_exit_code = 0;
  if (child_exited && !GetExitCodeProcess(pi.hProcess, &child_exit_code)) {
    child_exit_code = 1;
  }

  CloseHandle(job);
  if (!child_exited) WaitForSingleObject(pi.hProcess, 5000);
  if (owner_stop) CloseHandle(owner_stop);
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  free(exe);
  free(cmd);
  return child_exited ? (int)(child_exit_code & 0xff) : 0;
}

static int cmd_acl_apply(const char *path_utf8) {
  wchar_t *path = utf8_to_wide(path_utf8);
  if (!path) fail("utf16");
  if (has_reparse(path) == 1) fail("reparse");
  DWORD acl_result = apply_current_user_acl(path);
  if (acl_result != ERROR_SUCCESS) {
    SetLastError(acl_result);
    win_fail("SetNamedSecurityInfoW");
  }
  char *owner = owner_sid_for_path(path);
  fputs("{\"ok\":true,\"command\":\"acl-apply\",\"applied\":true,\"owner\":", stdout);
  json_escape(stdout, owner ? owner : "");
  fputs("}\n", stdout);
  free(owner);
  free(path);
  return 0;
}

static int cmd_owner(const char *path_utf8) {
  wchar_t *path = utf8_to_wide(path_utf8);
  if (!path) fail("utf16");
  char *owner = owner_sid_for_path(path);
  if (!owner) win_fail("GetNamedSecurityInfoW");
  fputs("{\"ok\":true,\"command\":\"owner-probe\",\"owner\":", stdout);
  json_escape(stdout, owner);
  fputs("}\n", stdout);
  free(owner);
  free(path);
  return 0;
}

static int cmd_reparse(const char *path_utf8) {
  wchar_t *path = utf8_to_wide(path_utf8);
  if (!path) fail("utf16");
  int r = has_reparse(path);
  if (r < 0) win_fail("GetFileAttributesW");
  printf("{\"ok\":true,\"command\":\"reparse-probe\",\"reparse\":%s}\n", r ? "true" : "false");
  free(path);
  return 0;
}

static int cmd_path_batch_probe(const char *root_utf8) {
  /* Read the path manifest from the already-open standard input stream. The
   * helper must never turn an arbitrary command-line path into a file read. */
  FILE *file = stdin;
  wchar_t *root = utf8_to_wide(root_utf8);
  if (!root) {
    fclose(file);
    fail("utf16");
  }
  char line[131072];
  char *expected_owner = NULL;
  unsigned long long count = 0;
  while (fgets(line, sizeof(line), file)) {
    size_t n = strlen(line);
    int complete = n > 0 && (line[n - 1] == '\n' || feof(file));
    if (!complete) {
      free(expected_owner);
      free(root);
      fclose(file);
      fail("probe-path-too-long");
    }
    while (n > 0 && (line[n - 1] == '\n' || line[n - 1] == '\r')) line[--n] = 0;
    if (!n) continue;
    wchar_t *path = utf8_to_wide(line);
    if (!path) {
      free(expected_owner);
      free(root);
      fclose(file);
      fail("utf16");
    }
    if (!path_under(root, path)) {
      free(path);
      free(expected_owner);
      free(root);
      fclose(file);
      fail("probe-path-escape");
    }
    if (count == 0 && !path_under(path, root)) {
      free(path);
      free(expected_owner);
      free(root);
      fclose(file);
      fail("probe-root-mismatch");
    }
    int reparse = has_reparse(path);
    if (reparse < 0) {
      free(path);
      free(expected_owner);
      free(root);
      fclose(file);
      win_fail("GetFileAttributesW");
    }
    if (reparse) {
      free(path);
      free(expected_owner);
      free(root);
      fclose(file);
      fail("reparse");
    }
    char *owner = owner_sid_for_path(path);
    free(path);
    if (!owner) {
      free(expected_owner);
      free(root);
      fclose(file);
      win_fail("GetNamedSecurityInfoW");
    }
    if (!expected_owner) {
      expected_owner = owner;
    } else {
      if (strcmp(owner, expected_owner) != 0) {
        free(owner);
        free(expected_owner);
        free(root);
        fclose(file);
        fail("owner-mismatch");
      }
      free(owner);
    }
    count++;
  }
  if (ferror(file)) {
    free(expected_owner);
    free(root);
    fclose(file);
    fail("probe-file-read");
  }
  fclose(file);
  free(root);
  if (!count || !expected_owner) {
    free(expected_owner);
    fail("probe-empty");
  }
  fputs("{\"ok\":true,\"command\":\"path-batch-probe\",\"owner\":", stdout);
  json_escape(stdout, expected_owner);
  printf(",\"count\":%llu}\n", count);
  free(expected_owner);
  return 0;
}

static int cmd_identity(DWORD pid) {
  ULONGLONG startMs = 0;
  if (!process_start_ms(pid, &startMs)) win_fail("GetProcessTimes");
  char *image = process_image(pid);
  char *owner = current_sid_string();
  printf("{\"ok\":true,\"command\":\"process-identity\",\"pid\":%lu,\"startMs\":%llu,\"executable\":", (unsigned long)pid, (unsigned long long)startMs);
  json_escape(stdout, image ? image : "");
  fputs(",\"owner\":", stdout);
  json_escape(stdout, owner ? owner : "");
  fputs("}\n", stdout);
  free(image);
  free(owner);
  return 0;
}

static int cmd_reap_supervisors(const char *exe_utf8, DWORD keep_pid) {
  wchar_t *expected = utf8_to_wide(exe_utf8);
  if (!expected) fail("utf16");
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) win_fail("CreateToolhelp32Snapshot");
  PROCESSENTRY32W entry;
  ZeroMemory(&entry, sizeof(entry));
  entry.dwSize = sizeof(entry);
  DWORD killed[256];
  size_t count = 0;
  if (Process32FirstW(snapshot, &entry)) {
    do {
      DWORD pid = entry.th32ProcessID;
      if (!pid || pid == GetCurrentProcessId() || pid == keep_pid) continue;
      HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE, FALSE, pid);
      if (!process) continue;
      wchar_t image[MAX_PATH * 4];
      DWORD image_len = MAX_PATH * 4;
      if (QueryFullProcessImageNameW(process, 0, image, &image_len) && _wcsicmp(image, expected) == 0) {
        if (TerminateProcess(process, 1) && count < 256) killed[count++] = pid;
      }
      CloseHandle(process);
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);
  fputs("{\"ok\":true,\"command\":\"process-reap-supervisors\",\"pids\":[", stdout);
  for (size_t i = 0; i < count; i++) {
    if (i) fputc(',', stdout);
    fprintf(stdout, "%lu", (unsigned long)killed[i]);
  }
  fprintf(stdout, "],\"deleted\":%lu}\n", (unsigned long)count);
  free(expected);
  return 0;
}

static int cmd_process_suspend_resume(DWORD pid, int suspend) {
  if (!pid) fail("pid");
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
  if (snapshot == INVALID_HANDLE_VALUE) win_fail("CreateToolhelp32Snapshot");
  THREADENTRY32 entry;
  ZeroMemory(&entry, sizeof(entry));
  entry.dwSize = sizeof(entry);
  DWORD *thread_ids = NULL;
  size_t count = 0;
  if (Thread32First(snapshot, &entry)) {
    do {
      if (entry.th32OwnerProcessID != pid) continue;
      DWORD *next = (DWORD *)realloc(thread_ids, (count + 1) * sizeof(DWORD));
      if (!next) {
        free(thread_ids);
        CloseHandle(snapshot);
        fail("memory");
      }
      thread_ids = next;
      thread_ids[count++] = entry.th32ThreadID;
    } while (Thread32Next(snapshot, &entry));
  }
  CloseHandle(snapshot);
  if (!count) {
    free(thread_ids);
    fail("process-threads-not-found");
  }

  size_t changed = 0;
  for (size_t i = 0; i < count; i++) {
    HANDLE thread = OpenThread(THREAD_SUSPEND_RESUME, FALSE, thread_ids[i]);
    if (!thread) {
      if (suspend) {
        for (size_t j = 0; j < changed; j++) {
          HANDLE rollback = OpenThread(THREAD_SUSPEND_RESUME, FALSE, thread_ids[j]);
          if (rollback) {
            ResumeThread(rollback);
            CloseHandle(rollback);
          }
        }
      }
      free(thread_ids);
      win_fail("OpenThread");
    }
    DWORD previous = suspend ? SuspendThread(thread) : ResumeThread(thread);
    CloseHandle(thread);
    if (previous == (DWORD)-1) {
      if (suspend) {
        for (size_t j = 0; j < changed; j++) {
          HANDLE rollback = OpenThread(THREAD_SUSPEND_RESUME, FALSE, thread_ids[j]);
          if (rollback) {
            ResumeThread(rollback);
            CloseHandle(rollback);
          }
        }
      }
      free(thread_ids);
      win_fail(suspend ? "SuspendThread" : "ResumeThread");
    }
    changed++;
  }
  printf(
      "{\"ok\":true,\"command\":\"process-%s\",\"pid\":%lu,\"changed\":%llu}\n",
      suspend ? "suspend" : "resume",
      (unsigned long)pid,
      (unsigned long long)changed);
  free(thread_ids);
  return 0;
}

static const char *opt(int argc, char **argv, const char *name) {
  size_t n = strlen(name);
  for (int i = 1; i < argc; i++) {
    if (strncmp(argv[i], name, n) == 0 && argv[i][n] == '=' ) return argv[i] + n + 1;
    if (strcmp(argv[i], name) == 0 && i + 1 < argc) return argv[i + 1];
  }
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 2) fail("usage");
  const char *cmd = argv[1];
  if (strcmp(cmd, "job-supervise") == 0) {
    const char *exe = opt(argc, argv, "--exe");
    const char *cmdline = opt(argc, argv, "--cmdline");
    if (!exe || !cmdline) fail("job-supervise-args");
    return job_supervise(exe, (char *)cmdline);
  }
  if (strcmp(cmd, "acl-apply") == 0) {
    const char *path = opt(argc, argv, "--path");
    if (!path) fail("path");
    return cmd_acl_apply(path);
  }
  if (strcmp(cmd, "owner-probe") == 0) {
    const char *path = opt(argc, argv, "--path");
    if (!path) fail("path");
    return cmd_owner(path);
  }
  if (strcmp(cmd, "reparse-probe") == 0) {
    const char *path = opt(argc, argv, "--path");
    if (!path) fail("path");
    return cmd_reparse(path);
  }
  if (strcmp(cmd, "path-batch-probe") == 0) {
    const char *root = opt(argc, argv, "--root");
    if (!root) fail("path-batch-probe-args");
    return cmd_path_batch_probe(root);
  }
  if (strcmp(cmd, "process-identity") == 0) {
    const char *pid = opt(argc, argv, "--pid");
    if (!pid) fail("pid");
    return cmd_identity((DWORD)strtoul(pid, NULL, 10));
  }
  if (strcmp(cmd, "process-reap-supervisors") == 0) {
    const char *exe = opt(argc, argv, "--exe");
    const char *keep = opt(argc, argv, "--keep-pid");
    if (!exe) fail("exe");
    return cmd_reap_supervisors(exe, keep ? (DWORD)strtoul(keep, NULL, 10) : 0);
  }
  if (strcmp(cmd, "process-suspend") == 0 || strcmp(cmd, "process-resume") == 0) {
    const char *pid = opt(argc, argv, "--pid");
    if (!pid) fail("pid");
    return cmd_process_suspend_resume((DWORD)strtoul(pid, NULL, 10), strcmp(cmd, "process-suspend") == 0);
  }
  fail("unknown-command");
}
