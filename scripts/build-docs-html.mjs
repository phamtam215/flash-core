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
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT_DIR = `${ROOT}docs/html/`;

/** Trang tham khảo + ADR: sinh từ Markdown. */
const PAGES = [
  { src: 'docs/onboarding.md', out: 'onboarding.html', title: 'Lộ trình cho người mới — 6 buổi có thực hành' },
  { src: 'docs/demo-phong-van.md', out: 'demo-phong-van.html', title: 'Demo & thuyết trình khi phỏng vấn' },
  { src: 'docs/README.md', out: 'docs-map.html', title: 'Bản đồ tài liệu — thông tin nào ở file nào' },
  { src: 'docs/SPEC.md', out: 'spec.html', title: 'Spec gốc — lộ trình 8 phase' },
  { src: 'docs/architecture.md', out: 'architecture.html', title: 'Bản đồ code — cái gì nằm ở đâu' },
  { src: 'docs/tech-playbook.md', out: 'tech-playbook.html', title: 'Sổ tay kỹ thuật' },
  { src: 'docs/glossary.md', out: 'glossary.html', title: 'Từ điển nhận diện' },
  { src: 'project-context.md', out: 'project-context.html', title: 'Bối cảnh & quyết định' },
  { src: 'CLAUDE.md', out: 'claude-md.html', title: 'Hướng dẫn AI trong repo này' },
  { src: 'docs/adr/001-modular-monolith.md', out: 'adr-001-modular-monolith.html', title: 'ADR-001: Modular Monolith' },
  { src: 'docs/adr/002-nen-mong-ky-thuat-phase-0.md', out: 'adr-002-nen-mong-ky-thuat-phase-0.html', title: 'ADR-002: Nền móng kỹ thuật Phase 0' },
  { src: 'docs/adr/003-so-huu-logic-tru-ton-kho.md', out: 'adr-003-so-huu-logic-tru-ton-kho.html', title: 'ADR-003: Ai sở hữu logic trừ tồn kho' },
  { src: 'docs/adr/004-ghi-dau-truoc-khi-gui-mail.md', out: 'adr-004-ghi-dau-truoc-khi-gui-mail.html', title: 'ADR-004: Ghi dấu trước khi gửi mail' },
  { src: 'docs/adr/005-worker-chay-process-rieng.md', out: 'adr-005-worker-chay-process-rieng.html', title: 'ADR-005: Worker chạy process riêng' },
  { src: 'docs/adr/006-relay-giu-transaction-khi-day-queue.md', out: 'adr-006-relay-giu-transaction-khi-day-queue.html', title: 'ADR-006: Relay giữ transaction khi đẩy queue' },
  { src: 'docs/adr/007-ui-la-trang-tinh-mot-file.md', out: 'adr-007-ui-la-trang-tinh-mot-file.html', title: 'ADR-007: UI là trang tĩnh một file' },
];

const NAV = [
  ['Phase', [
    ['phase-0.html', 'Phase 0 — Nền móng'],
    ['phase-1.html', 'Phase 1 — Auth'],
    ['phase-2.html', 'Phase 2 — Product'],
    ['phase-3.html', 'Phase 3 — Order ⭐'],
    ['phase-4.html', 'Phase 4 — Async &amp; Payment'],
    ['phase-5.html', 'Phase 5 — UI demo'],
  ]],
  ['ADR', [
    ['adr-001-modular-monolith.html', 'ADR-001: Modular Monolith'],
    ['adr-002-nen-mong-ky-thuat-phase-0.html', 'ADR-002: Nền móng kỹ thuật'],
    ['adr-003-so-huu-logic-tru-ton-kho.html', 'ADR-003: Ai sở hữu tồn kho'],
    ['adr-004-ghi-dau-truoc-khi-gui-mail.html', 'ADR-004: Ghi dấu trước khi gửi mail'],
    ['adr-005-worker-chay-process-rieng.html', 'ADR-005: Worker process riêng'],
    ['adr-006-relay-giu-transaction-khi-day-queue.html', 'ADR-006: Relay giữ transaction'],
    ['adr-007-ui-la-trang-tinh-mot-file.html', 'ADR-007: UI là trang tĩnh'],
  ]],
  ['Tham khảo', [
    ['onboarding.html', '★ Lộ trình người mới (onboarding.md)'],
    ['demo-phong-van.html', '★ Demo &amp; phỏng vấn (demo-phong-van.md)'],
    ['docs-map.html', 'Bản đồ tài liệu (docs/README.md)'],
    ['spec.html', 'Spec gốc — 8 phase (SPEC.md)'],
    ['architecture.html', 'Bản đồ code (architecture.md)'],
    ['tech-playbook.html', 'Sổ tay kỹ thuật (tech-playbook.md)'],
    ['glossary.html', 'Từ điển (glossary.md)'],
    ['project-context.html', 'Bối cảnh &amp; quyết định (project-context.md)'],
    ['claude-md.html', 'Hướng dẫn AI (CLAUDE.md)'],
  ]],
];

