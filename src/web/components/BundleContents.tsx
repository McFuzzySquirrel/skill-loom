import type { ChainBundle } from '../../shared/bundles';

export function BundleContents({ bundle }: { bundle: ChainBundle }) {
  return (
    <div>
      <p>
        <strong>{bundle.chain.name}</strong> · {bundle.chain.harness} · {bundle.chain.sessionMode}
        {' · '}{bundle.chain.steps.length} steps · {bundle.skills.length} skill packages
      </p>
      <details>
        <summary>Review chain instructions and input definitions</summary>
        <pre className="skill-detail__content">{JSON.stringify(bundle.chain, null, 2)}</pre>
      </details>
      {bundle.skills.map((skill) => (
        <details key={skill.name}>
          <summary>{skill.name} — {skill.files.length} files</summary>
          <ul>
            {skill.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>{file.executable ? ' (executable)' : ''}
              </li>
            ))}
          </ul>
          <details>
            <summary>Review SKILL.md</summary>
            <pre className="skill-detail__content">
              {new TextDecoder().decode(Uint8Array.from(
                atob(skill.files.find((file) => file.path === 'SKILL.md')?.content ?? ''),
                (char) => char.charCodeAt(0),
              ))}
            </pre>
          </details>
        </details>
      ))}
      {bundle.version === 2 ? bundle.agents.map((agent) => (
        <details key={`${agent.harness}:${agent.agentPath}`}>
          <summary>
            Native {agent.harness} agent: {agent.name}
          </summary>
          <p>
            Project path: <code>{agent.agentPath}</code>. This definition is not translated to
            another harness.
          </p>
          <pre className="skill-detail__content">
            {new TextDecoder().decode(Uint8Array.from(
              atob(agent.content),
              (char) => char.charCodeAt(0),
            ))}
          </pre>
        </details>
      )) : null}
    </div>
  );
}
