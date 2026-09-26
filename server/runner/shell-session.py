#!/usr/bin/env python3
"""Persist Bash state inside an isolated runner, never in the API host process.

The archive contains one private state file. It is moved out of the work tree
before learner code runs, so `git add .` cannot accidentally commit shell state.
Only the runner's final, post-cleanup persist step puts it back for snapshotting.

`run` executes one script. `terminal` gives the learner an interactive Bash on a
pseudo-terminal and relays it over stdin/stdout; the state is captured after every
command, so a dropped connection still keeps the last directory and variables.
"""
import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shlex
import signal
import stat
import struct
import subprocess
import sys
import tempfile
import termios
import time

STATE_NAME = '.nanaly-shell-session.json'
MAX_STATE = 1024 * 1024
MAX_HISTORY = 200 * 1024
HISTORY_LINES = 2000
RESULT_NAME = 'nanaly-shell-result.json'
PENDING_NAME = 'nanaly-shell-pending.json'
MAX_PENDING_INPUT = 1024 * 1024


def read_regular(file, limit=MAX_STATE):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('not a regular file')
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise ValueError('shell state exceeds limit')
    return value


def write_json(file, value):
    # All paths are in the container's tmpfs. Atomic replacement also avoids
    # following a symlink that learner code left at the destination.
    data = json.dumps(value, ensure_ascii=True).encode('utf-8')
    if len(data) > MAX_STATE:
        raise ValueError('shell state exceeds limit')
    fd, temporary = tempfile.mkstemp(prefix='.nanaly-write-', dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        os.replace(temporary, file)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def validate_state(state):
    if not isinstance(state, dict) or state.get('version') != 1:
        raise ValueError('unsupported shell state')
    if not isinstance(state.get('shell'), str) or '\0' in state['shell']:
        raise ValueError('invalid shell state')
    cwd = state.get('cwd')
    if not isinstance(cwd, str) or not cwd.startswith('/') or '\0' in cwd or len(cwd) > 4096:
        raise ValueError('invalid working directory')
    if state.get('env', 'full') not in ('full', 'diff'):
        raise ValueError('invalid environment mode')
    if not isinstance(state.get('history', ''), str) or '\0' in state.get('history', ''):
        raise ValueError('invalid history')
    return state


# Shared by scripts and the terminal. `local -` keeps `set +e +u` from leaking into an
# interactive shell whose options the learner chose.
SAVE_FUNCTION = r'''__nanaly_save_session() {
  local __nanaly_status="$1" __nanaly_name __nanaly_mask
  builtin local -
  builtin set +e +u
  __nanaly_mask=$(builtin umask)
  {
    builtin printf 'builtin umask %q\n' "$__nanaly_mask"
    while IFS= builtin read -r __nanaly_name; do
      case "$__nanaly_name" in
        BASHOPTS|SHELLOPTS|SHLVL|PWD|HOSTNAME|_|__nanaly_*) continue ;;
      esac
      [[ -v "__nanaly_base[$__nanaly_name]" && "${__nanaly_base[$__nanaly_name]}" == "${!__nanaly_name}" ]] && continue
      builtin declare -p -- "$__nanaly_name"
    done < <(builtin compgen -e)
    while IFS= builtin read -r __nanaly_name; do
      case "$__nanaly_name" in __nanaly_*) continue ;; esac
      [[ -v "__nanaly_builtin_functions[$__nanaly_name]" ]] && continue
      builtin declare -f -- "$__nanaly_name"
    done < <(builtin compgen -A function)
    builtin alias -p
  } > __CAPTURE__
  if [[ $? == 0 ]]; then
    if ! builtin pwd -P > __LOCATION__ 2>/dev/null; then
      builtin cd -- __WORKSPACE__ || return "$__nanaly_status"
      builtin pwd -P > __LOCATION__
      builtin printf 'reset' > __FALLBACK__
    fi
    builtin printf 'saved' > __FINISHED__
  fi
  return "$__nanaly_status"
}
'''

# The container's environment as it starts. Only variables the learner added or changed are
# saved, so a new runner image's PATH or settings reach existing workspaces.
BASE_ENVIRONMENT = r'''builtin declare -A __nanaly_base __nanaly_builtin_functions
while IFS= builtin read -r __nanaly_name; do
  __nanaly_base[$__nanaly_name]=${!__nanaly_name}
done < <(builtin compgen -e)
'''

RESTORE = r'''builtin source __RESTORE__
if [[ __LEGACY__ == 1 ]]; then
  for __nanaly_name in "${!__nanaly_base[@]}"; do
    builtin export "$__nanaly_name=${__nanaly_base[$__nanaly_name]}" 2>/dev/null
  done
fi
'''

# All user-controlled Bash is evaluated only by Bash in this sandbox.
# Do not use errexit/pipefail: a script retains ordinary Bash semantics.
SCRIPT_WRAPPER = 'builtin shopt -s expand_aliases\n' + BASE_ENVIRONMENT + SAVE_FUNCTION + r'''builtin trap '__nanaly_save_session "$?"' EXIT
''' + RESTORE + r'''builtin source __SCRIPT__
__nanaly_status=$?
__nanaly_save_session "$__nanaly_status"
builtin exit "$__nanaly_status"
'''

# Completion functions come from the image, not the learner, so they are never saved.
TERMINAL_RC = BASE_ENVIRONMENT + r'''if [[ -r /usr/share/bash-completion/bash_completion ]]; then
  builtin source /usr/share/bash-completion/bash_completion
fi
while IFS= builtin read -r __nanaly_name; do
  __nanaly_builtin_functions[$__nanaly_name]=1
done < <(builtin compgen -A function)
''' + SAVE_FUNCTION + r'''builtin alias ls='ls --color=auto' grep='grep --color=auto' ll='ls -alF' la='ls -A' l='ls -CF'
''' + RESTORE + r'''HISTSIZE=2000
HISTFILESIZE=2000
HISTCONTROL=ignoreboth
builtin shopt -s histappend checkwinsize huponexit
PS1='\[\e[01;32m\]\u@\h\[\e[00m\]:\[\e[01;34m\]\w\[\e[00m\]\$ '
__nanaly_prompt() {
  local __nanaly_status=$?
  builtin history -a
  __nanaly_save_session "$__nanaly_status"
}
PROMPT_COMMAND=__nanaly_prompt
builtin trap '__nanaly_save_session "$?"' EXIT
'''


def fill(template, paths, **extra):
    values = {'__' + key.upper() + '__': shlex.quote(str(value)) for key, value in paths.items()}
    values.update({'__' + key.upper() + '__': value for key, value in extra.items()})
    for key, value in values.items():
        template = template.replace(key, value)
    return template


def prepare(workspace, temporary):
    """Take the saved state out of the work tree and pick the directory to start in."""
    warnings = []
    state = {'version': 1, 'cwd': str(workspace), 'shell': ''}
    saved = workspace / STATE_NAME
    try:
        state = validate_state(json.loads(read_regular(saved)))
    except FileNotFoundError:
        pass
    except (OSError, ValueError):
        warnings.append('上次的 Shell 会话无法读取，已使用默认目录和环境；工作区文件仍然保留。')
    finally:
        try:
            saved.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            warnings.append('无法移除内部 Shell 会话文件，请勿将它加入 Git 提交。')
    for file in (temporary / RESULT_NAME, temporary / PENDING_NAME):
        try:
            file.unlink()
        except FileNotFoundError:
            pass
    # States saved before 'diff' captured every exported variable, freezing the image's own PATH,
    # HOME and so on; after restoring one, the container's current values are put back on top.
    legacy = '1' if state.get('env', 'full') == 'full' and state['shell'] else '0'
    cwd = state['cwd']
    if not os.path.isdir(cwd) or not os.access(cwd, os.X_OK):
        cwd = str(workspace)
        warnings.append('上次所在目录已不存在或无法进入，已回到工作区根目录。')
    return state, cwd, legacy, warnings


def job_paths(job, workspace):
    return {'restore': job / 'restore.sh', 'capture': job / 'capture.sh', 'location': job / 'cwd',
            'fallback': job / 'cwd-reset', 'finished': job / 'finished', 'workspace': workspace}


def conclude(paths, temporary, cwd, history, warnings):
    """Turn what the shell captured into the pending state and the result the API reads."""
    saved_ok = False
    final_cwd = cwd
    try:
        if read_regular(paths['finished'], 16) != b'saved':
            raise ValueError('shell did not save its state')
        shell = read_regular(paths['capture']).decode('utf-8')
        final_cwd = read_regular(paths['location'], 4097).decode('utf-8').removesuffix('\n')
        state = validate_state({'version': 1, 'cwd': final_cwd, 'shell': shell, 'env': 'diff', 'history': history})
        write_json(temporary / PENDING_NAME, state)
        saved_ok = True
        if paths['fallback'].exists():
            warnings.append('当前目录已被删除，后续命令将从工作区根目录继续。')
    except (OSError, ValueError, UnicodeError):
        warnings.append('Shell 会话未能保存，本次工作区改动不会覆盖上次已保存版本。')
    write_json(temporary / RESULT_NAME, {'cwd': final_cwd, 'shellStateSaved': saved_ok, 'warnings': warnings})


def run(workspace, temporary, script):
    state, cwd, legacy, warnings = prepare(workspace, temporary)
    with tempfile.TemporaryDirectory(prefix='nanaly-shell-', dir=temporary) as job:
        job = Path(job)
        paths = job_paths(job, workspace)
        paths['restore'].write_text(state['shell'], encoding='utf-8')
        wrapper = job / 'run.sh'
        wrapper.write_text(fill(SCRIPT_WRAPPER, {**paths, 'script': script}, legacy=legacy), encoding='utf-8')
        completed = subprocess.run(['/bin/bash', '--noprofile', '--norc', str(wrapper)], cwd=cwd)
        conclude(paths, temporary, cwd, state.get('history', ''), warnings)
        return completed.returncode if completed.returncode >= 0 else 128 - completed.returncode


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))


