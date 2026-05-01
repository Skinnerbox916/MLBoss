interface DivergingRowProps {
  label: string;
  relDelta: number;
  maxRel: number;
  winning: boolean | null;
  deltaStr: string;
  myVal?: string;
  oppVal?: string;
  labelWidth?: string;
  valueWidth?: string;
  deltaWidth?: string;
}

export default function DivergingRow({
  label,
  relDelta,
  maxRel,
  winning,
  deltaStr,
  myVal,
  oppVal,
  labelWidth = 'w-9',
  valueWidth = 'w-8',
  deltaWidth = 'w-11',
}: DivergingRowProps) {
  const barPct = maxRel > 0 ? (relDelta / maxRel) * 42 : 0;
  const isWin = winning === true;
  const isLoss = winning === false;
  const barColor = isWin ? 'bg-success' : isLoss ? 'bg-error' : 'bg-muted-foreground';
  const deltaColor = isWin ? 'text-success' : isLoss ? 'text-error' : 'text-muted-foreground';

  return (
    <div className="flex items-center gap-1">
      <span className={`${labelWidth} text-[11px] font-medium text-foreground shrink-0 truncate`}>{label}</span>
      {myVal !== undefined && (
        <span className={`${valueWidth} text-[11px] text-right tabular-nums font-mono shrink-0 ${isWin ? 'text-success font-semibold' : isLoss ? 'text-muted-foreground' : 'text-foreground'}`}>
          {myVal}
        </span>
      )}
      <div className="flex-1 flex items-center h-4 relative min-w-0">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
        {barPct > 0 && isWin && (
          <div
            className={`absolute left-1/2 top-0.5 bottom-0.5 rounded-r ${barColor}`}
            style={{ width: `${barPct}%` }}
          />
        )}
        {barPct > 0 && isLoss && (
          <div
            className={`absolute top-0.5 bottom-0.5 rounded-l ${barColor}`}
            style={{ width: `${barPct}%`, right: '50%' }}
          />
        )}
      </div>
      {oppVal !== undefined && (
        <span className={`${valueWidth} text-[11px] text-left tabular-nums font-mono shrink-0 ${isLoss ? 'text-error font-semibold' : isWin ? 'text-muted-foreground' : 'text-foreground'}`}>
          {oppVal}
        </span>
      )}
      <span className={`${deltaWidth} text-[11px] text-right font-bold shrink-0 tabular-nums font-mono ${deltaColor}`}>
        {deltaStr}
      </span>
    </div>
  );
}
