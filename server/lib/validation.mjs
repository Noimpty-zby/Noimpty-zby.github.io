import { invariant } from './errors.mjs';
export const languages = ['c', 'cpp', 'go', 'python', 'git', 'linux', 'mysql'];
// Languages whose code runs once per test case in a fresh container.
export const caseLanguages = ['c', 'cpp', 'go', 'python'];
export function validateRun(body) {
  invariant(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_REQUEST', '请求必须是对象。');
  invariant(languages.includes(body.language), 400, 'INVALID_LANGUAGE', '不支持此语言。');
  invariant(typeof body.code === 'string' && body.code.trim() && Buffer.byteLength(body.code) <= 65536 && !body.code.includes('\0'), 400, 'INVALID_CODE', '代码不能为空且不能超过 64 KiB。');
  invariant(body.stdin === undefined || (typeof body.stdin === 'string' && Buffer.byteLength(body.stdin) <= 65536), 400, 'INVALID_INPUT', '标准输入不能超过 64 KiB。');
  invariant(body.mode === undefined || ['run', 'check'].includes(body.mode), 400, 'INVALID_MODE', '执行模式无效。');
  invariant(body.revision === undefined || (Number.isSafeInteger(body.revision) && body.revision >= 0), 400, 'INVALID_REVISION', '代码版本无效。');
  invariant(body.saveHistory === undefined || typeof body.saveHistory === 'boolean', 400, 'INVALID_HISTORY_OPTION', '保存历史选项无效。');
  if (body.workspaceId !== undefined) {
    invariant(['git', 'linux', 'mysql'].includes(body.language), 400, 'INVALID_WORKSPACE', '此语言不支持工作区。');
    invariant(/^[a-f0-9-]{36}$/.test(body.workspaceId), 400, 'INVALID_WORKSPACE', '工作区编号无效。');
    invariant(Number.isSafeInteger(body.workspaceRevision) && body.workspaceRevision >= 0, 400, 'INVALID_WORKSPACE_REVISION', '恢复工作区必须提供 workspaceRevision。');
  }
  const tests = body.tests ?? [];
  invariant(Array.isArray(tests) && tests.length <= 10, 400, 'INVALID_TESTS', '最多支持 10 个测试用例。');
  invariant(!tests.length || caseLanguages.includes(body.language), 400, 'INVALID_TESTS', '命令及 SQL 不支持算法测试用例。');
  invariant(Buffer.byteLength(JSON.stringify(tests)) <= 256 * 1024, 413, 'TESTS_TOO_LARGE', '所有测试用例合计不能超过 256 KiB。');
  for (const test of tests) {
    invariant(test && typeof test.input === 'string' && Buffer.byteLength(test.input) <= 65536, 400, 'INVALID_TEST', '测试输入无效或过大。');
    invariant(test.expectedOutput === undefined || (typeof test.expectedOutput === 'string' && Buffer.byteLength(test.expectedOutput) <= 65536), 400, 'INVALID_TEST', '预期输出无效或过大。');
  }
  if (body.practice !== undefined) {
    const practice = body.practice;
    invariant(practice && typeof practice === 'object' && !Array.isArray(practice), 400, 'INVALID_PRACTICE', '练习信息必须是对象。');
    for (const [key, limit] of Object.entries({ id: 128, title: 500, statement: 20000, starterCode: 65536, referenceCode: 65536 })) {
      invariant(practice[key] === undefined || (typeof practice[key] === 'string' && Buffer.byteLength(practice[key]) <= limit), 400, 'INVALID_PRACTICE', '练习信息字段过长或格式无效。');
    }
    invariant(practice.language === undefined || practice.language === body.language, 400, 'INVALID_PRACTICE', '练习语言与执行语言不匹配。');
    if (practice.tests !== undefined) {
      invariant(Array.isArray(practice.tests) && practice.tests.length <= 10, 400, 'INVALID_PRACTICE', '练习测试用例无效。');
      for (const item of practice.tests) invariant(item && typeof item.input === 'string' && typeof item.expectedOutput === 'string' && Buffer.byteLength(item.input) <= 65536 && Buffer.byteLength(item.expectedOutput) <= 65536, 400, 'INVALID_PRACTICE', '参考用例必须包含输入与预期输出。');
    }
    if (practice.verification !== undefined) invariant(practice.verification && typeof practice.verification === 'object' && !Array.isArray(practice.verification) && Buffer.byteLength(JSON.stringify(practice.verification)) <= 2048, 400, 'INVALID_PRACTICE', '验证来源格式无效。');
    invariant(Buffer.byteLength(JSON.stringify(practice)) <= 300000, 413, 'PRACTICE_TOO_LARGE', '练习信息过大。');
    // This is context supplied by the client, not a server certification.
    body.practice = Object.fromEntries(['id', 'language', 'title', 'statement', 'starterCode', 'referenceCode', 'tests', 'verification'].filter(key => practice[key] !== undefined).map(key => [key, practice[key]]));
  }
  return { ...body, stdin: body.stdin ?? '', tests, mode: body.mode ?? 'run', revision: body.revision ?? 0 };
}
export function diagnostics(stderr) {
  return stderr.split('\n').slice(0, 200).flatMap(line => {
    const match = line.match(/(?:main\.(?:c|cpp|go|py)|main\.sh):(?:(\d+):(?:(\d+):)?| line (\d+):)\s*(.*)/);
    if (!match) return [];
    // gcc's "note:" lines explain the error above them; marking them as errors doubles the red.
    const severity = /^warning:/.test(match[4]) ? 'warning' : /^note:/.test(match[4]) ? 'info' : 'error';
    return [{ severity, line: Number(match[1] || match[3]), ...(match[2] ? { column: Number(match[2]) } : {}), message: match[4].slice(0, 2000) }];
  });
}
// A Python traceback names the failing line as `File "/input/main.py", line N`; the innermost
// such frame plus the final exception line become one diagnostic.
export function pythonTraceback(stderr) {
  const frames = [...stderr.matchAll(/File "\/input\/main\.py", line (\d+)/g)];
  if (!frames.length) return [];
  const message = stderr.trimEnd().split('\n').at(-1).trim();
  return [{ severity: 'error', line: Number(frames.at(-1)[1]), message: message.slice(0, 2000) }];
}
export function normalizeOutput(output) { return output.replace(/\r\n/g, '\n').trimEnd(); }
