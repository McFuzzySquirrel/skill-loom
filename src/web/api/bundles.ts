import type { BundlePreview, ChainBundle } from '../../shared/bundles';
import type { Chain } from './chains';
import { ApiClientError, requestJson } from './client';

function base(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export const bundlesApi = {
  async export(projectId: string, chainId: string): Promise<ChainBundle> {
    const result = await requestJson<{ bundle: ChainBundle }>(
      `${base(projectId)}/chains/${encodeURIComponent(chainId)}/bundle`,
    );
    return result.bundle;
  },
  async exportDraft(draftId: string): Promise<ChainBundle> {
    const result = await requestJson<{ bundle: ChainBundle }>(
      `/api/drafts/${encodeURIComponent(draftId)}/bundle`,
    );
    return result.bundle;
  },
  preview(projectId: string, bundle: unknown): Promise<BundlePreview> {
    return requestJson(`${base(projectId)}/chain-bundles/preview`, {
      method: 'POST', body: { bundle },
    });
  },
  async import(projectId: string, bundle: ChainBundle, reuseSkills: string[]): Promise<Chain> {
    const result = await requestJson<{ chain: Chain }>(
      `${base(projectId)}/chain-bundles/import`,
      { method: 'POST', body: { bundle, reuseSkills, confirmed: true } },
    );
    return result.chain;
  },
  async downloadRunnerSkill(): Promise<void> {
    let response: Response;
    try {
      response = await fetch('/api/portable-skill', { headers: { Accept: 'application/zip' } });
    } catch {
      throw new ApiClientError('Could not reach the Skill Loom server. Check that it is running, then retry.', {
        code: 'NETWORK_ERROR',
        status: 0,
      });
    }
    if (!response.ok) {
      throw new ApiClientError(
        response.status === 503
          ? 'The standalone runner skill is not built. Build it with npm run build:portable-skill and retry.'
          : `The Skill Loom server returned HTTP ${response.status} while preparing the runner skill.`,
        { code: 'PORTABLE_SKILL_UNAVAILABLE', status: response.status },
      );
    }
    downloadFile(await response.blob(), 'loom-run-bundle.zip');
  },
};

export function downloadBundle(bundle: ChainBundle): void {
  downloadFile(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
    `${bundle.chain.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64) || 'chain'}.loom.json`);
}

function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
