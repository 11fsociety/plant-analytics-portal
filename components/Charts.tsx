'use client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend, Area, AreaChart } from 'recharts';

export const PALETTE = ['#3aafa9', '#2b7a78', '#f7b32b', '#d7263d', '#def2f1', '#8ab8b6', '#a8dadc', '#c1e5e2', '#e4f0ef', '#feffff'];

export function fmt(n: number | null | undefined): string {
  if (n == null) return '-';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function fmtT(kg: number | null | undefined, digits?: number): string {
  if (kg == null) return '-';
  const t = kg / 1000;
  const d = digits ?? (Math.abs(t) >= 100 ? 1 : 2);
  return t.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }) + ' t';
}

export function toTonnes(kg: number | null | undefined): number | null {
  if (kg == null) return null;
  return kg / 1000;
}

const gridColor = 'var(--panel-border)';
const axisColor = 'var(--muted)';

export function BarChartVertical({ data, xKey, yKey, label, height = 260 }: any) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 12, right: 12, bottom: 40, left: 4 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} stroke={axisColor} fontSize={10} interval={0} angle={-30} textAnchor="end" />
        <YAxis stroke={axisColor} fontSize={10} />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: `1px solid ${gridColor}`, color: 'var(--text)' }} formatter={(v: any) => typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v} />
        <Bar dataKey={yKey} name={label} radius={[4, 4, 0, 0]}>
          {data.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BarChartHorizontal({ data, xKey, yKey, label, height = 320 }: any) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis type="number" stroke={axisColor} fontSize={10} />
        <YAxis type="category" dataKey={xKey} stroke={axisColor} fontSize={10} width={180} interval={0} />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: `1px solid ${gridColor}`, color: 'var(--text)' }} formatter={(v: any) => typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v} />
        <Bar dataKey={yKey} name={label} radius={[0, 4, 4, 0]}>
          {data.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, nameKey, valueKey, height = 260 }: any) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius={50} outerRadius={90} label={(e: any) => e.name?.length > 22 ? e.name.slice(0, 22) + '...' : e.name}>
          {data.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ background: 'var(--panel)', border: `1px solid ${gridColor}`, color: 'var(--text)' }} formatter={(v: any) => typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function LineArea({ data, xKey, yKey, label, height = 260 }: any) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 40, left: 4 }}>
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PALETTE[0]} stopOpacity={0.6} />
            <stop offset="100%" stopColor={PALETTE[0]} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} stroke={axisColor} fontSize={10} angle={-30} textAnchor="end" />
        <YAxis stroke={axisColor} fontSize={10} />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: `1px solid ${gridColor}`, color: 'var(--text)' }} formatter={(v: any) => typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v} />
        <Area dataKey={yKey} stroke={PALETTE[0]} fill="url(#areaFill)" name={label} strokeWidth={1.8} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DualAxisLine({ data, xKey, y1Key, y2Key, y1Label, y2Label, height = 280 }: any) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 40, bottom: 40, left: 4 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} stroke={axisColor} fontSize={10} angle={-30} textAnchor="end" />
        <YAxis yAxisId="left" stroke={PALETTE[0]} fontSize={10} />
        <YAxis yAxisId="right" orientation="right" stroke={PALETTE[2]} fontSize={10} />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: `1px solid ${gridColor}`, color: 'var(--text)' }} formatter={(v: any) => typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line yAxisId="left" dataKey={y1Key} name={y1Label} stroke={PALETTE[0]} strokeWidth={1.8} dot={false} />
        <Line yAxisId="right" dataKey={y2Key} name={y2Label} stroke={PALETTE[2]} strokeWidth={1.6} strokeDasharray="4 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ForecastChart({ data, height = 280 }: any) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 12, right: 12, bottom: 40, left: 4 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis dataKey="d" stroke={axisColor} fontSize={10} angle={-30} textAnchor="end" />
        <YAxis stroke={axisColor} fontSize={10} />
        <Tooltip contentStyle={{ background: 'var(--panel)', border: `1px solid ${gridColor}`, color: 'var(--text)' }} formatter={(v: any) => typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line dataKey="actual" name="Actual (t)" stroke={PALETTE[0]} strokeWidth={1.8} dot={false} connectNulls={false} />
        <Line dataKey="point" name="Forecast (t)" stroke={PALETTE[2]} strokeWidth={1.6} strokeDasharray="4 4" dot={false} connectNulls={false} />
        <Line dataKey="low" name="Low 95%" stroke={PALETTE[3]} strokeWidth={0.8} strokeDasharray="1 4" dot={false} connectNulls={false} />
        <Line dataKey="high" name="High 95%" stroke={PALETTE[3]} strokeWidth={0.8} strokeDasharray="1 4" dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
