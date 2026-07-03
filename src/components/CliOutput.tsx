import { parseCliOutput } from "../lib/cliOutput";

export function CliOutputView({ text }: { text: string }) {
  const blocks = parseCliOutput(text);
  if (blocks.length === 0) {
    return <pre className="cli-output-fallback">{text}</pre>;
  }

  return (
    <div className="cli-output">
      {blocks.map((block, index) => (
        <section key={`${block.host}-${block.command}-${index}`} className="cli-output-block">
          <header className="cli-output-block-head">
            <span className="cli-output-host">{block.host}</span>
            <code className="cli-output-command">{block.command}</code>
          </header>
          {block.table ? (
            <div className="cli-output-table-wrap">
              <table className="cli-output-table">
                <thead>
                  <tr>
                    {block.table.headers.map((header) => (
                      <th key={header}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="cli-output-lines">{block.lines.join("\n")}</pre>
          )}
        </section>
      ))}
    </div>
  );
}
