import { useEffect, useId, useState } from "react";

// Importing Mermaid only for diagrams keeps ordinary chat startup small.
let renderer: Promise<typeof import("mermaid")["default"]> | undefined;
function loadRenderer() {
  return (renderer ??= import("mermaid").then(({ default: mermaid }) => {
    const style = getComputedStyle(document.documentElement);
    const token = (name: string) => style.getPropertyValue(name).trim();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      htmlLabels: false,
      // Diagram directives cannot enable HTML labels, inject CSS or weaken sanitization.
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels", "dompurifyConfig", "themeCSS", "themeVariables", "fontFamily", "altFontFamily"],
      theme: "base",
      themeVariables: {
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: "14px",
        primaryColor: token("--fill"),
        primaryTextColor: token("--ink"),
        primaryBorderColor: token("--line-strong"),
        lineColor: token("--muted"),
        secondaryColor: token("--side"),
        tertiaryColor: token("--bg"),
      },
    });
    return mermaid;
  }).catch((error) => {
    renderer = undefined;
    throw error;
  }));
}

export function MermaidDiagram({ source, complete }: { source: string; complete: boolean }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [showSource, setShowSource] = useState(false);
  const [result, setResult] = useState<{ source: string; url?: string; width?: number; error?: boolean } | null>(null);
  const current = complete && result?.source === source ? result : null;
  const empty = !source.trim();

  useEffect(() => {
    if (!complete || empty) return;
    let live = true;
    let url: string | undefined;
    loadRenderer().then(async (mermaid) => {
      if (!live) return;
      const { svg } = await mermaid.render(id, source);
      if (!live) return;
      // SVG images have no script, navigation or access to the host document.
      // Never insert the renderer's markup into the React tree.
      url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      // Mermaid's percentage width otherwise stretches small diagrams and text
      // to fill the thread. Measure the SVG without mounting it in the document.
      const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
      const width = Number(root.getAttribute("viewBox")?.trim().split(/[\s,]+/)[2]);
      setResult({ source, url, width: Number.isFinite(width) && width > 0 ? width : undefined });
    }).catch(() => {
      if (live) setResult({ source, error: true });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, complete, empty, id]);

  const status = !complete ? "Waiting for the diagram to finish…" : empty ? "Empty Mermaid diagram." : current?.error ? "Could not render diagram. Source is shown below." : !current?.url ? "Drawing diagram…" : null;
  return (
    <div className="mermaid">
      <div className="mermaid-bar">
        <span className="muted small">Mermaid</span>
        {current?.url && (
          <button className="btn-text" type="button" aria-pressed={showSource} onClick={() => setShowSource(!showSource)}>
            {showSource ? "Show diagram" : "Show source"}
          </button>
        )}
      </div>
      {status && <div className="mermaid-note muted small" role="status">{status}</div>}
      {current?.url && !showSource ? (
        <div className="mermaid-image">
          <img src={current.url} width={current.width} alt="Mermaid diagram" onError={() => setResult({ source, error: true })} />
        </div>
      ) : (
        <pre className="code">{source}</pre>
      )}
    </div>
  );
}
