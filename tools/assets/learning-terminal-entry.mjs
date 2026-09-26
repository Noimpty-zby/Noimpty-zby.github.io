/**
 * Self-hosted xterm.js view for the code studio's Git/Linux terminal.
 * Build: npm run build:learning-terminal. Loaded on demand the first time a terminal opens;
 * the socket protocol lives in learning-lab.js, this file only draws and reads keys.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import css from '@xterm/xterm/css/xterm.css';

// ANSI colours chosen for contrast on the studio's cream and night-lavender surfaces:
// the green/blue prompt and `ls --color` directories must stay readable on both.
const THEMES = {
  light: {
    background: '#fffdf9', foreground: '#46364f', cursor: '#b94779', cursorAccent: '#fffdf9',
    selectionBackground: '#eedaf2', selectionInactiveBackground: '#f3e8f3',
    black: '#3b2f40', red: '#bd3a58', green: '#2f7d55', yellow: '#94620f', blue: '#3f5db3', magenta: '#a3407f', cyan: '#237a87', white: '#8a7c8d',
    brightBlack: '#7e6c82', brightRed: '#d0506f', brightGreen: '#3a8f63', brightYellow: '#a8741d', brightBlue: '#5570c4', brightMagenta: '#b8549a', brightCyan: '#2f8c99', brightWhite: '#46364f'
  },
  dark: {
    background: '#231e29', foreground: '#f0e0ed', cursor: '#f8accf', cursorAccent: '#231e29',
    selectionBackground: '#584267', selectionInactiveBackground: '#43354d',
    black: '#3a3140', red: '#ff8fa3', green: '#9ad4a8', yellow: '#efc98a', blue: '#a7b8ff', magenta: '#f0a6d8', cyan: '#8fd6e0', white: '#e6d9e3',
    brightBlack: '#8d7a95', brightRed: '#ffa9b9', brightGreen: '#b3e6bf', brightYellow: '#f7dba8', brightBlue: '#c1ceff', brightMagenta: '#f7c2e6', brightCyan: '#aee6ee', brightWhite: '#fff7fc'
  }
};

let styled = false;
function create(host, { theme = 'light', fontSize = 14, onData, onResize, onTitle, onOpen } = {}) {
  if (!styled) {
    const style = document.createElement('style');
    style.dataset.learningTerminal = '';
    style.textContent = css;
    document.head.append(style);
    styled = true;
  }
  const term = new Terminal({
    fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', 'Microsoft YaHei', monospace",
    fontSize,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: false,
    macOptionIsMeta: true,
    theme: THEMES[theme] || THEMES.light
  });
  // Output replayed after a reconnect is drawn again, but its requests (`code FILE`) were
  // already handled when it first arrived.
  let replaying = 0;
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  // Like desktop terminals: Ctrl+C copies when text is selected and interrupts otherwise;
  // Ctrl+V (and Ctrl+Shift+C/V) go to the browser so its paste reaches the terminal.
  term.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown' || !(event.ctrlKey || event.metaKey) || event.altKey) return true;
    const key = event.key.toLowerCase();
    if (key === 'c' && (term.hasSelection() || event.shiftKey)) {
      const text = term.getSelection();
      if (text) navigator.clipboard?.writeText(text).catch(() => {});
      term.clearSelection(); event.preventDefault();
      return false;
    }
    return key !== 'v';
  });
  const subscriptions = [
    term.onData(data => onData?.(data)),
    term.onResize(({ cols, rows }) => onResize?.(cols, rows)),
    // The prompt sets the window title to "user@host: dir", as Ubuntu's does.
    term.onTitleChange(title => onTitle?.(title)),
    // `code FILE` in the sandbox asks the page to open FILE: OSC 7337 ; open ; base64(path).
    term.parser.registerOscHandler(7337, data => {
      const [action, encoded] = data.split(';');
      if (action === 'open' && encoded && !replaying) {
        try { onOpen?.(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)))); } catch (_) {}
      }
      return true;
    })
  ];
  let frame = 0;
  const refit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // A hidden host has no size; fitting it would collapse the terminal to 2 columns.
      if (host.clientWidth > 20 && host.clientHeight > 20) { try { fit.fit(); } catch (_) {} }
    });
  };
  const observer = new ResizeObserver(refit);
  observer.observe(host);
  refit();
  return {
    write: (data, replay = false) => {
      if (!replay) { term.write(data); return; }
      replaying++; term.write(data, () => { replaying--; });
    },
    // Messages from the page itself, set apart from shell output by colour and their own line.
    // Where the cursor is counts only once earlier output has been drawn, hence the empty write.
    notice: (text, tone = 'dim') => term.write('', () => {
      const fresh = term.buffer.active.cursorX === 0;
      term.write(`${fresh ? '' : '\r\n'}\x1b[${{ dim: '2', warn: '33', error: '31' }[tone] || '2'}m${String(text).replace(/\n/g, '\r\n')}\x1b[0m\r\n`);
    }),
    size: () => ({ cols: term.cols, rows: term.rows }),
    fit: refit,
    focus: () => term.focus(),
    blur: () => term.blur(),
    // Typed as one paste, in bracketed-paste form when the program asked for it.
    paste: text => term.paste(text),
    // Before a full replay of a session the page did not see from the start.
    reset: () => term.reset(),
    setFontSize: size => { term.options.fontSize = size; refit(); },
    applicationCursor: () => term.modes.applicationCursorKeysMode,
    setTheme: name => { term.options.theme = THEMES[name] || THEMES.light; },
    transcript: (lines = 60) => {
      const buffer = term.buffer.active, end = buffer.baseY + buffer.cursorY + 1, text = [];
      for (let row = Math.max(0, end - lines); row < end; row++) text.push(buffer.getLine(row)?.translateToString(true) ?? '');
      return text.join('\n').replace(/\n+$/, '');
    },
    dispose: () => { cancelAnimationFrame(frame); observer.disconnect(); for (const subscription of subscriptions) subscription.dispose(); term.dispose(); }
  };
}

window.NOIMPTY_TERMINAL = Object.freeze({ create });
