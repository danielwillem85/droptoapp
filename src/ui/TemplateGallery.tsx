import { useEffect, useRef } from 'react';
import { TEMPLATES } from '../model/gallery';
import type { AppTemplate } from '../model/gallery';

/** "Templates…": complete starter apps. Picking one replaces the design (Undo brings the old one back). */
export function TemplateGallery({ onPick, onClose }: { onPick: (t: AppTemplate) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal gallery" role="dialog" aria-modal="true" aria-labelledby="gallery-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h2 id="gallery-title">Start from a template</h2>
            <p>Complete Shiny apps to change visually or in code. Opening one replaces your current design; Undo brings it back.</p>
          </div>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="gallery-grid">
          {TEMPLATES.map((t) => (
            <article key={t.slug} className="gallery-card">
              <button className="gallery-thumb" onClick={() => onPick(t)} title={`Use the ${t.title} template`}>
                <img src={`/static/templates/${t.slug}.webp`} alt="" width={1200} height={750} loading="lazy" />
              </button>
              <div className="gallery-body">
                <h3>{t.title}</h3>
                <p>{t.summary}</p>
                <div className="gallery-tags">
                  {t.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <div className="gallery-actions">
                  <button className="primary" onClick={() => onPick(t)}>
                    Use template
                  </button>
                  <a href={`/templates/${t.slug}`} target="_blank" rel="noopener">
                    About this template ↗
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
