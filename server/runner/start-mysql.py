import subprocess, time, sys
command = ['mysqld', '--no-defaults', '--datadir=/work/mysql', '--socket=/tmp/mysql.sock',
 '--pid-file=/tmp/mysql.pid', '--log-error=/tmp/mysql.log', '--skip-networking',
 '--secure-file-priv=NULL', '--local-infile=0', '--skip-log-bin', '--mysqlx=0',
 '--innodb-buffer-pool-size=32M', '--innodb-redo-log-capacity=64M',
 '--innodb-doublewrite=OFF', '--max-connections=8', '--performance-schema=OFF']
process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
for attempt in range(100):
    if process.poll() is not None: sys.exit(1)
    result = subprocess.run(['mysqladmin', '--no-defaults', '--protocol=SOCKET', '--socket=/tmp/mysql.sock', '--user=root', 'ping'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if result.returncode == 0: sys.exit(0)
    time.sleep(.2)
sys.exit(1)
