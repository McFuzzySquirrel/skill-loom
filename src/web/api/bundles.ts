import type { BundlePreview, ChainBundle } from '../../shared/bundles';
import type { Chain } from './chains';
import { requestJson } from './client';

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
};

export function downloadBundle(bundle: ChainBundle): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${bundle.chain.name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64) || 'chain'}.loom.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
