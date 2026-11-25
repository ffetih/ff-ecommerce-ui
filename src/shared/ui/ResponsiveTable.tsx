import { useId, type ReactNode } from 'react';

interface ResponsiveTableProps {
  caption: string;
  headers: string[];
  children: ReactNode;
}

/**
 * Semantic responsive table wrapper:
 * - Keyboard-scrollable region (tabIndex=0, role="region", aria-labelledby)
 * - Sticky column & row headers via CSS
 * - Stacks into labelled cards below 600px container width (@container)
 */
export function ResponsiveTable({ caption, headers, children }: ResponsiveTableProps) {
  const captionId = useId();
  return (
    <div tabIndex={0} role="region" aria-labelledby={captionId} className="table-wrapper">
      <table className="data-table">
        <caption id={captionId}>{caption}</caption>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