def size_from(payload):
    try:
        cols, rows = (int(value) for value in payload.decode('ascii').split())
    except (UnicodeError, ValueError):
        return None
    return (cols, rows) if 2 <= cols <= 500 and 2 <= rows <= 300 else None


def write_out(data):
    view = memoryview(data)
    while view:
        try:
            view = view[os.write(1, view):]
        except InterruptedError:
            continue


def relay(pid, master):
    """Frames on stdin: one type byte ('d' data, 'r' "cols rows"), a 4-byte length, the payload.
    PTY output goes to stdout unframed. End of stdin hangs the shell up."""
    inbox = bytearray()
    pending = bytearray()
    hangup_at = None
    status = None
    while True:
        if status is None:
            done, raw = os.waitpid(pid, os.WNOHANG)
            if done:
                status = raw
        readable = [master] + ([0] if hangup_at is None else [])
        writable = [master] if pending and status is None else []
        try:
            ready_read, ready_write, _ = select.select(readable, writable, [], 0.2)
        except InterruptedError:
            continue
        if master in ready_read:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                data = b''
            if data:
                write_out(data)
            else:
                break
        elif status is not None:
            # Bash is gone and nothing more is buffered; a background job may still hold the
            # terminal open, but the session is over.
            break
        if 0 in ready_read:
            chunk = os.read(0, 65536)
            if not chunk:
                hangup_at = time.monotonic()
                try:
                    os.killpg(pid, signal.SIGHUP)
                except ProcessLookupError:
                    pass
            else:
                inbox += chunk
                while len(inbox) >= 5:
                    size = int.from_bytes(inbox[1:5], 'big')
                    if len(inbox) < 5 + size:
                        break
                    kind, payload = inbox[0], bytes(inbox[5:5 + size])
                    del inbox[:5 + size]
                    if kind == ord('d'):
                        # Typing into a program that stopped reading: keep a bounded backlog.
                        pending += payload[:max(0, MAX_PENDING_INPUT - len(pending))]
                    elif kind == ord('r') and size_from(payload):
                        set_size(master, *size_from(payload))
        if master in ready_write and pending:
            try:
                del pending[:os.write(master, pending[:4096])]
            except BlockingIOError:
                pass
        if hangup_at is not None and status is None and time.monotonic() - hangup_at > 2:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    if status is None:
        _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


