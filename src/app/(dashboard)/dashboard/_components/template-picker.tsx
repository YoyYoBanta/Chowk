"use client";

import { useEffect, useState } from "react";

interface Template {
  name: string;
  languageCode: string;
  status: string;
  category: string;
  body: string;
}

const panelStyle = {
  padding: "var(--space-4)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "var(--surface)",
  color: "var(--text-primary)",
} as const;

const secondaryButtonStyle = {
  padding: "0.5rem 1rem",
  background: "transparent",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-secondary)",
  fontSize: "0.85rem",
  cursor: "pointer",
} as const;

export function TemplatePicker({
  channelId,
  onSelect,
  onCancel,
}: {
  channelId: string;
  onSelect: (templateName: string, languageCode: string, variables: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch(`/api/templates?channelId=${channelId}`);
        if (res.ok) {
          const data = await res.json();
          // Filter out unapproved templates
          setTemplates(data.templates.filter((t: Template) => t.status === "APPROVED"));
        }
      } catch (err) {
        console.error("Failed to fetch templates", err);
      } finally {
        setLoading(false);
      }
    }
    void fetchTemplates();
  }, [channelId]);

  const handleTemplateSelect = (t: Template) => {
    setSelectedTemplate(t);

    // Simple extraction of variables like {{1}}, {{2}} from body
    const matches = t.body.match(/\{\{(\w+)\}\}/g);
    if (matches) {
      const newVars: Record<string, string> = {};
      matches.forEach(m => {
        const key = m.replace(/[\{\}]/g, '');
        newVars[key] = "";
      });
      setVariables(newVars);
    } else {
      setVariables({});
    }
  };

  const handleSend = () => {
    if (!selectedTemplate) return;
    onSelect(selectedTemplate.name, selectedTemplate.languageCode, variables);
  };

  if (loading) {
    return <div style={panelStyle}>Loading templates…</div>;
  }

  if (templates.length === 0) {
    return (
      <div style={panelStyle}>
        <p style={{ margin: "0 0 var(--space-3)", color: "var(--text-secondary)" }}>
          No approved templates found for this channel.
        </p>
        <button onClick={onCancel} type="button" style={secondaryButtonStyle}>Cancel</button>
      </div>
    );
  }

  if (!selectedTemplate) {
    return (
      <div style={panelStyle}>
        <h3 style={{ marginTop: 0, marginBottom: "var(--space-3)", fontSize: "0.95rem", fontWeight: 700 }}>Select a template</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {templates.map(t => (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => handleTemplateSelect(t)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--space-3)",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text-primary)",
                }}
              >
                <strong style={{ fontSize: "0.88rem" }}>{t.name}</strong>{" "}
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>({t.languageCode})</span>
                <br />
                <small style={{ color: "var(--text-secondary)" }}>{t.body}</small>
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onCancel} type="button" style={{ ...secondaryButtonStyle, marginTop: "var(--space-4)" }}>
          Cancel
        </button>
      </div>
    );
  }

  // context.md §8.5: "UI presents one input per variable with live
  // preview." Every {{n}} in the body gets replaced by its current input
  // value (blank ones stay as the literal placeholder, so it's obvious
  // which are still unfilled) — the same substitution shape the real send
  // path performs, just computed here for display only.
  const previewBody = selectedTemplate.body.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    variables[key] ? variables[key] : match,
  );

  return (
    <div style={panelStyle}>
      <h3 style={{ marginTop: 0, marginBottom: "var(--space-3)", fontSize: "0.95rem", fontWeight: 700 }}>
        Fill variables for {selectedTemplate.name}
      </h3>
      <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3)", background: "var(--bg)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
        <p style={{ margin: "0 0 var(--space-1)", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
          Preview
        </p>
        <p style={{ margin: 0, fontSize: "0.88rem", whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>
          {previewBody}
        </p>
      </div>

      {Object.keys(variables).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
          {Object.keys(variables).map(key => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <label htmlFor={`var-${key}`} style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>{`{{${key}}}`}</label>
              <input
                id={`var-${key}`}
                type="text"
                value={variables[key]}
                onChange={e => setVariables({...variables, [key]: e.target.value})}
                placeholder={`Value for ${key}`}
                style={{
                  padding: "0.5rem 0.65rem",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-strong)",
                  background: "var(--bg)",
                  color: "var(--text-primary)",
                  fontSize: "0.88rem",
                  outline: "none",
                }}
              />
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)" }}>
        <button
          type="button"
          onClick={handleSend}
          style={{
            background: "var(--accent)",
            color: "var(--text-on-accent)",
            padding: "0.55rem 1.1rem",
            border: "none",
            borderRadius: "var(--radius-sm)",
            fontWeight: 700,
            fontSize: "0.85rem",
            cursor: "pointer",
          }}
        >
          Send
        </button>
        <button type="button" onClick={() => setSelectedTemplate(null)} style={secondaryButtonStyle}>Back</button>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>Cancel</button>
      </div>
    </div>
  );
}
