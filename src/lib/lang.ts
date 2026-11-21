import type { Extension } from "@codemirror/state";
import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";

/** 扩展名 → 显示语言名 */
const EXT_LANG: Record<string, { name: string; ext: Extension | null }> = {
  js: { name: "JavaScript", ext: javascript() },
  mjs: { name: "JavaScript", ext: javascript() },
  cjs: { name: "JavaScript", ext: javascript() },
  jsx: { name: "JavaScript JSX", ext: javascript({ jsx: true }) },
  ts: { name: "TypeScript", ext: javascript({ typescript: true }) },
  tsx: { name: "TypeScript JSX", ext: javascript({ typescript: true, jsx: true }) },
  html: { name: "HTML", ext: html() },
  htm: { name: "HTML", ext: html() },
  vue: { name: "Vue", ext: html() },
  css: { name: "CSS", ext: css() },
  scss: { name: "SCSS", ext: css() },
  less: { name: "Less", ext: css() },
  json: { name: "JSON", ext: json() },
  jsonc: { name: "JSON", ext: json() },
  md: { name: "Markdown", ext: markdown() },
  markdown: { name: "Markdown", ext: markdown() },
  py: { name: "Python", ext: python() },
  pyw: { name: "Python", ext: python() },
  rs: { name: "Rust", ext: rust() },
  c: { name: "C", ext: cpp() },
  h: { name: "C Header", ext: cpp() },
  cpp: { name: "C++", ext: cpp() },
  cc: { name: "C++", ext: cpp() },
  cxx: { name: "C++", ext: cpp() },
  hpp: { name: "C++ Header", ext: cpp() },
  java: { name: "Java", ext: java() },
  go: { name: "Go", ext: go() },
  sql: { name: "SQL", ext: sql() },
  xml: { name: "XML", ext: xml() },
  svg: { name: "XML", ext: xml() },
  xaml: { name: "XML", ext: xml() },
  yml: { name: "YAML", ext: StreamLanguage.define(yaml) },
  yaml: { name: "YAML", ext: StreamLanguage.define(yaml) },
  sh: { name: "Shell", ext: StreamLanguage.define(shell) },
  bash: { name: "Shell", ext: StreamLanguage.define(shell) },
  zsh: { name: "Shell", ext: StreamLanguage.define(shell) },
  lua: { name: "Lua", ext: StreamLanguage.define(lua) },
  pas: { name: "Pascal", ext: StreamLanguage.define(pascal) },
  f90: { name: "Fortran", ext: StreamLanguage.define(fortran) },
  f: { name: "Fortran", ext: StreamLanguage.define(fortran) },
  pl: { name: "Perl", ext: StreamLanguage.define(perl) },
  rb: { name: "Ruby", ext: StreamLanguage.define(ruby) },
  txt: { name: "纯文本", ext: null },
  log: { name: "日志", ext: null },
};

/** 从路径解析语言；未识别返回纯文本 */
export function detectLanguage(path: string | null): { name: string; ext: Extension | null } {
  if (!path) return { name: "纯文本", ext: null };
  const file = path.split(/[\\/]/).pop() ?? "";
  const dot = file.lastIndexOf(".");
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  return EXT_LANG[ext] ?? { name: "纯文本", ext: null };
}

/** 文件扩展名 → 行注释前缀 / 块注释起止（用于「插入注释」命令） */
export interface CommentTokens {
  line: string;
  /** HTML/Markdown 这类行注释也是成对出现的，需要补尾部闭合符 */
  lineEnd?: string;
  blockStart: string;
  blockEnd: string;
}

export function commentTokens(path: string | null): CommentTokens {
  if (!path) return { line: "# ", blockStart: "/* ", blockEnd: " */" };
  const file = path.split(/[\\/]/).pop() ?? "";
  const dot = file.lastIndexOf(".");
  const ext = dot > 0 ? file.slice(dot + 1).toLowerCase() : "";
  // HTML / XML / Vue / SVG：HTML 注释
  if (["html", "htm", "vue", "xml", "svg", "xaml"].includes(ext)) {
    return { line: "<!-- ", lineEnd: " -->", blockStart: "<!-- ", blockEnd: " -->" };
  }
  // CSS / SCSS / Less：块注释为主
  if (["css", "scss", "less"].includes(ext)) {
    return { line: "// ", blockStart: "/* ", blockEnd: " */" };
  }
  // Python / Shell / YAML / Ruby / Perl / Lua / Fortran：# 行注释
  if (["py", "pyw", "sh", "bash", "zsh", "yml", "yaml", "rb", "pl"].includes(ext)) {
    return { line: "# ", blockStart: '"""', blockEnd: '"""' };
  }
  if (["lua"].includes(ext)) return { line: "-- ", blockStart: "--[[ ", blockEnd: " ]]" };
  if (["sql"].includes(ext)) return { line: "-- ", blockStart: "/* ", blockEnd: " */" };
  if (["pas"].includes(ext)) return { line: "// ", blockStart: "{ ", blockEnd: " }" };
  // Markdown / 纯文本 / 日志
  if (["md", "markdown", "txt", "log"].includes(ext)) {
    return { line: "<!-- ", lineEnd: " -->", blockStart: "<!-- ", blockEnd: " -->" };
  }
  // 其余 C 系 / Java / Go / Rust / JS / TS：// 行注释
  return { line: "// ", blockStart: "/* ", blockEnd: " */" };
}

export { EXT_LANG };
