import { Prisma } from '@prisma/client';

// Single definition of "a note anyone may read on the public plaza", shared by
// the list, by-id, stats and share-preview paths so they never disagree.
export const publicNoteWhere = (): Prisma.notesWhereInput => ({
  isShare: true,
  isRecycle: false,
  sharePassword: '',
  OR: [{ shareExpiryDate: { gt: new Date() } }, { shareExpiryDate: null }],
});

export const publicNoteInclude = {
  tags: { include: { tag: true } },
  account: { select: { image: true, nickname: true, name: true, id: true } },
  attachments: true,
  _count: { select: { comments: true } },
} satisfies Prisma.notesInclude;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Plain-text title (first non-empty line) and summary of a markdown note.
export function noteTitleAndSummary(content: string) {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)#[^\s#]+/g, ' ')
    .replace(/[#>*_`~|-]+/g, ' ');
  const lines = plain.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const title = (lines[0] ?? '').slice(0, 60);
  const summary = lines.slice(1).join(' ').slice(0, 120);
  return { title, summary };
}

// Rewrite <title> and description/og meta in the SPA shell so link previews
// (WeChat, Telegram, …; crawlers that don't run JS) show the shared note.
export function injectNoteMeta(html: string, title: string, description: string) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const og =
    `<meta property="og:title" content="${t}" />` +
    `<meta property="og:description" content="${d}" />` +
    `<meta property="og:type" content="article" />`;
  // Function replacers so "$&"-style sequences in note text aren't expanded.
  return html
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${t}</title>`)
    .replace(/<meta name="description"[^>]*>/, () => `<meta name="description" content="${d}" />`)
    .replace('</head>', () => `${og}</head>`);
}
