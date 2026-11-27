"""Arm or run one reduced V7 profiling campaign on the local Windows host."""
import argparse
import ctypes as c
from ctypes import wintypes as w
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time

kernel = c.WinDLL("kernel32", use_last_error=True)
SIZE = c.c_size_t
INVALID_HANDLE = c.c_void_p(-1).value
SCRIPTS = Path(__file__).resolve().parent


def bind(name, result, *args):
    method = getattr(kernel, name)
    method.restype = result
    method.argtypes = args
    return method


class ProcessEntry(c.Structure):
    _fields_ = [("size", w.DWORD), ("usage", w.DWORD), ("pid", w.DWORD),
                ("heap", SIZE), ("module", w.DWORD), ("threads", w.DWORD),
                ("parent", w.DWORD), ("priority", w.LONG), ("flags", w.DWORD),
                ("name", w.WCHAR * 260)]


get_cpu_sets = bind("GetSystemCpuSetInformation", w.BOOL, c.c_void_p, w.DWORD, c.POINTER(w.DWORD), w.HANDLE, w.DWORD)
current = bind("GetCurrentProcess", w.HANDLE)
get_affinity = bind("GetProcessAffinityMask", w.BOOL, w.HANDLE, c.POINTER(SIZE), c.POINTER(SIZE))
set_affinity = bind("SetProcessAffinityMask", w.BOOL, w.HANDLE, SIZE)
snapshot = bind("CreateToolhelp32Snapshot", w.HANDLE, w.DWORD, w.DWORD)
first = bind("Process32FirstW", w.BOOL, w.HANDLE, c.POINTER(ProcessEntry))
next_process = bind("Process32NextW", w.BOOL, w.HANDLE, c.POINTER(ProcessEntry))
open_process = bind("OpenProcess", w.HANDLE, w.DWORD, w.BOOL, w.DWORD)
cycles = bind("QueryProcessCycleTime", w.BOOL, w.HANDLE, c.POINTER(c.c_ulonglong))
times = bind("GetProcessTimes", w.BOOL, w.HANDLE, *([c.POINTER(c.c_ulonglong)] * 4))
close = bind("CloseHandle", w.BOOL, w.HANDLE)


def cpu_mask():
    length = w.DWORD()
    get_cpu_sets(None, 0, c.byref(length), None, 0)
    data = c.create_string_buffer(length.value)
    if not get_cpu_sets(data, length, c.byref(length), None, 0):
        raise c.WinError(c.get_last_error())
    # Windows CPU-set record. Select one logical processor per physical core
    # within the repository's capture window, and preserve the allowed mask.
    available, system = SIZE(), SIZE()
    if not get_affinity(current(), c.byref(available), c.byref(system)):
        raise c.WinError(c.get_last_error())
    selected = {}
    offset = 0
    while offset + 20 <= length.value:
        raw = data.raw[offset:offset + 20]
        size = int.from_bytes(raw[:4], "little")
        if size < 20:
            raise RuntimeError("Invalid CPU-set record")
        if raw[4:8] == bytes(4) and raw[12:14] == bytes(2):
            logical, core, efficiency = raw[14], raw[15], raw[18]
            if 9 <= logical <= 23 and available.value & (1 << logical):
                selected.setdefault(core, {"physicalCore": core, "logicalCpu": logical, "efficiencyClass": efficiency})
        offset += size
    if len(selected) != 12:
        raise RuntimeError(f"Expected 12 distinct physical cores on logical CPUs 9–23, found {list(selected.values())}")
    return sum(1 << item["logicalCpu"] for item in selected.values()), list(selected.values())


def process_table():
    handle = snapshot(2, 0)
    if handle in (None, INVALID_HANDLE):
        raise c.WinError(c.get_last_error())
    entry = ProcessEntry(size=c.sizeof(ProcessEntry))
    try:
        rows = {}
        valid = first(handle, c.byref(entry))
        while valid:
            rows[entry.pid] = (entry.parent, entry.name)
            valid = next_process(handle, c.byref(entry))
        return rows
    finally:
        close(handle)


def process_tree(root):
    table = process_table()
    children = {root}
    while True:
        expanded = children | {pid for pid, (parent, _) in table.items() if parent in children}
        if expanded == children:
            break
        children = expanded
    return {pid: table[pid] for pid in sorted(children & table.keys())}


def sample(table, mask, stream):
    for pid, (parent, image) in table.items():
        handle = open_process(0x1000, False, pid)
        if not handle:
            continue
        try:
            count, born, ended, ktime, utime = [c.c_ulonglong() for _ in range(5)]
            affinity, system = SIZE(), SIZE()
            read_at = time.time_ns() / 1e6
            if not cycles(handle, c.byref(count)) or not times(handle, *map(c.byref, (born, ended, ktime, utime))):
                continue
            if not get_affinity(handle, c.byref(affinity), c.byref(system)):
                continue
            stream.write(json.dumps(dict(atMs=read_at, pid=pid, parent=parent, image=image,
                                         createdFileTime=born.value, cycles=count.value,
                                         cpuMs=(ktime.value + utime.value) / 10_000,
                                         affinity=hex(affinity.value))) + "\n")
            if affinity.value & ~mask:
                raise RuntimeError(f"Process {pid} ({image}) escaped the requested affinity: {hex(affinity.value)}")
        finally:
            close(handle)


