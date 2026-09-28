#!/usr/bin/env python3
"""Bound one editor script inside an existing terminal without ending its shell.

The API removes the read-only mounted source to cancel. This works before Docker
exec starts as well as during execution, and cannot be undone by learner code.
Linux subreaping also keeps double-forked/setsid children owned by this run.
"""
import argparse
import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


def stop_children(child):
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait(timeout=3)
    # Killing a parent adopts its descendants here; repeat until all are reaped.
    children_file = Path('/proc/self/task') / str(os.getpid()) / 'children'
    deadline = time.monotonic() + 3
    while True:
        children = [int(pid) for pid in children_file.read_text().split()]
        if not children:
            return
        for pid in children:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        while True:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if not pid:
                    break
            except ChildProcessError:
                break
        if time.monotonic() > deadline:
            raise OSError('script children did not stop')
        time.sleep(0.01)


def run(script, seconds):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER (Linux)
        raise OSError(ctypes.get_errno(), 'cannot supervise script children')
    if not script.is_file():
        return 126
    child = subprocess.Popen(['/bin/bash', str(script)], start_new_session=True)
    deadline = time.monotonic() + seconds
    try:
        while child.poll() is None:
            if not script.exists():
                return 126
            if time.monotonic() >= deadline:
                return 124
            time.sleep(0.05)
        return child.returncode if child.returncode >= 0 else 128 - child.returncode
    finally:
        stop_children(child)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('script', type=Path)
    parser.add_argument('--seconds', type=float, default=30)
    args = parser.parse_args()
    if not 0 < args.seconds <= 30:
        parser.error('seconds must be between 0 and 30')
    try:
        sys.exit(run(args.script, args.seconds))
    except (OSError, subprocess.TimeoutExpired) as error:
        print('Script supervision failed: ' + str(error), file=sys.stderr)
        sys.exit(125)
