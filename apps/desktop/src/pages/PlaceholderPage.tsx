type Props = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: Props) {
  return (
    <section className="placeholder-page">
      <h1>{title}</h1>
      <div className="panel empty-state-card">
        <h2 className="empty-state-title">Workbench Placeholder</h2>
        <p className="empty-state-caption">{description}</p>
        <p className="muted empty-state-meta">This surface is reserved for future visual prototypes and rapid drafts.</p>
      </div>
    </section>
  );
}