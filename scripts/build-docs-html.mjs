/**
 * Sinh lại các trang HTML "tham khảo" trong `docs/html/` từ file Markdown gốc.
 *
 * VÌ SAO CÓ FILE NÀY: bộ HTML lần đầu được convert tay. Đến Phase 3 thì cả 5 trang tham khảo
 * đều lệch so với `.md` nguồn (glossary còn ghi số phase cũ, architecture chưa có module
 * `order`, tech-playbook chưa có bảng benchmark) — vì không ai sinh lại. Sửa tay lần nữa thì
 * lần sau lại lệch. Script này biến việc đó thành một lệnh: `npm run docs:html`.
 *
 * KHÔNG sinh: `index.html` và `phase-*.html` — đó là trang VIẾT TAY (business / technical /
 * Q&A), không phải bản convert của file nào. Sinh lại sẽ xoá mất nội dung đó.
 *
 * Không dùng thư viện ngoài (luật CLAUDE.md: không thêm dependency). Bộ Markdown cần xử lý là
 * tập con đã biết trước: heading, list (kể cả checkbox), table, code fence, inline code,
 * bold/italic (kể cả bold LỒNG italic — chỗ bản convert tay từng làm sai), blockquote, hr,
 * link nội bộ.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT_DIR = `${ROOT}docs/html/`;

/** Trang tham khảo + ADR: sinh từ Markdown. */
const PAGES = [
  { src: 'docs/architecture.md', out: 'architecture.html', title: 'Bản đồ code — cái gì nằm ở đâu' },
  { src: 'docs/tech-playbook.md', out: 'tech-playbook.html', title: 'Sổ tay kỹ thuật' },
  { src: 'docs/glossary.md', out: 'glossary.html', title: 'Từ điển nhận diện' },
  { src: 'project-context.md', out: 'project-context.html', title: 'Bối cảnh & quyết định' },
  { src: 'CLAUDE.md', out: 'claude-md.html', title: 'Hướng dẫn AI trong repo này' },
  { src: 'docs/adr/001-modular-monolith.md', out: 'adr-001-modular-monolith.html', title: 'ADR-001: Modular Monolith' },
  { src: 'docs/adr/002-nen-mong-ky-thuat-phase-0.md', out: 'adr-002-nen-mong-ky-thuat-phase-0.html', title: 'ADR-002: Nền móng kỹ thuật Phase 0' },
  { src: 'docs/adr/003-so-huu-logic-tru-ton-kho.md', out: 'adr-003-so-huu-logic-tru-ton-kho.html', title: 'ADR-003: Ai sở hữu logic trừ tồn kho' },
];

const NAV = [
  ['Phase', [
    ['phase-0.html', 'Phase 0 — Nền móng'],
    ['phase-1.html', 'Phase 1 — Auth'],
    ['phase-2.html', 'Phase 2 — Product'],
    ['phase-3.html', 'Phase 3 — Order ⭐'],
  ]],
  ['ADR', [
    ['adr-001-modular-monolith.html', 'ADR-001: Modular Monolith'],
    ['adr-002-nen-mong-ky-thuat-phase-0.html', 'ADR-002: Nền móng kỹ thuật'],
    ['adr-003-so-huu-logic-tru-ton-kho.html', 'ADR-003: Ai sở hữu tồn kho'],
  ]],
  ['Tham khảo', [
    ['architecture.html', 'Bản đồ code (architecture.md)'],
    ['tech-playbook.html', 'Sổ tay kỹ thuật (tech-playbook.md)'],
    ['glossary.html', 'Từ điển (glossary.md)'],
    ['project-context.html', 'Bối cảnh &amp; quyết định (project-context.md)'],
    ['claude-md.html', 'Hướng dẫn AI (CLAUDE.md)'],
  ]],
];