def terminal(workspace, temporary, cols, rows):
    state, cwd, legacy, warnings = prepare(workspace, temporary)
    with tempfile.TemporaryDirectory(prefix='nanaly-term-', dir=temporary) as job:
        job = Path(job)
        paths = job_paths(job, workspace)
        paths['restore'].write_text(state['shell'], encoding='utf-8')
        history = job / 'history'
        history.write_text(state.get('history', ''), encoding='utf-8')
        rcfile = job / 'bashrc'
        rcfile.write_text(fill(TERMINAL_RC, paths, legacy=legacy), encoding='utf-8')
        for warning in warnings:
            write_out(('\x1b[33m' + warning + '\x1b[0m\r\n').encode('utf-8'))
        environment = {**os.environ, 'TERM': 'xterm-256color', 'HISTFILE': str(history)}
        pid, master = pty.fork()
        if pid == 0:
            try:
                os.chdir(cwd)
                os.execve('/bin/bash', ['bash', '--noprofile', '--rcfile', str(rcfile), '-i'], environment)
            finally:
                os._exit(127)
        try:
            set_size(master, cols, rows)
            os.set_blocking(master, False)
            code = relay(pid, master)
        finally:
            os.close(master)
        try:
            lines = read_regular(history, 4 * MAX_HISTORY).decode('utf-8', 'replace').replace('\0', '').splitlines()
            kept = '\n'.join(lines[-HISTORY_LINES:]) + '\n' if lines else ''
            while len(kept.encode('utf-8')) > MAX_HISTORY:
                kept = kept.split('\n', 1)[1] if '\n' in kept else ''
        except (OSError, ValueError):
            kept = state.get('history', '')
        conclude(paths, temporary, cwd, kept, warnings)
        return code


def persist(workspace, temporary):
    state = validate_state(json.loads(read_regular(temporary / PENDING_NAME)))
    write_json(workspace / STATE_NAME, state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['run', 'persist', 'terminal'])
    parser.add_argument('script', nargs='?', default='/input/main.sh')
    parser.add_argument('--workspace', default='/work')
    parser.add_argument('--temporary', default='/tmp')
    parser.add_argument('--cols', type=int, default=80)
    parser.add_argument('--rows', type=int, default=24)
    args = parser.parse_args()
    workspace = Path(args.workspace).absolute()
    temporary = Path(args.temporary).absolute()
    if args.action == 'run':
        return run(workspace, temporary, Path(args.script).absolute())
    if args.action == 'terminal':
        return terminal(workspace, temporary, max(2, min(args.cols, 500)), max(2, min(args.rows, 300)))
    persist(workspace, temporary)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        print('Shell 会话保存失败：' + str(error), file=sys.stderr)
        sys.exit(1)
