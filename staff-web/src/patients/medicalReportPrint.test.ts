import { buildMedicalReportHtml } from './medicalReportPrint';
import { ar } from '../copy/ar';
import type { MedicalReport } from '../api/reports';

const fullReport: MedicalReport = {
  patientProfileId: 'p1',
  patientFullName: 'محمد الأحمد',
  clinicalInfo: {
    referralReason: 'إحالة من مدرسة',
    initialDiagnosis: 'تلعثم متوسط',
    medicalHistory: 'لا يوجد',
    medications: 'لا يوجد',
    allergies: 'لا يوجد',
    familyHistory: 'والد لديه تلعثم',
  },
  latestApprovedAssessment: {
    id: 'a1',
    type: 'INITIAL',
    severityCategory: 'MODERATE',
    ssi4Total: 22,
    approvedAt: '2026-06-01T00:00:00.000Z',
  },
  activeTreatmentPlan: {
    id: 'plan1',
    phase: 'PHASE_1',
    goals: 'تحسين الطلاقة في الجمل القصيرة',
    reviewDate: '2026-12-01T00:00:00.000Z',
  },
};

describe('buildMedicalReportHtml', () => {
  it('produces an RTL Arabic document with the report title and patient name', () => {
    const html = buildMedicalReportHtml(fullReport, ar);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain(ar.reports.medicalReportTitle);
    expect(html).toContain('محمد الأحمد');
  });

  it('includes the clinical info, latest approved assessment, and active plan content', () => {
    const html = buildMedicalReportHtml(fullReport, ar);
    expect(html).toContain('إحالة من مدرسة');
    expect(html).toContain('تلعثم متوسط');
    expect(html).toContain('والد لديه تلعثم');
    expect(html).toContain('22'); // ssi4Total
    expect(html).toContain('تحسين الطلاقة في الجمل القصيرة');
    // Arabic labels for the coded enum values, not the raw codes
    expect(html).toContain(ar.patientDetail.assessmentTypes.INITIAL);
    expect(html).toContain(ar.patientDetail.severityCategories.MODERATE);
    expect(html).not.toContain('MODERATE');
  });

  it('renders the empty-state messages when sections are missing, without crashing', () => {
    const empty: MedicalReport = {
      patientProfileId: 'p2',
      patientFullName: 'سارة',
      clinicalInfo: null,
      latestApprovedAssessment: null,
      activeTreatmentPlan: null,
    };
    const html = buildMedicalReportHtml(empty, ar);
    expect(html).toContain('سارة');
    expect(html).toContain(ar.reports.noClinicalInfo);
    expect(html).toContain(ar.reports.noLatestAssessment);
    expect(html).toContain(ar.reports.noActivePlanForReport);
  });

  it('escapes HTML in patient-entered free text so it cannot inject markup', () => {
    const malicious: MedicalReport = {
      ...fullReport,
      clinicalInfo: { ...fullReport.clinicalInfo!, referralReason: '<script>alert(1)</script>' },
    };
    const html = buildMedicalReportHtml(malicious, ar);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
