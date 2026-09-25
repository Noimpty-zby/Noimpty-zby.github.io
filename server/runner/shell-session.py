#!/usr/bin/env python3
"""Persist Bash state inside an isolated runner, never in the API host process.

The archive contains one private state file. It is moved out of the work tree
before learner code runs, so `git add .` cannot accidentally commit shell state.
Only the runner's final, post-cleanup persist step puts it back for snapshotting.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import sys
import tempfile

STATE_NAME = '.nanaly-shell-session.json'
MAX_STATE = 1024 * 1024
RESULT_NAME = 'nanaly-shell-result.json'
PENDING_NAME = 'nanaly-shell-pending.json'


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
    return state


def run(workspace, temporary, script):
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
    cwd = state['cwd']
    if not os.path.isdir(cwd) or not os.access(cwd, os.X_OK):
        cwd = str(workspace)
        warnings.append('上次所在目录已不存在或无法进入，已回到工作区根目录。')
    with tempfile.TemporaryDirectory(prefix='nanaly-shell-', dir=temporary) as job:
        job = Path(job)
        restore = job / 'restore.sh'
        capture = job / 'capture.sh'
        location = job / 'cwd'
        fallback = job / 'cwd-reset'
        finished = job / 'finished'
        wrapper = job / 'run.sh'
        restore.write_text(state['shell'], encoding='utf-8')
        # All user-controlled Bash is evaluated only by Bash in this sandbox.
        # Do not use errexit/pipefail: a script retains ordinary Bash semantics.
        wrapper.write_text(r'''builtin shopt -s expand_aliases
__nanaly_save_session() {
  local __nanaly_status="$1" __nanaly_name __nanaly_mask
  builtin set +e +u
  __nanaly_mask=$(builtin umask)
  {
    builtin printf 'builtin umask %q\n' "$__nanaly_mask"
    while IFS= builtin read -r __nanaly_name; do
      case "$__nanaly_name" in
        BASHOPTS|SHELLOPTS|SHLVL|PWD|HOSTNAME|_|__nanaly_*) continue ;;
      esac
      builtin declare -p -- "$__nanaly_name"
    done < <(builtin compgen -e)
    while IFS= builtin read -r __nanaly_name; do
      case "$__nanaly_name" in __nanaly_*) continue ;; esac
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
builtin trap '__nanaly_save_session "$?"' EXIT
builtin source __RESTORE__
builtin source __SCRIPT__
__nanaly_status=$?
__nanaly_save_session "$__nanaly_status"
builtin exit "$__nanaly_status"
'''.replace('__CAPTURE__', shlex.quote(str(capture))).replace('__LOCATION__', shlex.quote(str(location)))
            .replace('__FINISHED__', shlex.quote(str(finished))).replace('__RESTORE__', shlex.quote(str(restore)))
            .replace('__WORKSPACE__', shlex.quote(str(workspace))).replace('__FALLBACK__', shlex.quote(str(fallback)))
            .replace('__SCRIPT__', shlex.quote(str(script))), encoding='utf-8')
        completed = subprocess.run(['/bin/bash', '--noprofile', '--norc', str(wrapper)], cwd=cwd)
        saved_ok = False
        final_cwd = cwd
        try:
            if read_regular(finished, 16) != b'saved':
                raise ValueError('shell did not save its state')
            shell = read_regular(capture).decode('utf-8')
            final_cwd = read_regular(location, 4097).decode('utf-8').removesuffix('\n')
            state = validate_state({'version': 1, 'cwd': final_cwd, 'shell': shell})
            write_json(temporary / PENDING_NAME, state)
            saved_ok = True
            if fallback.exists():
                warnings.append('当前目录已被删除，后续命令将从工作区根目录继续。')
        except (OSError, ValueError, UnicodeError):
            warnings.append('Shell 会话未能保存，本次工作区改动不会覆盖上次已保存版本。')
        write_json(temporary / RESULT_NAME, {'cwd': final_cwd, 'shellStateSaved': saved_ok, 'warnings': warnings})
        return completed.returncode if completed.returncode >= 0 else 128 - completed.returncode


def persist(workspace, temporary):
    state = validate_state(json.loads(read_regular(temporary / PENDING_NAME)))
    write_json(workspace / STATE_NAME, state)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['run', 'persist'])
    parser.add_argument('script', nargs='?', default='/input/main.sh')
    parser.add_argument('--workspace', default='/work')
    parser.add_argument('--temporary', default='/tmp')
    args = parser.parse_args()
    workspace = Path(args.workspace).absolute()
    temporary = Path(args.temporary).absolute()
    if args.action == 'run':
        return run(workspace, temporary, Path(args.script).absolute())
    persist(workspace, temporary)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        print('Shell 会话保存失败：' + str(error), file=sys.stderr)
        sys.exit(1)
