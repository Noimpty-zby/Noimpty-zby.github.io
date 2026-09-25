/**
 * Self-hosted CodeMirror 6 adapter for the learning IDE.
 * Build: npm run build:learning-editor
 * Third-party MIT license notices are collected into the generated bundle.
 */
import { basicSetup } from 'codemirror';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { completeFromList } from '@codemirror/autocomplete';
import { cpp } from '@codemirror/lang-cpp';
import { go } from '@codemirror/lang-go';
import { MySQL, sql } from '@codemirror/lang-sql';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { tags } from '@lezer/highlight';

const MAX_CODE_LENGTH = 65536;
const LANGUAGES = new Set(['c', 'cpp', 'go', 'git', 'linux', 'mysql']);
const normalizeLanguage = value => LANGUAGES.has(value) ? value : 'c';
const words = (text, type = 'keyword') => text.split(/\s+/).map(label => ({ label, type }));
const completions = {
  c: [
    ...words('auto break case char const continue default do double else enum extern float for if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while'),
    ...words('printf scanf puts getchar malloc calloc realloc free strlen strcmp strcpy memcpy memset', 'function')
  ],
  cpp: [
    ...words('alignas auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit false float for friend if int long namespace new nullptr operator override private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'),
    ...words('std cout cin endl string vector map set sort begin end push_back size', 'variable')
  ],
  git: words('git status add commit diff log branch switch checkout restore reset stash merge rebase fetch pull push remote tag init clone show', 'function'),
  linux: [
    ...words('if then else elif fi for in do done while case esac function export return'),
    ...words('echo printf pwd ls cd cat head tail wc grep find sed awk sort uniq cut tr touch mkdir cp mv rm chmod test read', 'function')
  ]
};
const shellLanguage = StreamLanguage.define(shell);
function languageExtension(id) {
  const language = id === 'go' ? go()
    : id === 'mysql' ? sql({ dialect: MySQL, upperCaseKeywords: true })
    : id === 'git' || id === 'linux' ? shellLanguage : cpp();
  const options = completions[id];
  if (!options) return language;
  const data = [{ autocomplete: completeFromList(options) }];
  return [language, EditorState.languageData.of(() => data)];
}

const syntax = syntaxHighlighting(HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--lab-syntax-keyword, var(--lab-cm-keyword))', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: 'var(--lab-syntax-string, var(--lab-cm-string))' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--lab-syntax-number, var(--lab-cm-number))' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--lab-syntax-comment, var(--lab-cm-comment))', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.standard(tags.variableName)], color: 'var(--lab-syntax-function, var(--lab-cm-function))' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.attributeName], color: 'var(--lab-syntax-type, var(--lab-cm-type))' },
  { tag: [tags.operator, tags.operatorKeyword, tags.punctuation], color: 'var(--lab-syntax-operator, var(--lab-cm-operator))' },
  { tag: [tags.meta, tags.processingInstruction], color: 'var(--lab-syntax-keyword, var(--lab-cm-keyword))' },
  { tag: tags.invalid, color: '#d83f66', textDecoration: 'underline wavy' }
]));

const layout = EditorView.theme({
  '&': {
    height: '100%', minHeight: '0', fontSize: '14px',
    color: 'var(--lab-editor-text, var(--lab-cm-text))',
    backgroundColor: 'var(--lab-editor-bg, var(--lab-cm-bg))'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto', minHeight: '0', height: '100%',
    fontFamily: '"Cascadia Code", "Fira Code", Consolas, "SFMono-Regular", monospace',
    lineHeight: '1.8', overscrollBehavior: 'contain', scrollbarWidth: 'thin'
  },
  '.cm-content': { padding: '18px 0', caretColor: 'var(--lab-editor-cursor, #ce5a92)' },
  '.cm-line': { padding: '0 20px 0 14px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--lab-editor-cursor, #ce5a92)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--lab-editor-gutter, var(--lab-cm-gutter))',
    color: 'var(--lab-editor-muted, var(--lab-cm-muted))',
    borderRight: '1px solid var(--lab-editor-border, var(--lab-cm-border))'
  },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '38px', padding: '0 10px 0 8px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--lab-editor-line, var(--lab-cm-line))' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--lab-editor-selection, var(--lab-cm-selection))'
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--lab-editor-selection, var(--lab-cm-selection))' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--lab-editor-selection, var(--lab-cm-selection))',
    color: 'inherit', outline: '1px solid var(--lab-editor-cursor, #ce5a92)', borderRadius: '3px'
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--lab-editor-gutter, var(--lab-cm-gutter))',
    borderColor: 'var(--lab-editor-border, var(--lab-cm-border))',
    color: 'var(--lab-editor-muted, var(--lab-cm-muted))'
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--lab-editor-bg, var(--lab-cm-bg))',
    color: 'var(--lab-editor-text, var(--lab-cm-text))',
    border: '1px solid var(--lab-editor-border, var(--lab-cm-border))',
    borderRadius: '8px', boxShadow: '0 8px 28px #40283820'
  },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--lab-editor-selection, var(--lab-cm-selection))', color: 'inherit'
  },
  '.cm-panels': {
    backgroundColor: 'var(--lab-editor-gutter, var(--lab-cm-gutter))',
    color: 'var(--lab-editor-text, var(--lab-cm-text))'
  },
  '.cm-search input, .cm-search button': { font: 'inherit' }
});

