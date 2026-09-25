# Stop leftovers before snapshotting. Repeat to catch children forked during a scan.
import os, signal, sys
from pathlib import Path
for attempt in range(32):
    found = False
    for proc in Path('/proc').iterdir():
        if proc.name.isdigit() and int(proc.name) not in (1, os.getpid()):
            try:
                # Zombies hold no resources and cannot mutate the workspace.
                stat = (proc / 'stat').read_text()
                if stat.rsplit(')', 1)[1].strip().split()[0] == 'Z': continue
                found = True
                os.kill(int(proc.name), signal.SIGKILL)
            except (ProcessLookupError, FileNotFoundError): pass
            except PermissionError: sys.exit(1)
    if not found: sys.exit(0)
sys.exit(1)
