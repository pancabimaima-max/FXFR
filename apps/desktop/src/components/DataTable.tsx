type Props = {
  rows: Record<string, unknown>[];
  emptyText?: string;
  variant?: "default" | "dense";
};

export function DataTable({ rows, emptyText = "No rows.", variant = "default" }: Props) {
  if (!rows.length) {
    return <div className="panel muted empty-state-card">{emptyText}</div>;
  }

  const columns = Object.keys(rows[0] ?? {});
  return (
    <div className={`data-table-wrap ui-scroll-region${variant === "dense" ? " dense" : ""}`}>
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {columns.map((c) => (
                <td key={`${idx}-${c}`}>{String(row[c] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
