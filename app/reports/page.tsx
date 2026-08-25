'use client';
import { useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function ReportsPage() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [pdfUrl, setPdfUrl] = useState('');
  const [useLLM, setUseLLM] = useState(false);

  async function build() {
    setBusy(true);
    setProgress(5);
    setStatus('Fetching plant data...');
    setPdfUrl('');

    try {
      const plant = await fetch('/api/data').then(r => r.json());
      setProgress(15);
      setStatus('Building plant summary...');

      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const marginX = 15;
      let y = 18;

      // Cover
      doc.setFontSize(20); doc.setTextColor(23, 37, 42);
      doc.text('Production, Downtime & Scrap Report', marginX, y); y += 8;
      doc.setFontSize(10); doc.setTextColor(120);
      doc.text(`Window: ${plant.date_range?.min || '?'} to ${plant.date_range?.max || '?'}`, marginX, y);
      doc.text(`Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`, marginX, y + 4);
      y += 14;

      autoTable(doc, {
        startY: y,
        head: [['Metric', 'Value']],
        body: [
          ['Total net production', `${(plant.plant.net_kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`],
          ['Total gross production', `${(plant.plant.gross_kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`],
          ['Total sq mtr', plant.plant.sqm.toLocaleString()],
          ['Total downtime', `${plant.plant.downtime_hrs.toLocaleString()} hrs`],
          ['Total scrap', `${(plant.plant.scrap_kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} t`],
          ['Scrap % of net', `${plant.plant.scrap_pct_of_net}%`],
          ['Rolls produced', plant.plant.rolls.toLocaleString()],
        ],
        headStyles: { fillColor: [23, 37, 42], textColor: 255 },
        styles: { fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 10;
      setProgress(30);
      setStatus('Adding machine tables...');

      // Per-machine table
      doc.setFontSize(14); doc.setTextColor(43, 122, 120);
      doc.text('Machines', marginX, y); y += 5;
      autoTable(doc, {
        startY: y,
        head: [['Code', 'Machine', 'Down hrs', 'Down%', 'Days', 'Rolls', 'Net t', 'Scrap t', 'Scrap %net']],
        body: plant.machines.map((m: any) => [
          m.code, m.name,
          (m.downtime_hrs || 0).toFixed(1),
          `${((m.downtime_hrs || 0) / 744 * 100).toFixed(1)}%`,
          m.days_active,
          m.rolls,
          (m.net_kg / 1000).toFixed(2),
          (m.scrap_kg / 1000).toFixed(2),
          m.scrap_pct_of_net != null ? `${m.scrap_pct_of_net}%` : '-',
        ]),
        headStyles: { fillColor: [23, 37, 42], textColor: 255 },
        styles: { fontSize: 8 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
      setProgress(50);
      setStatus('Per-machine sections...');

      // Downtime reasons
      doc.setFontSize(14); doc.setTextColor(43, 122, 120);
      doc.text('Downtime reasons (plant)', marginX, y); y += 5;
      autoTable(doc, {
        startY: y,
        head: [['Reason', 'Hrs', '% of plant']],
        body: plant.downtime_reasons_plant.map((r: any) => [r.reason || 'Unclassified', r.hrs.toFixed(1), `${(r.hrs / plant.plant.downtime_hrs * 100).toFixed(1)}%`]),
        headStyles: { fillColor: [23, 37, 42], textColor: 255 },
        styles: { fontSize: 8 },
        margin: { left: marginX, right: marginX },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
      setProgress(65);

      // Top scrap
      doc.setFontSize(14); doc.setTextColor(43, 122, 120);
      doc.text('Top 15 scrap categories (plant)', marginX, y); y += 5;
      autoTable(doc, {
        startY: y,
        head: [['Rejection description', 'Tonnes', 'Events']],
        body: plant.scrap_reasons_plant.map((r: any) => [(r.reason || '').slice(0, 60), (r.kg / 1000).toFixed(2), r.events]),
        headStyles: { fillColor: [23, 37, 42], textColor: 255 },
        styles: { fontSize: 8 },
        margin: { left: marginX, right: marginX },
      });
      setProgress(80);
      setStatus('Machine drill-downs...');

      // Per-machine detail sections
      for (const m of plant.machines) {
        doc.addPage();
        y = 18;
        doc.setFontSize(16); doc.setTextColor(23, 37, 42);
        doc.text(`${m.name} (${m.code})`, marginX, y); y += 8;

        autoTable(doc, {
          startY: y,
          head: [['Metric', 'Value']],
          body: [
            ['Net production', `${(m.net_kg / 1000).toFixed(2)} t`],
            ['Gross production', `${(m.gross_kg / 1000).toFixed(2)} t`],
            ['Sq mtr', m.sqm.toLocaleString()],
            ['Rolls', m.rolls],
            ['Days active', m.days_active],
            ['Downtime', `${(m.downtime_hrs || 0).toFixed(1)} hrs`],
            ['Downtime % of 744', `${((m.downtime_hrs || 0) / 744 * 100).toFixed(1)}%`],
            ['Scrap', `${(m.scrap_kg / 1000).toFixed(2)} t`],
            ['Scrap % of net', m.scrap_pct_of_net != null ? `${m.scrap_pct_of_net}%` : '-'],
            ['Throughput / productive-hr', m.throughput_kg_per_productive_hr ? `${(m.throughput_kg_per_productive_hr / 1000).toFixed(2)} t/hr` : '-'],
          ],
          headStyles: { fillColor: [23, 37, 42], textColor: 255 },
          styles: { fontSize: 9 },
          margin: { left: marginX, right: marginX },
        });
        y = (doc as any).lastAutoTable.finalY + 6;

        const detail = await fetch(`/api/machine/${m.code}${useLLM ? '?llm=1' : ''}`).then(r => r.json());
        if (detail.scrap_reasons?.length) {
          doc.setFontSize(11); doc.setTextColor(43, 122, 120);
          doc.text('Top scrap categories', marginX, y); y += 5;
          autoTable(doc, {
            startY: y,
            head: [['Reason', 'Tonnes']],
            body: detail.scrap_reasons.slice(0, 10).map((r: any) => [(r.reason || '').slice(0, 55), (r.kg / 1000).toFixed(2)]),
            headStyles: { fillColor: [23, 37, 42], textColor: 255 },
            styles: { fontSize: 8 },
            margin: { left: marginX, right: marginX },
          });
          y = (doc as any).lastAutoTable.finalY + 6;
        }
        if (detail.narrative) {
          doc.setFontSize(11); doc.setTextColor(43, 122, 120);
          doc.text('Insights', marginX, y); y += 5;
          doc.setFontSize(9); doc.setTextColor(60);
          for (const b of detail.narrative.bullets || []) {
            const lines = doc.splitTextToSize(`- ${b}`, pageW - marginX * 2);
            doc.text(lines, marginX, y); y += lines.length * 4 + 1;
            if (y > 270) { doc.addPage(); y = 18; }
          }
        }
      }

      setProgress(98);
      setStatus('Writing PDF...');
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      setProgress(100);
      setStatus('Ready');
    } catch (e: any) {
      setStatus('Failed: ' + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Reports</h1>
      <div className="insight-block">
        <h3>Generate a PDF report</h3>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Plant summary + per-machine sections with tables and insights. Rendered client-side.</p>
        <label style={{ display: 'block', margin: '10px 0' }}>
          <input type="checkbox" checked={useLLM} onChange={e => setUseLLM(e.target.checked)} /> Include LLM narrative (requires ANTHROPIC_API_KEY)
        </label>
        <button className="btn" onClick={build} disabled={busy}>{busy ? 'Generating...' : 'Generate report'}</button>
      </div>

      {progress > 0 && (
        <div className="progress-wrap">
          <div className="progress-msg">{status}</div>
          <div className="progress-bar"><div className="progress-fill" style={{ width: progress + '%' }} /></div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>{progress}%</div>
        </div>
      )}

      {pdfUrl && (
        <div className="insight-block">
          <h3>Report ready</h3>
          <a className="btn" href={pdfUrl} download={`plant_report_${Date.now()}.pdf`}>Download PDF</a>
        </div>
      )}
    </>
  );
}