function palette(dark) {
  return EditorView.theme({
    '&': dark ? {
      '--lab-cm-bg': '#292335', '--lab-cm-text': '#f0e5f3', '--lab-cm-gutter': '#241f30',
      '--lab-cm-muted': '#a89bb7', '--lab-cm-border': '#483b54', '--lab-cm-line': '#382c43',
      '--lab-cm-selection': '#624361', '--lab-cm-keyword': '#f3a3cc', '--lab-cm-string': '#a9d5a2',
      '--lab-cm-number': '#efbd87', '--lab-cm-comment': '#a49aaa', '--lab-cm-function': '#a9c9ff',
      '--lab-cm-type': '#d6b6ff', '--lab-cm-operator': '#efc68f'
    } : {
      '--lab-cm-bg': '#fffdfb', '--lab-cm-text': '#4a3b50', '--lab-cm-gutter': '#fff6f7',
      '--lab-cm-muted': '#b093a4', '--lab-cm-border': '#f3e3e9', '--lab-cm-line': '#fff1f6',
      '--lab-cm-selection': '#f6d9e8', '--lab-cm-keyword': '#b43f85', '--lab-cm-string': '#328363',
      '--lab-cm-number': '#b7762d', '--lab-cm-comment': '#8f879d', '--lab-cm-function': '#3e6faf',
      '--lab-cm-type': '#8259b2', '--lab-cm-operator': '#af6657'
    }
  }, { dark });
}

function create(host, options = {}) {
  if (!host || host.nodeType !== 1) throw new TypeError('Code editor requires a host element');
  const document = host.ownerDocument;
  const scope = document.defaultView;
  let currentLanguage = normalizeLanguage(options.language);
  let destroyed = false;
  const language = new Compartment();
  const theme = new Compartment();
  const editorThemeRoot = host.closest('[data-editor-theme]') || host.closest('.learning-lab') || host;
  const isDark = () => {
    const preference = host.closest('[data-editor-theme]')?.getAttribute('data-editor-theme');
    return preference ? preference === 'dark' : document.documentElement.getAttribute('data-theme') === 'dark';
  };
  let dark = isDark();
  const reportCursor = view => {
    if (typeof options.onCursor !== 'function') return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    options.onCursor({ line: line.number, column: head - line.from + 1 });
  };
  const makeState = value => EditorState.create({
    doc: String(value ?? '').slice(0, MAX_CODE_LENGTH),
    extensions: [
      basicSetup, layout, syntax, theme.of(palette(dark)), language.of(languageExtension(currentLanguage)),
      EditorState.tabSize.of(4), indentUnit.of('    '),
      EditorState.transactionFilter.of(transaction => transaction.newDoc.length > MAX_CODE_LENGTH ? [] : transaction),
      EditorView.contentAttributes.of({
        'aria-label': '\u4ee3\u7801\u7f16\u8f91\u5668',
        'aria-description': '\u6309 Escape \u540e\u518d\u6309 Tab \u79bb\u5f00\u7f16\u8f91\u5668\u3002Ctrl \u6216 Command \u52a0 Enter \u8fd0\u884c\u4ee3\u7801\u3002',
        spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off'
      }),
      Prec.high(keymap.of([
        { key: 'Mod-Enter', stopPropagation: true, run: () => {
          if (typeof options.onRun === 'function') options.onRun();
          return true;
        } },
        indentWithTab
      ])),
      EditorView.updateListener.of(update => {
        if (update.docChanged && typeof options.onChange === 'function') options.onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) reportCursor(update.view);
      })
    ]
  });
  host.classList.add('learning-code-editor');
  const view = new EditorView({ state: makeState(options.value), parent: host });
  const observer = new scope.MutationObserver(() => {
    const next = isDark();
    if (next !== dark && !destroyed) {
      dark = next;
      view.dispatch({ effects: theme.reconfigure(palette(dark)) });
    }
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-editor-theme'] });
  if (editorThemeRoot !== document.documentElement) {
    observer.observe(editorThemeRoot, { attributes: true, attributeFilter: ['data-editor-theme'] });
  }
  reportCursor(view);

  return {
    getValue() { return view.state.doc.toString(); },
    setValue(value) {
      if (destroyed) return;
      const next = String(value ?? '').slice(0, MAX_CODE_LENGTH);
      if (next === view.state.doc.toString()) return;
      // A new document starts its own undo history and never emits onChange.
      view.setState(makeState(next));
      reportCursor(view);
    },
    setLanguage(id) {
      if (destroyed) return;
      const next = normalizeLanguage(id);
      if (next === currentLanguage) return;
      currentLanguage = next;
      view.setState(makeState(view.state.doc.toString()));
      reportCursor(view);
    },
    focus() { if (!destroyed) view.focus(); },
    jump(position = {}) {
      if (destroyed) return;
      const requestedLine = Number(position.line);
      const requestedColumn = Number(position.column);
      const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Number.isFinite(requestedLine) ? Math.trunc(requestedLine) : 1)));
      const offset = Math.max(0, Math.min(line.length, Number.isFinite(requestedColumn) ? Math.trunc(requestedColumn) - 1 : 0));
      const anchor = line.from + offset;
      view.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
      view.focus();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      view.destroy();
    }
  };
}

window.NOIMPTY_CODE_EDITOR = Object.freeze({ create });
