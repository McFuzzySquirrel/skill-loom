import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';
import { HelpPopover } from '../components/HelpPopover';
import { HELP_ARTICLES } from '../help/guide';

const ARTICLE_LINKS: Readonly<Record<string, string>> = {
  'user-guide.md': 'user-guide',
  'admin-guide.md': 'administrator-guide',
  'OPERATIONS.md': 'operations-guide',
  'SUPPORT.md': 'support',
  'scenario-chains.md': 'scenario-chains',
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function localHelpHref(href: string, articleId: string): string {
  if (href.startsWith('#')) {
    return `#${articleId}-${slug(decodeURIComponent(href.slice(1)))}`;
  }

  let url: URL;
  try {
    url = new URL(href);
  } catch {
    const [path = '', anchor] = href.split('#', 2);
    const file = path.split('/').at(-1) ?? '';
    const targetArticle = ARTICLE_LINKS[file];
    if (targetArticle === undefined) {
      return `https://github.com/McFuzzySquirrel/skill-loom/blob/main/${path}`;
    }
    return anchor === undefined
      ? `#article-${targetArticle}`
      : `#${targetArticle}-${slug(decodeURIComponent(anchor))}`;
  }

  return url.protocol === 'https:' || url.protocol === 'mailto:' ? href : '#user-guide';
}

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    if (href === undefined) {
      return <span>{children}</span>;
    }
    const local = href.startsWith('#') || !/^[a-z][a-z\d+.-]*:/i.test(href);
    const target = local ? undefined : '_blank';
    return (
      <a
        {...props}
        href={local ? localHelpHref(href, 'user-guide') : href}
        target={target}
        rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    );
  },
  img({ alt }) {
    return <span className="help-article__image-note">{alt || 'Image'} (not available offline)</span>;
  },
  h1({ children, ...props }) {
    return <h2 {...props}>{children}</h2>;
  },
  h2({ children, ...props }) {
    return <h3 {...props}>{children}</h3>;
  },
  h3({ children, ...props }) {
    return <h4 {...props}>{children}</h4>;
  },
  h4({ children, ...props }) {
    return <h5 {...props}>{children}</h5>;
  },
  h5({ children, ...props }) {
    return <h6 {...props}>{children}</h6>;
  },
};

function articleComponents(articleId: string): Components {
  return {
    ...markdownComponents,
    a({ href, children, ...props }) {
      if (href === undefined) return <span>{children}</span>;
      const local = href.startsWith('#') || !/^[a-z][a-z\d+.-]*:/i.test(href);
      const target = local ? undefined : '_blank';
      return (
        <a
          {...props}
          href={local ? localHelpHref(href, articleId) : href}
          target={target}
          rel={target === '_blank' ? 'noopener noreferrer' : undefined}
        >
          {children}
        </a>
      );
    },
  };
}

export function HelpPage() {
  return (
    <section className="help-page" aria-labelledby="help-page-title">
      <header className="help-page__header">
        <div>
          <h1 className="panel__title" id="help-page-title">Help and user guide</h1>
          <p className="lede">
            Learn the Skill Loom workflow, inspect the two included skills, and find local
            setup and recovery guidance. The guide is available offline.
          </p>
        </div>
      </header>
      <nav className="help-page__contents" aria-label="Help articles">
        <h2 className="section-title">Guides</h2>
        <ul>
          {HELP_ARTICLES.map((article) => (
            <li key={article.id}>
              <a href={`#article-${article.id}`}>{article.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      {HELP_ARTICLES.map((article) => (
        <article className="help-article" id={`article-${article.id}`} key={article.id}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[[rehypeSlug, { prefix: `${article.id}-` }]]}
            components={articleComponents(article.id)}
          >
            {article.content}
          </ReactMarkdown>
          {article.id === 'user-guide' ? (
            <section className="help-skills" aria-labelledby="help-skills-title">
              <div className="page-title-row">
                <h3 className="section-title" id="help-skills-title">Use the included workflow skills</h3>
                <HelpPopover topic="discoverySkill" />
              </div>
              <p>
                <strong>scenario-discovery</strong> supports two separate modes: project-local
                discovery, or an offline-validated handoff from the project-independent discovery
                page. It proposes a useful ordered workflow and builds a reviewed <code>.loom.json</code>
                bundle from selected packages only. Review the proposed chain and complete file
                inventory before confirming. This skill does not import or execute the result.
              </p>
              <p>
                <HelpPopover topic="runnerSkill" />{' '}
                <strong>loom-run-bundle</strong> inspects an existing exported bundle, asks you
                to review and separately approve package installation and execution, then
                coordinates steps in the current compatible host. It does not launch a harness
                CLI. Run records and input values are saved under the project's
                <code>.loom/portable-runs/</code>.
              </p>
            </section>
          ) : null}
        </article>
      ))}
    </section>
  );
}
