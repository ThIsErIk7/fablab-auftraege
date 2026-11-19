// Rechnungs-PDF mit den Pflichtangaben nach § 14 Abs. 4 UStG:
// Name/Anschrift Absender + Empfänger, Steuernummer oder USt-IdNr., Rechnungsdatum, fortlaufende Nummer,
// Leistungsdatum/-zeitraum, Menge und Art der Leistung, Netto, Steuersatz + Steuerbetrag (oder Befreiungshinweis), Brutto.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { InvoiceDetail, SenderSnapshot } from '@fablab/shared';
import { formatBp, formatCents, formatDateDe, formatMills, formatNumber } from '@fablab/shared';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake');
const Roboto = require('pdfmake/fonts/Roboto');
pdfmake.addFonts(Roboto);
// Keine externen Ressourcen laden (Logo kommt als data:-URL aus der Datenbank).
pdfmake.setUrlAccessPolicy(() => false);
// Lokal nur die mitgelieferten Schriftdateien erlauben.
const FONT_DIR = dirname(require.resolve('pdfmake/fonts/Roboto'));
pdfmake.setLocalAccessPolicy?.((path: string) => resolve(path).startsWith(FONT_DIR));

const GREY = '#666666';
const LINE = '#cccccc';

function servicePeriod(inv: InvoiceDetail): { label: string; value: string } {
  const from = inv.serviceFrom;
  const to = inv.serviceTo ?? inv.serviceFrom;
  if (from && to && from !== to) return { label: 'Leistungszeitraum', value: `${formatDateDe(from)} – ${formatDateDe(to)}` };
  return { label: 'Leistungsdatum', value: formatDateDe(to ?? inv.invoiceDate) || '–' };
}

