import { Streamdown, type Components } from 'streamdown';
import { code } from '@streamdown/code';
import { cjk } from '@streamdown/cjk';
import { createMathPlugin } from '@streamdown/math';

const plugins = { code, cjk, math: createMathPlugin({ singleDollarTextMath: true, errorColor: 'var(--muted)' }) };
const controls = { code: { copy: true, download: false }, table: false, image: false };
const translations = { copyCode: '复制代码', copied: '已复制', imageNotAvailable: '图片暂不可用' };
const components: Components = {
  strong: ({ children }) => <strong>{children}</strong>,
  table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="表格，可横向滚动"><table>{children}</table></div>,
  img: ({ node: _node, ...props }) => <img {...props} loading="lazy" />,
};

export function MarkdownContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  // Keep the parser mode stable on completion; stopped replies may still have
  // an unfinished fence or emphasis marker and must retain their formatting.
  return <Streamdown
    className="assistant-markdown"
    mode="streaming"
    parseIncompleteMarkdown
    isAnimating={streaming}
    plugins={plugins}
    components={components}
    controls={controls}
    translations={translations}
    linkSafety={{ enabled: false }}
    lineNumbers={false}
  >{content}</Streamdown>;
}
