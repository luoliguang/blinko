import { Image } from '@heroui/react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { Icon } from '@/components/Common/Iconify/icons';

type Align = 'left' | 'center' | 'right';

interface ImageWrapperProps {
  src?: string;
  width?: number | string;
  height?: number | string;
  alt?: string;
  // Passed through from MarkdownRender so an editable note can realign the image.
  node?: any;
  content?: string;
  onChange?: (newContent: string) => void;
  editable?: boolean;
}

const getAlign = (node?: any): Align | undefined => {
  const raw = node?.properties?.dataAlign ?? node?.properties?.['data-align'];
  return raw === 'left' || raw === 'right' || raw === 'center' ? raw : undefined;
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Rewrite this image's markdown/html in the note source to carry the chosen
// alignment, then hand the new content back for saving. Matches either the
// original markdown form (![alt](src)) or a previously aligned <img> tag.
const buildImgTag = (src: string, alt: string, align: Align): string =>
  `<img src="${src}" alt="${alt}" data-align="${align}" />`;

export const ImageWrapper = ({ src = '', width, height, alt = '', node, content, onChange, editable }: ImageWrapperProps) => {
  if (!src) return null;

  const align = getAlign(node);
  const showToolbar = Boolean(editable && onChange && typeof content === 'string');

  const setAlign = (next: Align) => {
    if (!onChange || typeof content !== 'string') return;
    if (next === align) return;
    const srcE = escapeRegExp(src);
    const htmlRe = new RegExp(`<img[^>]*src=["']${srcE}["'][^>]*>`, 'i');
    const mdRe = new RegExp(`!\\[[^\\]]*\\]\\(${srcE}[^)]*\\)`);
    const replacement = buildImgTag(src, alt, next);
    let newContent: string;
    if (htmlRe.test(content)) {
      newContent = content.replace(htmlRe, replacement);
    } else if (mdRe.test(content)) {
      newContent = content.replace(mdRe, replacement);
    } else {
      return;
    }
    onChange(newContent);
  };

  // Keep the original (unaligned, non-editable) render byte-for-byte so existing
  // notes are untouched; only aligned or editable images use the richer layout.
  if (!align && !showToolbar) {
    return (
      <div className='markdown-image-wrapper w-full'>
        <PhotoProvider>
          <PhotoView src={src}>
            <Image src={src} width={width} height={height} alt={alt}
              classNames={{ wrapper: '!max-w-fit !m-auto' }}
              className='w-full max-h-[200px] object-cover' />
          </PhotoView>
        </PhotoProvider>
      </div>
    );
  }

  const justify = align === 'left' ? 'justify-start' : align === 'right' ? 'justify-end' : 'justify-center';
  // Left/right only read as "aligned" when the image is narrower than the text
  // column, so cap their width; center keeps the full-width look.
  const imgClass = align === 'left' || align === 'right'
    ? 'max-w-[60%] max-h-[300px] object-contain rounded-md'
    : 'w-full max-h-[200px] object-cover';

  const toolbarBtn = (value: Align, icon: string) => (
    <button
      type='button'
      onClick={(e) => { e.stopPropagation(); setAlign(value); }}
      className={`p-1 rounded hover:bg-hover transition-colors ${align === value ? 'text-primary' : 'text-desc'}`}
    >
      <Icon icon={icon} width='16' height='16' />
    </button>
  );

  return (
    <div className={`markdown-image-wrapper group relative w-full flex ${justify}`}>
      {showToolbar && (
        <div
          className='absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded-md bg-background/90 backdrop-blur border border-hover p-0.5 opacity-0 group-hover:opacity-100 transition-opacity'
          onClick={(e) => e.stopPropagation()}
        >
          {toolbarBtn('left', 'tabler:align-left')}
          {toolbarBtn('center', 'tabler:align-center')}
          {toolbarBtn('right', 'tabler:align-right')}
        </div>
      )}
      <PhotoProvider>
        <PhotoView src={src}>
          <Image src={src} width={width} height={height} alt={alt}
            classNames={{ wrapper: '!max-w-fit' }}
            className={imgClass} />
        </PhotoView>
      </PhotoProvider>
    </div>
  );
};