export async function renderInvoicePdf(inv: InvoiceDetail, currentSender: SenderSnapshot, extra: { paymentTermDays: number; introText: string }): Promise<Buffer> {
  // Gestellte Rechnungen nutzen immer den eingefrorenen Absender, Entwürfe die aktuellen Einstellungen.
  const s = inv.sender ?? currentSender;
  const isDraft = inv.status === 'entwurf';
  const isStorno = inv.type === 'storno';
  const title = isStorno ? 'Stornorechnung' : 'Rechnung';
  const period = servicePeriod(inv);
  const senderLine = [s.name, ...s.address.split('\n')].join(' · ');

  const infoRows: [string, string][] = [
    ['Rechnungsnummer', inv.number ?? 'wird beim Stellen vergeben'],
    ['Rechnungsdatum', formatDateDe(inv.invoiceDate) || (isDraft ? 'beim Stellen' : '–')],
    [period.label, period.value],
  ];
  if (inv.orderId) infoRows.push(['Auftrag', `#${inv.orderId}`]);
  if (inv.recipient.vatId) infoRows.push(['Ihre USt-IdNr.', inv.recipient.vatId]);
  if (s.taxNumber) infoRows.push(['Steuernummer', s.taxNumber]);
  if (s.vatId) infoRows.push(['USt-IdNr.', s.vatId]);

  const hasDiscount = inv.items.some((i) => i.discountBp > 0);
  const header = ['Pos.', 'Beschreibung', 'Menge', 'Einzelpreis', ...(hasDiscount ? ['Rabatt'] : []), 'Gesamt'];
  const body = [
    header.map((h, i) => ({ text: h, bold: true, alignment: i >= 2 ? 'right' : 'left', fillColor: '#f2f2f2' })),
    ...inv.items.map((it, idx) => [
      { text: String(idx + 1) },
      { text: it.description },
      { text: `${formatNumber(it.quantity, 3)} ${it.unit}`, alignment: 'right', noWrap: true },
      { text: formatMills(it.unitPriceMills), alignment: 'right', noWrap: true },
      ...(hasDiscount ? [{ text: it.discountBp ? formatBp(it.discountBp) : '', alignment: 'right' }] : []),
      { text: formatCents(it.totalCents), alignment: 'right', noWrap: true },
    ]),
  ];
  const widths = ['auto', '*', 'auto', 'auto', ...(hasDiscount ? ['auto'] : []), 'auto'];

  const totals: any[] = [['Summe netto', formatCents(inv.netCents)]];
  if (inv.taxRateBp > 0) totals.push([`zzgl. ${formatBp(inv.taxRateBp)} USt.`, formatCents(inv.taxCents)]);
  else totals.push(['Umsatzsteuer', formatCents(0)]);
  totals.push([{ text: isStorno ? 'Gutschriftsbetrag' : 'Rechnungsbetrag', bold: true }, { text: formatCents(inv.grossCents), bold: true }]);

  const paymentText = isStorno
    ? (inv.status === 'bezahlt' ? 'Die ursprüngliche Rechnung ist damit ausgeglichen.' : 'Ein bereits gezahlter Betrag wird Ihnen erstattet.')
    : inv.dueDate
      ? `Bitte überweisen Sie den Rechnungsbetrag bis zum ${formatDateDe(inv.dueDate)} ohne Abzug unter Angabe der Rechnungsnummer.`
      : `Zahlbar innerhalb von ${extra.paymentTermDays} Tagen ab Rechnungsdatum ohne Abzug.`;

  const footerCols = [
    [s.name, ...s.address.split('\n')].join('\n'),
    [s.phone && `Tel. ${s.phone}`, s.email, s.website].filter(Boolean).join('\n'),
    [s.taxNumber && `St.-Nr. ${s.taxNumber}`, s.vatId && `USt-IdNr. ${s.vatId}`].filter(Boolean).join('\n'),
    [s.bankName, s.iban && `IBAN ${s.iban}`, s.bic && `BIC ${s.bic}`, s.accountHolder && `Inhaber: ${s.accountHolder}`].filter(Boolean).join('\n'),
  ];

  const doc: any = {
    pageSize: 'A4',
    pageMargins: [56, 50, 56, 90],
    info: { title: `${title} ${inv.number ?? 'Entwurf'}`, author: s.name, creator: 'FabLab Auftragsverwaltung' },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.2 },
    watermark: isDraft ? { text: 'ENTWURF', color: '#d33', opacity: 0.12, bold: true } : undefined,
    footer: (page: number, pages: number) => ({
      margin: [56, 10, 56, 0],
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.5, lineColor: LINE }] },
        { columns: footerCols.map((t) => ({ text: t, fontSize: 7, color: GREY })), columnGap: 10, margin: [0, 6, 0, 0] },
        { text: `Seite ${page} von ${pages}`, alignment: 'right', fontSize: 7, color: GREY, margin: [0, 4, 0, 0] },
      ],
    }),
    content: [
      {
        columns: [
          { text: s.name, fontSize: 14, bold: true, width: '*' },
          s.logoDataUrl ? { image: s.logoDataUrl, fit: [150, 60], width: 'auto', alignment: 'right' } : { text: '' },
        ],
      },
      { text: '', margin: [0, 30, 0, 0] },
      {
        columns: [
          {
            width: '*',
            stack: [
              { text: senderLine, fontSize: 7, color: GREY, decoration: 'underline', margin: [0, 0, 0, 6] },
              { text: inv.recipient.name, bold: true },
              { text: inv.recipient.address || '' },
            ],
          },
          {
            width: 210,
            table: {
              widths: ['auto', '*'],
              body: infoRows.map(([k, v]) => [{ text: k, color: GREY }, { text: v, alignment: 'right' }]),
            },
            layout: 'noBorders',
          },
        ],
      },
      { text: `${title}${inv.number ? ` ${inv.number}` : ''}`, fontSize: 16, bold: true, margin: [0, 34, 0, 4] },
      isStorno && inv.cancelsNumber
        ? { text: `Storno zu Rechnung ${inv.cancelsNumber}`, color: GREY, margin: [0, 0, 0, 8] }
        : { text: '' },
      !isStorno && extra.introText ? { text: extra.introText, margin: [0, 4, 0, 10] } : { text: '', margin: [0, 4, 0, 0] },
      {
        table: { headerRows: 1, widths, body, dontBreakRows: true },
        layout: {
          hLineWidth: (i: number, node: any) => (i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0.3),
          vLineWidth: () => 0,
          hLineColor: () => LINE,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
      {
        margin: [0, 10, 0, 0],
        columns: [
          { width: '*', text: '' },
          {
            width: 'auto',
            table: { widths: ['auto', 90], body: totals.map(([k, v]) => [k, typeof v === 'string' ? { text: v, alignment: 'right' } : { ...v, alignment: 'right' }]) },
            layout: {
              hLineWidth: (i: number, node: any) => (i === node.table.body.length - 1 ? 0.7 : 0),
              vLineWidth: () => 0,
              hLineColor: () => '#333',
            },
          },
        ],
      },
      inv.taxRateBp === 0 && inv.taxExemptNote ? { text: inv.taxExemptNote, margin: [0, 12, 0, 0], italics: true } : { text: '' },
      inv.notes ? { text: inv.notes, margin: [0, 12, 0, 0] } : { text: '' },
      { text: paymentText, margin: [0, 16, 0, 0] },
      !isStorno && s.iban
        ? { text: `Bankverbindung: ${[s.bankName, s.iban && `IBAN ${s.iban}`, s.bic && `BIC ${s.bic}`].filter(Boolean).join(' · ')}`, margin: [0, 4, 0, 0] }
        : { text: '' },
      s.footer ? { text: s.footer, margin: [0, 16, 0, 0], color: GREY } : { text: '' },
    ],
  };
  return pdfmake.createPdf(doc).getBuffer();
}
