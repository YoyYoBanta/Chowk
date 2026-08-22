"use client";

import { useEffect, useState } from "react";

interface Template {
  name: string;
  languageCode: string;
  status: string;
  category: string;
  body: string;
}

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
    return <div style={{ padding: "1rem", border: "1px solid var(--border, #e5e5e5)", borderRadius: "0.5rem" }}>Loading templates...</div>;
  }

  if (templates.length === 0) {
    return (
      <div style={{ padding: "1rem", border: "1px solid var(--border, #e5e5e5)", borderRadius: "0.5rem" }}>
        <p>No approved templates found for this channel.</p>
        <button onClick={onCancel} type="button">Cancel</button>
      </div>
    );
  }

  if (!selectedTemplate) {
    return (
      <div style={{ padding: "1rem", border: "1px solid var(--border, #e5e5e5)", borderRadius: "0.5rem" }}>
        <h3 style={{ marginTop: 0 }}>Select a Template</h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {templates.map(t => (
            <li key={t.name}>
              <button 
                type="button" 
                onClick={() => handleTemplateSelect(t)}
                style={{ width: "100%", textAlign: "left", padding: "0.5rem", background: "none", border: "1px solid var(--border, #e5e5e5)", cursor: "pointer", borderRadius: "0.25rem" }}
              >
                <strong>{t.name}</strong> ({t.languageCode})
                <br/>
                <small style={{ opacity: 0.7 }}>{t.body}</small>
              </button>
            </li>
          ))}
        </ul>
        <button onClick={onCancel} type="button" style={{ marginTop: "1rem" }}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={{ padding: "1rem", border: "1px solid var(--border, #e5e5e5)", borderRadius: "0.5rem" }}>
      <h3 style={{ marginTop: 0 }}>Fill variables for {selectedTemplate.name}</h3>
      <div style={{ marginBottom: "1rem", padding: "0.5rem", backgroundColor: "var(--background-secondary, #f5f5f5)", borderRadius: "0.25rem" }}>
        <p style={{ margin: 0, fontSize: "0.9em", whiteSpace: "pre-wrap" }}>
          {selectedTemplate.body}
        </p>
      </div>

      {Object.keys(variables).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
          {Object.keys(variables).map(key => (
            <div key={key} style={{ display: "flex", flexDirection: "column" }}>
              <label htmlFor={`var-${key}`} style={{ fontSize: "0.8em", marginBottom: "0.25rem" }}>{`{{${key}}}`}</label>
              <input 
                id={`var-${key}`}
                type="text" 
                value={variables[key]}
                onChange={e => setVariables({...variables, [key]: e.target.value})}
                placeholder={`Value for ${key}`}
                style={{ padding: "0.25rem 0.5rem", borderRadius: "0.25rem", border: "1px solid var(--border, #e5e5e5)" }}
              />
            </div>
          ))}
        </div>
      )}
      
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="button" onClick={handleSend} style={{ backgroundColor: "var(--primary, #005c4b)", color: "white", padding: "0.5rem 1rem", border: "none", borderRadius: "0.25rem", cursor: "pointer" }}>Send</button>
        <button type="button" onClick={() => setSelectedTemplate(null)}>Back</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
