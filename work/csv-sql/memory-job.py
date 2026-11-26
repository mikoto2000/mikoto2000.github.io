"""Limit the test's entire Windows process tree, not just V8 or DuckDB.

Uses a suspended child so the job is assigned before it can spawn Chrome.
No system settings, pagefile settings or existing browser processes are changed.
"""
import ctypes as C
from ctypes import wintypes as W
from pathlib import Path
import json
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
k = C.WinDLL('kernel32', use_last_error=True)
SIZE = C.c_size_t

class BASIC(C.Structure):
    _fields_ = [('PerProcessUserTimeLimit', C.c_int64), ('PerJobUserTimeLimit', C.c_int64),
                ('LimitFlags', W.DWORD), ('MinimumWorkingSetSize', SIZE), ('MaximumWorkingSetSize', SIZE),
                ('ActiveProcessLimit', W.DWORD), ('Affinity', SIZE), ('PriorityClass', W.DWORD), ('SchedulingClass', W.DWORD)]

class IO(C.Structure):
    _fields_ = [(name, C.c_uint64) for name in ['ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount']]

class EXTENDED(C.Structure):
    _fields_ = [('BasicLimitInformation', BASIC), ('IoInfo', IO), ('ProcessMemoryLimit', SIZE), ('JobMemoryLimit', SIZE), ('PeakProcessMemoryUsed', SIZE), ('PeakJobMemoryUsed', SIZE)]

class STARTUP(C.Structure):
    _fields_ = [('cb', W.DWORD), ('lpReserved', W.LPWSTR), ('lpDesktop', W.LPWSTR), ('lpTitle', W.LPWSTR),
                ('dwX', W.DWORD), ('dwY', W.DWORD), ('dwXSize', W.DWORD), ('dwYSize', W.DWORD),
                ('dwXCountChars', W.DWORD), ('dwYCountChars', W.DWORD), ('dwFillAttribute', W.DWORD),
                ('dwFlags', W.DWORD), ('wShowWindow', W.WORD), ('cbReserved2', W.WORD), ('lpReserved2', C.POINTER(W.BYTE)),
                ('hStdInput', W.HANDLE), ('hStdOutput', W.HANDLE), ('hStdError', W.HANDLE)]

class PROCESS(C.Structure):
    _fields_ = [('hProcess', W.HANDLE), ('hThread', W.HANDLE), ('dwProcessId', W.DWORD), ('dwThreadId', W.DWORD)]

def api(name, result, args):
    fn = getattr(k, name)
    fn.restype, fn.argtypes = result, args
    return fn

create_job = api('CreateJobObjectW', W.HANDLE, [C.c_void_p, W.LPCWSTR])
set_job = api('SetInformationJobObject', W.BOOL, [W.HANDLE, C.c_int, C.c_void_p, W.DWORD])
query_job = api('QueryInformationJobObject', W.BOOL, [W.HANDLE, C.c_int, C.c_void_p, W.DWORD, C.c_void_p])
create_process = api('CreateProcessW', W.BOOL, [W.LPCWSTR, W.LPWSTR, C.c_void_p, C.c_void_p, W.BOOL, W.DWORD, C.c_void_p, W.LPCWSTR, C.POINTER(STARTUP), C.POINTER(PROCESS)])
assign = api('AssignProcessToJobObject', W.BOOL, [W.HANDLE, W.HANDLE])
resume = api('ResumeThread', W.DWORD, [W.HANDLE])
wait = api('WaitForSingleObject', W.DWORD, [W.HANDLE, W.DWORD])
close = api('CloseHandle', W.BOOL, [W.HANDLE])
open_process = api('OpenProcess', W.HANDLE, [W.DWORD, W.BOOL, W.DWORD])
in_job = api('IsProcessInJob', W.BOOL, [W.HANDLE, W.HANDLE, C.POINTER(W.BOOL)])
get_exit = api('GetExitCodeProcess', W.BOOL, [W.HANDLE, C.POINTER(W.DWORD)])
terminate = api('TerminateProcess', W.BOOL, [W.HANDLE, W.UINT])