/** Link `.md` → trang HTML tương ứng. Cái nào không có ở đây thì BỎ link, giữ chữ. */
const LINK_MAP = new Map([
  ['onboarding.md', 'onboarding.html'],
  ['demo-phong-van.md', 'demo-phong-van.html'],
  ['readme.md', 'docs-map.html'],
  ['spec.md', 'spec.html'],
  ['architecture.md', 'architecture.html'],
  ['tech-playbook.md', 'tech-playbook.html'],
  ['glossary.md', 'glossary.html'],
  ['project-context.md', 'project-context.html'],
  ['claude.md', 'claude-md.html'],
  ['001-modular-monolith.md', 'adr-001-modular-monolith.html'],
  ['002-nen-mong-ky-thuat-phase-0.md', 'adr-002-nen-mong-ky-thuat-phase-0.html'],
  ['003-so-huu-logic-tru-ton-kho.md', 'adr-003-so-huu-logic-tru-ton-kho.html'],
  ['007-ui-la-trang-tinh-mot-file.md', 'adr-007-ui-la-trang-tinh-mot-file.html'],
  ['006-relay-giu-transaction-khi-day-queue.md', 'adr-006-relay-giu-transaction-khi-day-queue.html'],
  ['005-worker-chay-process-rieng.md', 'adr-005-worker-chay-process-rieng.html'],
  ['004-ghi-dau-truoc-khi-gui-mail.md', 'adr-004-ghi-dau-truoc-khi-gui-mail.html'],
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

/**
 * Cắt đúng một mục của file Markdown: từ dòng heading khớp `heading` cho tới heading kế tiếp
 * có cấp BẰNG HOẶC CAO HƠN. Dùng để các trang phase (viết tay) **nhúng** kiến thức từ
 * `tech-playbook.md` thay vì chép lại — nguồn kiến thức vẫn chỉ có một.
 */
function section(srcFile, heading) {
  const lines = readFileSync(`${ROOT}${srcFile}`, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) throw new Error(`Không tìm thấy mục "${heading}" trong ${srcFile}`);
  const level = /^#+/.exec(heading)[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const next = /^(#+)\s/.exec(lines[end]);
    if (next && next[1].length <= level) break;
    end += 1;
  }
  return lines.slice(start + 1, end).join('\n').trim().replace(/\n?-{3,}$/, '').trim();
}

/**
 * Trang phase là bản đọc có dẫn dắt, viết tay — nhưng những đoạn đã có chủ ở Markdown thì
 * được NHÚNG vào giữa hai mốc, không chép:
 *
 *   <!--@@from docs/tech-playbook.md ### Tiêu đề-->  …nội dung sinh ra…  <!--@@end-->
 */
const MARKER = /<!--@@from (\S+) (#{1,6} [^>]*?)-->[\s\S]*?<!--@@end-->/g;
let embedded = 0;
for (const file of readdirSync(OUT_DIR).filter((name) => /^(phase-\d+|index)\.html$/.test(name))) {
  const before = readFileSync(`${OUT_DIR}${file}`, 'utf8');
  const after = before
    .replace(MARKER, (_, src, heading) => {
      embedded += 1;
      return `<!--@@from ${src} ${heading}-->\n${toHtml(section(src, heading.trim()))}\n<!--@@end-->`;
    })
    // Sidebar cũng chỉ có một nguồn (hằng NAV ở trên), trang phase không giữ bản chép riêng.
    .replace(/<!--@@nav-->[\s\S]*?<!--@@end-->/, `<!--@@nav-->\n${sidebar(file)}\n<!--@@end-->`);
  if (after !== before) {
    writeFileSync(`${OUT_DIR}${file}`, after, 'utf8');
    console.log(`${file}  ←  nhúng lại từ Markdown`);
  }
}
console.log(`\nSinh lại ${PAGES.length} trang + nhúng ${embedded} mục vào trang phase.`);
console.log('Phần dẫn dắt của index.html và phase-*.html viết tay; sidebar + mục kiến thức thì nhúng.');
