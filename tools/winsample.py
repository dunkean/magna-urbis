"""Tiny non-admin sampling profiler for a running Windows x64 process.

Suspends each thread of the target in turn, walks its stack with DbgHelp StackWalk64 and
symbolises the frames from the PDBs at the end. Prints self and inclusive time per function.

    python tools/winsample.py <pid> <seconds> [out.txt] [--hz 200] [--depth 48]
"""
import ctypes as C
import ctypes.wintypes as W
import collections
import sys
import time

k32 = C.WinDLL('kernel32', use_last_error=True)
dbg = C.WinDLL('dbghelp', use_last_error=True)

PROCESS_ALL = 0x1F0FFF
THREAD_ALL = 0x1F03FF
TH32CS_SNAPTHREAD = 0x4
CONTEXT_AMD64 = 0x00100000
CONTEXT_FULL = CONTEXT_AMD64 | 0x1 | 0x2 | 0x8
IMAGE_FILE_MACHINE_AMD64 = 0x8664


class THREADENTRY32(C.Structure):
    _fields_ = [('dwSize', W.DWORD), ('cntUsage', W.DWORD), ('th32ThreadID', W.DWORD),
                ('th32OwnerProcessID', W.DWORD), ('tpBasePri', W.LONG), ('tpDeltaPri', W.LONG), ('dwFlags', W.DWORD)]


class M128(C.Structure):
    _fields_ = [('lo', C.c_uint64), ('hi', C.c_int64)]


class CONTEXT(C.Structure):
    _pack_ = 16
    _fields_ = [(n, C.c_uint64) for n in ('P1Home', 'P2Home', 'P3Home', 'P4Home', 'P5Home', 'P6Home')] + [
        ('ContextFlags', W.DWORD), ('MxCsr', W.DWORD),
        ('SegCs', W.WORD), ('SegDs', W.WORD), ('SegEs', W.WORD), ('SegFs', W.WORD), ('SegGs', W.WORD), ('SegSs', W.WORD),
        ('EFlags', W.DWORD)] + [(n, C.c_uint64) for n in (
            'Dr0', 'Dr1', 'Dr2', 'Dr3', 'Dr6', 'Dr7', 'Rax', 'Rcx', 'Rdx', 'Rbx', 'Rsp', 'Rbp', 'Rsi', 'Rdi',
            'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15', 'Rip')] + [
        ('FltSave', C.c_byte * 512), ('VectorRegister', M128 * 26), ('VectorControl', C.c_uint64),
        ('DebugControl', C.c_uint64), ('LastBranchToRip', C.c_uint64), ('LastBranchFromRip', C.c_uint64),
        ('LastExceptionToRip', C.c_uint64), ('LastExceptionFromRip', C.c_uint64)]


class ADDRESS64(C.Structure):
    _fields_ = [('Offset', C.c_uint64), ('Segment', W.WORD), ('Mode', C.c_int)]


class KDHELP64(C.Structure):
    _fields_ = [('Thread', C.c_uint64), ('ThCallbackStack', W.DWORD), ('ThCallbackBStore', W.DWORD),
                ('NextCallback', W.DWORD), ('FramePointer', W.DWORD), ('KiCallUserMode', C.c_uint64),
                ('KeUserCallbackDispatcher', C.c_uint64), ('SystemRangeStart', C.c_uint64),
                ('KiUserExceptionDispatcher', C.c_uint64), ('StackBase', C.c_uint64), ('StackLimit', C.c_uint64),
                ('BuildVersion', W.DWORD), ('RetpolineStubFunctionTableSize', W.DWORD),
                ('RetpolineStubFunctionTable', C.c_uint64), ('RetpolineStubOffset', W.DWORD),
                ('RetpolineStubSize', W.DWORD), ('Reserved0', C.c_uint64 * 2)]


class STACKFRAME64(C.Structure):
    _fields_ = [('AddrPC', ADDRESS64), ('AddrReturn', ADDRESS64), ('AddrFrame', ADDRESS64), ('AddrStack', ADDRESS64),
                ('AddrBStore', ADDRESS64), ('FuncTableEntry', C.c_void_p), ('Params', C.c_uint64 * 4),
                ('Far', W.BOOL), ('Virtual', W.BOOL), ('Reserved', C.c_uint64 * 3), ('KdHelp', KDHELP64)]


class SYMBOL_INFO(C.Structure):
    _fields_ = [('SizeOfStruct', W.ULONG), ('TypeIndex', W.ULONG), ('Reserved', C.c_uint64 * 2), ('Index', W.ULONG),
                ('Size', W.ULONG), ('ModBase', C.c_uint64), ('Flags', W.ULONG), ('Value', C.c_uint64),
                ('Address', C.c_uint64), ('Register', W.ULONG), ('Scope', W.ULONG), ('Tag', W.ULONG),
                ('NameLen', W.ULONG), ('MaxNameLen', W.ULONG), ('Name', C.c_char * 1024)]


dbg.SymFunctionTableAccess64.restype = C.c_void_p
dbg.SymFunctionTableAccess64.argtypes = [W.HANDLE, C.c_uint64]
dbg.SymGetModuleBase64.restype = C.c_uint64
dbg.SymGetModuleBase64.argtypes = [W.HANDLE, C.c_uint64]
FTA = C.WINFUNCTYPE(C.c_void_p, W.HANDLE, C.c_uint64)(lambda h, a: dbg.SymFunctionTableAccess64(h, a))
GMB = C.WINFUNCTYPE(C.c_uint64, W.HANDLE, C.c_uint64)(lambda h, a: dbg.SymGetModuleBase64(h, a))
dbg.StackWalk64.argtypes = [W.DWORD, W.HANDLE, W.HANDLE, C.POINTER(STACKFRAME64), C.c_void_p, C.c_void_p,
                            C.c_void_p, C.c_void_p, C.c_void_p]
