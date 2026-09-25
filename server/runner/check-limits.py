from pathlib import Path
import sys
try:
    root = Path('/sys/fs/cgroup')
    memory = int((root / 'memory.max').read_text().strip())
    pids = int((root / 'pids.max').read_text().strip())
    quota, period = map(int, (root / 'cpu.max').read_text().split())
    assert 0 < memory <= 1073741824 and 0 < pids <= 96 and 0 < quota <= period
    assert Path('/proc/sys/kernel/unprivileged_bpf_disabled').read_text().strip() != '0'
except (OSError, ValueError, AssertionError):
    sys.exit(1)
