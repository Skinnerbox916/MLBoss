'use client';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDateOptions() {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    return {
      value: formatDateValue(d),
      day: DAY_NAMES[d.getDay()],
      date: `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`,
      isToday: i === 0,
    };
  });
}

interface DatePickerProps {
  selected: string;
  onSelect: (date: string) => void;
}

export default function DatePicker({ selected, onSelect }: DatePickerProps) {
  const options = buildDateOptions();

  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={`flex flex-col items-center px-3 py-2 rounded-lg text-xs font-medium transition-colors shrink-0 ${
            selected === opt.value
              ? 'bg-accent text-white shadow-sm'
              : 'bg-surface text-muted-foreground hover:bg-surface-muted'
          }`}
        >
          <span>{opt.isToday ? 'Today' : opt.day}</span>
          <span className="text-[11px] mt-0.5">{opt.date}</span>
        </button>
      ))}
    </div>
  );
}