dbg.SymFromAddr.argtypes = [W.HANDLE, C.c_uint64, C.POINTER(C.c_uint64), C.POINTER(SYMBOL_INFO)]
k32.OpenThread.restype = W.HANDLE
k32.OpenProcess.restype = W.HANDLE
k32.CreateToolhelp32Snapshot.restype = W.HANDLE


def threads(pid):
    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)
    e = THREADENTRY32(); e.dwSize = C.sizeof(e); out = []
    ok = k32.Thread32First(snap, C.byref(e))
    while ok:
        if e.th32OwnerProcessID == pid: out.append(e.th32ThreadID)
        ok = k32.Thread32Next(snap, C.byref(e))
    k32.CloseHandle(snap)
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    opts = dict(zip(sys.argv[1:], sys.argv[2:]))
    pid, seconds = int(args[0]), float(args[1])
    out = args[2] if len(args) > 2 else None
    hz, depth = float(opts.get('--hz', 200)), int(opts.get('--depth', 48))
    hp = k32.OpenProcess(PROCESS_ALL, False, pid)
    if not hp: sys.exit(f'OpenProcess failed {C.get_last_error()}')
    dbg.SymSetOptions(0x2 | 0x4)  # UNDNAME | DEFERRED_LOADS
    import os
    path = os.environ.get('SYMPATH')
    if not dbg.SymInitialize(hp, path.encode() if path else None, True): sys.exit('SymInitialize failed')
    handles = {}
    names = {}
    sym = SYMBOL_INFO(); sym.SizeOfStruct = 88; sym.MaxNameLen = 1000
    disp = C.c_uint64()

    def name(a):
        if a not in names:
            if dbg.SymFromAddr(hp, a, C.byref(disp), C.byref(sym)):
                names[a] = sym.Name.decode('utf8', 'replace')
            else:
                names[a] = f'0x{a:x}'
        return names[a]

    wait = ('NtWaitFor', 'NtDelayExecution', 'ZwDelayExecution', 'NtRemoveIoCompletion', 'ZwWaitFor', 'NtWaitForAlertByThreadId',
            'NtUserGetMessage', 'NtWaitForWorkViaWorkerFactory', 'ZwRemoveIoCompletion', 'ZwWaitForAlertByThreadId',
            'NtWaitForMultipleObjects', 'NtWaitForSingleObject', 'ZwWaitForSingleObject', 'ZwWaitForMultipleObjects', 'ZwWaitForWorkViaWorkerFactory')
    leafwait = {}
    stacks = collections.Counter()
    samples = idle = 0
    ctx = CONTEXT()
    end = time.perf_counter() + seconds
    next_refresh = 0
    while time.perf_counter() < end:
        tick = time.perf_counter()
        if tick > next_refresh:
            for tid in threads(pid):
                if tid not in handles:
                    h = k32.OpenThread(THREAD_ALL, False, tid)
                    if h: handles[tid] = h
            next_refresh = tick + 0.5
        for tid, ht in list(handles.items()):
            if k32.SuspendThread(ht) == 0xFFFFFFFF:
                k32.CloseHandle(ht); del handles[tid]; continue
            try:
                ctx.ContextFlags = CONTEXT_FULL
                if not k32.GetThreadContext(ht, C.byref(ctx)): continue
                w = leafwait.get(ctx.Rip)
                if w is None: w = leafwait[ctx.Rip] = any(x in name(ctx.Rip) for x in wait)
                if w: idle += 1; samples += 1; continue
                f = STACKFRAME64()
                f.AddrPC.Offset, f.AddrPC.Mode = ctx.Rip, 3
                f.AddrFrame.Offset, f.AddrFrame.Mode = ctx.Rbp, 3
                f.AddrStack.Offset, f.AddrStack.Mode = ctx.Rsp, 3
                frames = []
                while len(frames) < depth and dbg.StackWalk64(IMAGE_FILE_MACHINE_AMD64, hp, ht, C.byref(f), C.byref(ctx),
                                                                None, FTA, GMB, None):
                    if not f.AddrPC.Offset: break
                    frames.append(f.AddrPC.Offset)
                stacks[tuple(frames)] += 1
                samples += 1
            finally:
                k32.ResumeThread(ht)
        rest = 1.0 / hz - (time.perf_counter() - tick)
        if rest > 0: time.sleep(rest)

    selfc, incl = collections.Counter(), collections.Counter()
    busy = 0
    for st, n in stacks.items():
        if not st: continue
        leaf = name(st[0])
        if any(w in leaf for w in wait): idle += n; continue
        busy += n
        selfc[leaf] += n
        for fn in set(name(a) for a in st): incl[fn] += n
    lines = [f'pid {pid} seconds {seconds} samples {samples} busy {busy} idle {idle} threads {len(handles)}', '', '== self (busy samples) ==']
    lines += [f'{n:7d} {100.0 * n / max(1, busy):5.1f}%  {fn}' for fn, n in selfc.most_common(80)]
    lines += ['', '== inclusive ==']
    lines += [f'{n:7d} {100.0 * n / max(1, busy):5.1f}%  {fn}' for fn, n in incl.most_common(150)]
    text = '\n'.join(lines)
    if out:
        open(out, 'w', encoding='utf8').write(text)
        # Raw stacks for later drill-down: count;frame;frame...
        with open(out + '.stacks', 'w', encoding='utf8') as fh:
            for st, n in stacks.most_common():
                fh.write(f'{n};' + ';'.join(name(a) for a in st) + '\n')
    print(text[:6000])


if __name__ == '__main__':
    main()