/** Link `.md` → trang HTML tương ứng. Cái nào không có ở đây thì BỎ link, giữ chữ. */
const LINK_MAP = new Map([
  ['architecture.md', 'architecture.html'],
  ['tech-playbook.md', 'tech-playbook.html'],
  ['glossary.md', 'glossary.html'],
  ['project-context.md', 'project-context.html'],
  ['claude.md', 'claude-md.html'],
  ['001-modular-monolith.md', 'adr-001-modular-monolith.html'],
  ['002-nen-mong-ky-thuat-phase-0.md', 'adr-002-nen-mong-ky-thuat-phase-0.html'],
  ['003-so-huu-logic-tru-ton-kho.md', 'adr-003-so-huu-logic-tru-ton-kho.html'],
]);

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Slug kiểu GitHub: giữ dấu tiếng Việt, hạ chữ, khoảng trắng thành gạch ngang. */
const slugify = (text) =>
  text
    .replace(/`|\*\*|\*|~~/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');

/**
 * Chuyển phần inline. Thứ tự QUAN TRỌNG:
 * 1. Rút code span và link ra "chỗ đậu" (slot) trước — bên trong chúng không được xử lý tiếp.
 * 2. Escape HTML.
 * 3. Bold TRƯỚC italic, cả hai dùng non-greedy — nhờ vậy `**a *b* c**` và nhiều cặp `**` trên
 *    cùng một dòng đều đúng. Bản convert tay trước đây sai đúng chỗ này (để lọt dấu `**` ra
 *    ngoài và đặt thẻ `<strong>` lệch vị trí).
 */
function inline(text) {
  const slots = [];
  const park = (html) => {
    slots.push(html);
    return `@@SLOT${slots.length - 1}@@`;
  };

  let out = text.replace(/`([^`]+)`/g, (_, code) => park(`<code>${escapeHtml(code)}</code>`));

  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const [path, anchor] = href.split('#');
    const key = (path.split('/').pop() || '').toLowerCase();
    const mapped = LINK_MAP.get(key);
    const text = escapeHtml(label.replace(/`/g, ''));
    if (mapped) return park(`<a href="${anchor ? `${mapped}#${anchor}` : mapped}">${text}</a>`);
    if (href.startsWith('http')) return park(`<a href="${href}">${text}</a>`);
    // Ngoài phạm vi bộ HTML: bỏ link, giữ chữ — thà không có link hơn là link vỡ.
    const note = key.endsWith('.md') ? ' <span class="unavail">(chưa có bản HTML)</span>' : '';
    return park(`<code>${text}</code>${note}`);
  });

  out = escapeHtml(out)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');

  return out.replace(/@@SLOT(\d+)@@/g, (_, index) => slots[Number(index)]);
}

const stripTask = (text) => text.replace(/^\[ \]\s+/, '☐ ').replace(/^\[[xX]\]\s+/, '☑ ');

/** Markdown → HTML, xử lý theo BLOCK. */
function toHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let i = 0;

  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  const cells = (line) =>
    line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const startsBlock = (line) =>
    /^\s*$/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^\s*```/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*]|\d+\.)\s/.test(line) ||
    /^\s*---+\s*$/.test(line) ||
    isTableRow(line);

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const lang = line.trim().slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(
        `<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      out.push(`<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      const thead = head.map((cell) => `<th>${inline(cell)}</th>`).join('');
      const tbody = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        .join('');
      out.push(
        `<div class="table-wrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`,
      );
      continue;
    }

    // Blockquote: gom liên tiếp rồi convert đệ quy phần bên trong (nó có thể chứa list/table).
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote class="note">${toHtml(body.join('\n'))}</blockquote>`);
      continue;
    }

    // List: dòng tiếp theo thụt lề mà không phải item mới là phần NỐI của item trước.
    if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length) {
        const item = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (item) {
          items.push(item[2]);
          i++;
          continue;
        }
        if (items.length > 0 && /^\s+\S/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
          continue;
        }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((text) => `<li>${inline(stripTask(text))}</li>`).join('')}</${tag}>`);
      continue;
    }

    const para = [];
    while (i < lines.length && !startsBlock(lines[i])) para.push(lines[i++].trim());
    if (para.length > 0) out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return out.join('\n');
}

function sidebar(current) {
  const parts = ['<a class="brand" href="index.html">Flash-Core<span>Tài liệu dự án</span></a>'];
  for (const [group, links] of NAV) {
    parts.push(`<div class="nav-group"><h3>${group}</h3>`);
    for (const [href, label] of links) {
      parts.push(`<a href="${href}"${href === current ? ' class="active"' : ''}>${label}</a>`);
    }
    parts.push('</div>');
  }
  return parts.join('');
}

const shell = (title, current, content) => `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div class="layout">
<nav class="sidebar">
${sidebar(current)}
</nav>
<main class="content">
${content}
</main>
</div>
</body>
</html>
`;

for (const page of PAGES) {
  const markdown = readFileSync(`${ROOT}${page.src}`, 'utf8');
  writeFileSync(`${OUT_DIR}${page.out}`, shell(page.title, page.out, toHtml(markdown)), 'utf8');
  console.log(`${page.src}  →  docs/html/${page.out}`);
}
console.log(`\nSinh lại ${PAGES.length} trang. index.html và phase-*.html viết tay, không sinh.`);
