import subprocess, sys
with open('/input/workspace.snapshot', 'rb') as source:
    result = subprocess.run(['mysql', '--no-defaults', '--protocol=SOCKET', '--socket=/tmp/mysql.sock', '--binary-mode', '--local-infile=0', '--default-character-set=utf8mb4', '--user=learner', '--database=practice'], stdin=source)
sys.exit(result.returncode)
