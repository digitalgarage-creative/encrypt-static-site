import { parse } from 'parse5';

export const ROBOTS_CONTENT = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
export const ROBOTS_META = `<meta name="robots" content="${ROBOTS_CONTENT}">`;

// Use parser locations to insert into the actual head, preserving all existing
// source bytes (including scripts, comments, template markup and whitespace).
export function protectHtml(source) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const html = document.childNodes.find(n => n.tagName === 'html');
  const head = html.childNodes.find(n => n.tagName === 'head');
  if (head.childNodes.some(n => n.tagName === 'meta' &&
    n.attrs.some(a => a.name === 'name' && a.value.toLowerCase() === 'robots') &&
    n.attrs.some(a => a.name === 'content' && a.value.toLowerCase() === ROBOTS_CONTENT))) return source;
  if (head.sourceCodeLocation?.startTag) {
    const offset = head.sourceCodeLocation.startTag.endOffset;
    return source.slice(0, offset) + '\n' + ROBOTS_META + '\n' + source.slice(offset);
  }
  // An omitted head start tag may still have real children or a closing tag.
  const firstHeadChild = head.childNodes.find(n => n.sourceCodeLocation);
  const offset = firstHeadChild?.sourceCodeLocation.startOffset ??
    head.sourceCodeLocation?.endTag?.startOffset ??
    html.sourceCodeLocation?.startTag?.endOffset ??
    document.childNodes.find(n => n.nodeName === '#documentType')?.sourceCodeLocation?.endOffset ?? 0;
  return source.slice(0, offset) + '\n' + ROBOTS_META + '\n' + source.slice(offset);
}