def check(value):
    if not value:
        raise C.WinError(C.get_last_error())
    return value

def write(name, data):
    (HERE / name).write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')

def main():
    limit = 4 * 1024**3
    job = check(create_job(None, None))
    process = PROCESS()
    report = {'date': '2026-11-27', 'method': 'Windows Job Object aggregate committed memory limit', 'limitBytes': limit, 'memberships': []}
    try:
        config = EXTENDED()
        config.BasicLimitInformation.LimitFlags = 0x200 | 0x2000  # JOB_MEMORY | KILL_ON_JOB_CLOSE; no breakaway
        config.JobMemoryLimit = limit
        check(set_job(job, 9, C.byref(config), C.sizeof(config)))
        actual = EXTENDED()
        check(query_job(job, 9, C.byref(actual), C.sizeof(actual), None))
        assert actual.JobMemoryLimit == limit and actual.BasicLimitInformation.LimitFlags & 0x200
        report['configuredLimitBytes'] = actual.JobMemoryLimit
        for name in ['memory-processes.json', 'memory-membership.json', 'memory-test.log']:
            (HERE / name).unlink(missing_ok=True)
        startup = STARTUP()
        startup.cb = C.sizeof(startup)
        args = ['C:/Program Files/nodejs/node.exe', str(HERE / 'verify-memory.cjs'), *sys.argv[1:]]
        command = C.create_unicode_buffer(subprocess.list2cmdline(args))
        check(create_process(None, command, None, None, False, 0x4 | 0x08000000, None, str(HERE.parent.parent), C.byref(startup), C.byref(process)))
        if not assign(job, process.hProcess):
            terminate(process.hProcess, 1)
            raise C.WinError(C.get_last_error())
        assert resume(process.hThread) != 0xffffffff
        print('Started suspended child in verified 4 GiB job:', process.dwProcessId, flush=True)
        deadline = time.monotonic() + 300
        seen, log_offset = set(), 0
        while True:
            done = wait(process.hProcess, 250) == 0
            if time.monotonic() > deadline:
                raise TimeoutError('Memory test exceeded 5 minutes')
            try:
                pid_info = json.loads((HERE / 'memory-processes.json').read_text(encoding='utf-8'))
                label = pid_info['browser']
                if label not in seen:
                    membership = []
                    for item in pid_info['processes']:
                        handle = check(open_process(0x1000, False, int(item['id'])))
                        try:
                            belongs = W.BOOL()
                            check(in_job(handle, job, C.byref(belongs)))
                            membership.append({'pid': item['id'], 'type': item['type'], 'inJob': bool(belongs.value)})
                        finally:
                            close(handle)
                    ack = {'browser': label, 'allInJob': all(p['inJob'] for p in membership), 'processes': membership}
                    report['memberships'].append(ack)
                    write('memory-membership.json', ack)
                    seen.add(label)
            except (FileNotFoundError, json.JSONDecodeError):
                pass
            log = HERE / 'memory-test.log'
            if log.exists():
                text = log.read_text(encoding='utf-8')
                if len(text) > log_offset:
                    print(text[log_offset:].strip(), flush=True)
                    log_offset = len(text)
            if done:
                break
        check(query_job(job, 9, C.byref(actual), C.sizeof(actual), None))
        code = W.DWORD()
        check(get_exit(process.hProcess, C.byref(code)))
        report.update(exitCode=code.value, peakJobCommitBytes=actual.PeakJobMemoryUsed, peakProcessCommitBytes=actual.PeakProcessMemoryUsed)
        write('memory-job-results.json', report)
        print(json.dumps(report), flush=True)
        return code.value
    finally:
        # Closing this unnamed job kills only its own test process tree.
        close(job)
        if process.hThread:
            close(process.hThread)
        if process.hProcess:
            close(process.hProcess)

if __name__ == '__main__':
    sys.exit(main())
