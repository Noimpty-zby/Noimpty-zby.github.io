// Linux 第六章 6.2：Ctrl+R 边打边搜。按下 Ctrl+R 输入 sort，再按两次往更早翻，
// 用 Ctrl+E 把找到的命令放回命令行、光标到行尾，加上 -r 之后执行；最后演示 Ctrl+G 放弃搜索。
// （→ 也能退出搜索，但光标停在匹配处后面一个字符，直接打字会插到命令中间。）
export default {
  name: 'linux/ch6-ctrl-r',
  title: 'Ctrl+R 边打边搜',
  cols: 80,
  rows: 14,
  cwd: 'projects/linux-study',
  files: {
    'projects/linux-study/names.txt': 'zhou\nlin\nchen\nan\n',
    'projects/linux-study/scores.txt': '88\n9\n100\n72\n'
  },
  history: [
    'ls -la',
    'sort names.txt',
    'cat names.txt',
    'sort -n scores.txt',
    'head -n 2 names.txt',
    'sort -u names.txt',
    'clear'
  ],
  steps: [
    { wait: 600 },
    { key: 'C-r' }, { wait: 800 },
    { type: 'sort' }, { wait: 1400 },
    { key: 'C-r' }, { wait: 1200 },
    { key: 'C-r' }, { wait: 1200 },
    { key: 'C-e' }, { wait: 800 },
    { type: ' -r' }, { wait: 700 },
    { key: 'Enter' }, { wait: 1500 },
    { key: 'C-r' }, { wait: 500 },
    { type: 'cat' }, { wait: 1200 },
    { key: 'C-g' }, { wait: 1000 }
  ]
}
