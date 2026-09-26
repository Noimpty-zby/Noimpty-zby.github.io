"""Syntax-check Python practice code without running it.

Errors are printed as `file:line:col: error: ...`, the same shape gcc uses, so the API's
existing diagnostics parser and the editor's inline marks work unchanged.
"""
import sys

path = sys.argv[1]
try:
    with open(path, encoding='utf-8') as handle:
        compile(handle.read(), path, 'exec', dont_inherit=True)
except SyntaxError as error:  # includes IndentationError and TabError
    print(f'{path}:{error.lineno or 1}:{error.offset or 1}: error: {type(error).__name__}: {error.msg}', file=sys.stderr)
    sys.exit(1)
except UnicodeDecodeError as error:
    print(f'{path}:1:1: error: 源代码不是 UTF-8 编码（{error.reason}）', file=sys.stderr)
    sys.exit(1)
