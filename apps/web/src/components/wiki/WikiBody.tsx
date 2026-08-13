/**
 * Safe wiki renderer — structured nodes only (no dangerouslySetInnerHTML).
 */
import { parseWikiMarkdown, type WikiInline } from "@speakerops/shared";

function Inlines({ nodes }: { nodes: WikiInline[] }) {
  return (
    <>
      {nodes.map((n, i) =>
        n.type === "link" ? (
          <a
            key={i}
            href={n.href}
            rel="noopener noreferrer"
            target="_blank"
            className="lumen-focusable"
          >
            {n.text}
          </a>
        ) : (
          <span key={i}>{n.text}</span>
        ),
      )}
    </>
  );
}

export function WikiBody({
  markdown,
  testId,
}: {
  markdown: string;
  testId?: string;
}) {
  const blocks = parseWikiMarkdown(markdown);
  return (
    <div className="wiki-body" data-testid={testId ?? "wiki-body"}>
      {blocks.map((b, i) => {
        if (b.type === "h") {
          const Tag = (`h${b.level}` as "h1" | "h2" | "h3");
          return (
            <Tag key={i} className="wiki-body__h">
              <Inlines nodes={b.children} />
            </Tag>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="wiki-body__ul">
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inlines nodes={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === "pre") {
          return (
            <pre key={i} className="wiki-body__pre">
              {b.text}
            </pre>
          );
        }
        if (b.type === "embed") {
          return (
            <iframe
              key={i}
              title={`Embedded ${b.provider}`}
              src={b.src}
              className="wiki-body__embed"
              data-testid={`wiki-embed-${b.provider}`}
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="no-referrer-when-downgrade"
              allow="encrypted-media; picture-in-picture"
            />
          );
        }
        return (
          <p key={i} className="wiki-body__p">
            <Inlines nodes={b.children} />
          </p>
        );
      })}
    </div>
  );
}
