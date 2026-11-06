import userGuide from '../../../docs/user-guide.md?raw';
import administratorGuide from '../../../docs/admin-guide.md?raw';
import operationsGuide from '../../../docs/OPERATIONS.md?raw';
import supportGuide from '../../../docs/SUPPORT.md?raw';
import scenarioGuide from '../../../docs/scenario-chains.md?raw';

export interface HelpArticle {
  id: string;
  title: string;
  content: string;
}

export const HELP_ARTICLES: readonly HelpArticle[] = [
  { id: 'user-guide', title: 'User guide', content: userGuide },
  { id: 'administrator-guide', title: 'Administrator guide', content: administratorGuide },
  { id: 'operations-guide', title: 'Operations guide', content: operationsGuide },
  { id: 'scenario-chains', title: 'Scenario catalog', content: scenarioGuide },
  { id: 'support', title: 'Support', content: supportGuide },
];

export function helpArticleTitle(id: string): string {
  return HELP_ARTICLES.find((article) => article.id === id)?.title ?? 'User guide';
}

export function guideAnchor(articleId: string, anchor: string): string {
  return `${articleId}-${anchor}`;
}
