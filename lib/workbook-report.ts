import type { Workbook, Worksheet } from "exceljs";
import type { DeliverySummary } from "./delivery-report";
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" });
export const reportDate = (value: string | null) => value ? date.format(new Date(value)) : "Sin registros";
export function styleHeader(sheet: Worksheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF103B48" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}
export function fillSummaryWorkbook(workbook: Workbook, summary: DeliverySummary) {
  const sheet = workbook.addWorksheet("Totales por mesa");
  sheet.columns = [{ header: "Mesa", key: "mesa", width: 24 }, { header: "Tinacos entregados", key: "total", width: 24 }];
  summary.porMesa.forEach(row => sheet.addRow({ mesa: "Mesa " + row.mesa, total: row.total }));
  sheet.addRow({ mesa: "TOTAL GENERAL", total: summary.porMesa.reduce((sum, row) => sum + row.total, 0) }).font = { bold: true };
  styleHeader(sheet); sheet.autoFilter = "A1:B17";
}
