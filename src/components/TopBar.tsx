export function TopBar({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="h-14 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60 backdrop-blur flex items-center justify-between px-5 pl-14 md:pl-5">
      <div className="min-w-0">
        <h1 className="text-[14px] font-semibold tracking-tight truncate">
          {title}
        </h1>
        {subtitle && (
          <p className="text-[11px] text-[var(--color-faint)] truncate -mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </header>
  );
}