def sample_until_exit(process, mask, stream):
    # Toolhelp scans the whole machine. Refresh the tree independently so a
    # slow scan does not widen all the cycle sampling intervals.
    table = {}
    stop = threading.Event()
    discovery_errors = []

    def discover():
        nonlocal table
        try:
            while not stop.is_set():
                table = process_tree(process.pid)
                stop.wait(0.25)
        except OSError as error:
            discovery_errors.append(error)

    observer = threading.Thread(target=discover, daemon=True)
    observer.start()
    try:
        deadline = time.monotonic() + 30 * 60
        while process.poll() is None:
            if discovery_errors:
                raise discovery_errors[0]
            if time.monotonic() >= deadline:
                raise TimeoutError("Profiling campaign exceeded 30 minutes")
            sample(table, mask, stream)
            time.sleep(0.01)
    finally:
        stop.set()
        observer.join()


def summarize(output):
    browser_file = output / "browser.json"
    if not browser_file.exists():
        return
    browser = json.loads(browser_file.read_bytes())
    series = {}
    for line in (output / "cpu.ndjson").read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        series.setdefault((row["pid"], row["createdFileTime"]), []).append(row)
    windows = [*(browser.get("phases", [])),
               *(r | {"name": r.get("kind") or r["path"]} for r in browser.get("requests", []) if r.get("status", 0) > 0)]
    rows = []
    for item in windows:
        start, end = item.get("startMs"), item.get("endMs")
        if start is None or end is None or end < start:
            continue
        sums = {}
        for (pid, _), points in series.items():
            name = "native" if pid == browser.get("enginePid") else "chrome" if points[0]["image"].lower() == "chrome.exe" else "harness"
            result = sums.setdefault(name, {"cyclesInside": 0, "cpuMsInside": 0.0, "observedPids": 0, "maxEdgeGapMs": 0.0})
            inside = [p for p in points if start <= p["atMs"] <= end]
            if len(inside) >= 2:
                a, b = inside[0], inside[-1]
                result["cyclesInside"] += b["cycles"] - a["cycles"]
                result["cpuMsInside"] += b["cpuMs"] - a["cpuMs"]
                result["observedPids"] += 1
                result["maxEdgeGapMs"] = max(result["maxEdgeGapMs"], a["atMs"] - start, end - b["atMs"])
        rows.append(dict(caseId=item.get("caseId"), name=item["name"], path=item.get("path"),
                         startMs=start, endMs=end, wallMs=end - start, cpu=sums))
    dump(output / "timings.json", {"schema": 1, "windows": rows})


def dump(file, data):
    file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("--run", type=Path, metavar="NEW_OUTPUT_DIR")
    parser.add_argument("--pmu", action="store_true", help="Collect extra PMU samples and CPU timing stacks with xperf (elevated Windows)")
    args = parser.parse_args()
    config = json.loads(args.config.read_bytes())
    assert [x["request"]["population"] for x in config["cases"]] == [500, 2500, 10000], "Unexpected campaign cases"
    index = next(item for item in config["v2Build"]["artifacts"] if item["path"] == "web/dist-v2/v2.html")
    files = [(config["engine"], config["engineArtifact"]["sha256"]), (config["pdb"], config["symbols"]["sha256"]),
             (Path(config["dist"]) / "v2.html", index["sha256"])]
    files.extend((case["decorFile"], case["sha256"]) for case in config["cases"])
    for filename, expected in files:
        with Path(filename).open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected.lower():
            raise ValueError(f"Frozen asset has changed: {filename}")
    mask, cpus = cpu_mask()
    pmu_available = bool(shutil.which("xperf") and c.windll.shell32.IsUserAnAdmin())
    print(json.dumps(dict(preflight="ok", logicalMask=hex(mask), cpus=cpus, canStartPmu=pmu_available), indent=2), flush=True)
    if not args.run:
        return
    if args.pmu and not pmu_available:
        raise RuntimeError("The PMU stack recording needs an elevated shell and xperf")
    if any(name.lower() in ("cargo.exe", "rustc.exe") for _, name in process_table().values()):
        raise RuntimeError("A Rust build is active. Wait for its shared window to close before starting")
    output = args.run.resolve()
    output.mkdir(parents=True)
    dump(output / "run.json", config | dict(affinity=hex(mask), cpus=cpus, pmu=args.pmu,
                                            samplerIntervalTargetMs=10, processDiscoveryPauseMs=250))
    kernel_trace = output / "cycles.etl"
    tracing = False
    process = None
    affinity, system = SIZE(), SIZE()
    try:
        if args.pmu:
            subprocess.run(["xperf", "-on", "PROC_THREAD+LOADER+PROFILE", "-PmcProfile", "TotalCycles",
                            "-stackwalk", "Profile", "-buffersize", "256", "-minbuffers", "64",
                            "-maxbuffers", "256", "-f", str(kernel_trace)], check=True)
            tracing = True
        if not get_affinity(current(), c.byref(affinity), c.byref(system)) or not set_affinity(current(), mask):
            raise c.WinError(c.get_last_error())
        env = dict(os.environ)
        for key in ("URBAN_THREADS", "MAGNA_CORES", "NODE_OPTIONS"):
            env.pop(key, None)
        try:
            with (output / "runner.log").open("w", encoding="utf-8") as log:
                process = subprocess.Popen(["node", str(SCRIPTS / "v7_profile_browser.mjs"), str(args.config.resolve()), str(output)],
                                           env=env, stdout=log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW)
        finally:
            # Keep the collector off the measured CPUs. The Node child and
            # its native engine and Chrome retain the affinity inherited above.
            if not set_affinity(current(), affinity.value & ~mask or affinity.value):
                raise c.WinError(c.get_last_error())
        with (output / "cpu.ndjson").open("w", encoding="utf-8", buffering=65536) as stream:
            sample_until_exit(process, mask, stream)
        if process.returncode:
            raise SystemExit(process.returncode)
    finally:
        if process and process.poll() is None:
            # Restrict cleanup to the campaign we started.
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
        if tracing:
            subprocess.run(["xperf", "-stop"], check=True)
        summarize(output)


if __name__ == "__main__":
    main()
