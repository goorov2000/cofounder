import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReactNode } from 'react';

function MarkdownTable({ children }: { children?: ReactNode }) {
  return <div className="markdown-table" role="region" aria-label="Таблица в сообщении" tabIndex={0}><table>{children}</table></div>;
}

/** No raw HTML, remote images or executable URL schemes from model/user content. */
export function Markdown({ children, allowLinks = true }: { children: string; allowLinks?: boolean }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}
    urlTransform={(url) => /^(https?:\/\/|mailto:|#)/i.test(url) ? url : ''}
    components={{
      a: ({ children: label, href }) => allowLinks && href ? <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{label}</a> : <span>{label}</span>,
      table: MarkdownTable,
    }}>{children}</ReactMarkdown></div>;
}
