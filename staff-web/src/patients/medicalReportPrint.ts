import type { MedicalReport } from '../api/reports';
import { ar } from '../copy/ar';

type ArCopy = typeof ar;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ar-SA');
}

function row(label: string, value: string | null | undefined): string {
  const shown = value && value.trim() ? escapeHtml(value) : '—';
  return `<tr><th>${escapeHtml(label)}</th><td>${shown}</td></tr>`;
}

/**
 * Builds a standalone, self-contained RTL Arabic HTML document for the patient's
 * medical report. Kept pure (no DOM/window access) so it is unit-testable; the
 * browser's own "Save as PDF" print destination turns it into the PDF the spec
 * asks for (MVP-FR-009 / SCR-011 — "تنزيل PDF / طباعة"). We deliberately print
 * from the browser rather than generating the PDF server-side: the report is
 * Arabic RTL, and the browser already shapes/bidis the text correctly, which
 * server-side PDF libraries handle poorly.
 *
 * All patient-entered free text is HTML-escaped before interpolation.
 */
export function buildMedicalReportHtml(report: MedicalReport, copy: ArCopy): string {
  const r = copy.reports;
  const pd = copy.patientDetail;

  const clinical = report.clinicalInfo
    ? `<table class="kv">
        ${row(r.referralReasonLabel, report.clinicalInfo.referralReason)}
        ${row(r.initialDiagnosisLabel, report.clinicalInfo.initialDiagnosis)}
        ${row(r.medicalHistoryLabel, report.clinicalInfo.medicalHistory)}
        ${row(r.medicationsLabel, report.clinicalInfo.medications)}
        ${row(r.allergiesLabel, report.clinicalInfo.allergies)}
        ${row(r.familyHistoryLabel, report.clinicalInfo.familyHistory)}
      </table>`
    : `<p class="empty">${escapeHtml(r.noClinicalInfo)}</p>`;

  const assessment = report.latestApprovedAssessment
    ? `<table class="kv">
        ${row(r.assessmentTypeLabel, pd.assessmentTypes[report.latestApprovedAssessment.type] ?? report.latestApprovedAssessment.type)}
        ${row(r.severityCategoryLabel, report.latestApprovedAssessment.severityCategory ? (pd.severityCategories[report.latestApprovedAssessment.severityCategory] ?? report.latestApprovedAssessment.severityCategory) : '—')}
        ${row(r.ssi4TotalLabel, report.latestApprovedAssessment.ssi4Total != null ? String(report.latestApprovedAssessment.ssi4Total) : '—')}
        ${row(r.approvedAtLabel, report.latestApprovedAssessment.approvedAt ? formatDate(report.latestApprovedAssessment.approvedAt) : '—')}
      </table>`
    : `<p class="empty">${escapeHtml(r.noLatestAssessment)}</p>`;

  const plan = report.activeTreatmentPlan
    ? `<table class="kv">
        ${row(pd.phaseLabel, pd.phases[report.activeTreatmentPlan.phase] ?? report.activeTreatmentPlan.phase)}
        ${row(pd.goalsLabel, report.activeTreatmentPlan.goals)}
        ${row(pd.reviewDateLabel, report.activeTreatmentPlan.reviewDate ? formatDate(report.activeTreatmentPlan.reviewDate) : '—')}
      </table>`
    : `<p class="empty">${escapeHtml(r.noActivePlanForReport)}</p>`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(r.medicalReportTitle)} — ${escapeHtml(report.patientFullName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1a1a1a; margin: 32px; line-height: 1.6; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid #2f6fed; padding-bottom: 4px; color: #2f6fed; }
  .meta { color: #555; font-size: 13px; margin-bottom: 16px; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv th { text-align: right; width: 200px; vertical-align: top; padding: 6px 8px; color: #444; font-weight: 600; background: #f5f7fb; border: 1px solid #e2e6ee; }
  table.kv td { padding: 6px 8px; border: 1px solid #e2e6ee; white-space: pre-wrap; }
  .empty { color: #888; font-style: italic; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
  @media print { body { margin: 12mm; } h2 { break-after: avoid; } }
</style>
</head>
<body>
  <h1>${escapeHtml(r.medicalReportTitle)}</h1>
  <div class="meta">
    <div><strong>${escapeHtml(r.fullNameLabel)}:</strong> ${escapeHtml(report.patientFullName)}</div>
    <div><strong>${escapeHtml(r.reportGeneratedAtLabel)}:</strong> ${escapeHtml(new Date().toLocaleDateString('ar-SA'))}</div>
  </div>

  <h2>${escapeHtml(r.medicalReportTitle)}</h2>
  ${clinical}

  <h2>${escapeHtml(r.latestAssessmentTitle)}</h2>
  ${assessment}

  <h2>${escapeHtml(r.activePlanTitle)}</h2>
  ${plan}

  <footer>${escapeHtml(r.reportFooterNote)}</footer>
</body>
</html>`;
}

/**
 * Opens the printable report in a new window and triggers the browser's print
 * dialog (whose "Save as PDF" destination produces the downloadable PDF). Thin
 * DOM wrapper around buildMedicalReportHtml — the testable logic lives there.
 */
export function printMedicalReport(report: MedicalReport, copy: ArCopy = ar): void {
  const html = buildMedicalReportHtml(report, copy);
  const win = window.open('', '_blank');
  if (!win) {
    return; // popup blocked — caller shows a message
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the new document a tick to lay out before invoking print.
  win.setTimeout(() => win.print(), 250);
}
