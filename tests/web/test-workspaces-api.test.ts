import { describe, expect, it } from 'vitest';
import { createTestWorkspacesApi } from '../../src/web/api/testWorkspaces.js';

describe('test workspaces API proposal decoding', () => {
  it('uses the input name when a proposal input has no label', async () => {
    const api = createTestWorkspacesApi(async () => new Response(JSON.stringify({
      proposal: {
        name: 'Proposal',
        harness: 'copilot',
        sessionMode: 'shared',
        steps: [],
        inputs: [
          { name: 'scope', required: true },
          { name: 'format', label: 'Output format', required: false },
        ],
        skills: [],
      },
    }), {
      headers: { 'content-type': 'application/json' },
    }));

    await expect(api.getProposal('workspace')).resolves.toMatchObject({
      inputs: [
        { name: 'scope', label: 'scope', required: true },
        { name: 'format', label: 'Output format', required: false },
      ],
    });
  });
});
