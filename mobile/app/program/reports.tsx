import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { ar } from '../../src/copy/ar';
import { useTheme } from '../../src/theme/ThemeContext';
import { usePatientProfile } from '../../src/patient/PatientProfileProvider';
import { ErrorBanner } from '../../src/components/ErrorBanner';
import { ApiError } from '../../src/api/client';
import {
  getAssessmentResultsReport,
  getMedicalReport,
  AssessmentResult,
  MedicalReport,
} from '../../src/api/reports';

function typeLabel(type: AssessmentResult['type']): string {
  return ar.reports.types[type];
}

function statusLabel(status: AssessmentResult['status']): string {
  return ar.reports.statuses[status];
}

function severityLabel(severity: AssessmentResult['severityCategory']): string {
  return severity ? ar.reports.severities[severity] : ar.reports.notAvailable;
}

export default function ReportsScreen() {
  const { tokens } = useTheme();
  const { patientProfileId } = usePatientProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessments, setAssessments] = useState<AssessmentResult[]>([]);
  const [medicalReport, setMedicalReport] = useState<MedicalReport | null>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [assessmentResults, medical] = await Promise.all([
        getAssessmentResultsReport(id),
        getMedicalReport(id),
      ]);
      const sorted = [...assessmentResults.assessments].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setAssessments(sorted);
      setMedicalReport(medical);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (patientProfileId) {
      load(patientProfileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientProfileId]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <Text style={{ color: tokens.colors.text }}>{ar.program.loading}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <ErrorBanner message={error} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: tokens.colors.background }} contentContainerStyle={styles.scrollContent}>
      <Text style={[styles.title, { color: tokens.colors.text }]}>{ar.reports.title}</Text>

      <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.reports.assessmentResultsTitle}</Text>
      {assessments.length === 0 ? (
        <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.reports.noAssessmentsYet}</Text>
      ) : (
        assessments.map((assessment) => (
          <View key={assessment.id} style={[styles.card, { borderColor: tokens.colors.border }]}>
            <Text style={{ color: tokens.colors.text }}>
              {ar.reports.assessmentTypeLabel}: <Text>{typeLabel(assessment.type)}</Text>
            </Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.reports.assessmentStatusLabel}: <Text>{statusLabel(assessment.status)}</Text>
            </Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.reports.severityLabel}: <Text>{severityLabel(assessment.severityCategory)}</Text>
            </Text>
            <Text style={{ color: tokens.colors.text }}>
              {ar.reports.ssi4TotalLabel}: <Text>{assessment.ssi4Total ?? ar.reports.notAvailable}</Text>
            </Text>
            <Text style={{ color: tokens.colors.textSecondary }}>
              {ar.reports.approvedAtLabel}: <Text>{assessment.approvedAt ?? ar.reports.notApprovedYet}</Text>
            </Text>
          </View>
        ))
      )}

      {medicalReport ? (
        <View style={{ marginTop: 24 }}>
          <Text style={[styles.sectionTitle, { color: tokens.colors.text }]}>{ar.reports.medicalReportTitle}</Text>
          <Text style={{ color: tokens.colors.text, marginBottom: 8 }}>
            {ar.reports.patientNameLabel}: <Text>{medicalReport.patientFullName}</Text>
          </Text>

          {medicalReport.clinicalInfo ? (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.referralReasonLabel}: <Text>{medicalReport.clinicalInfo.referralReason ?? ar.reports.notAvailable}</Text>
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.initialDiagnosisLabel}: <Text>{medicalReport.clinicalInfo.initialDiagnosis ?? ar.reports.notAvailable}</Text>
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.medicalHistoryLabel}: <Text>{medicalReport.clinicalInfo.medicalHistory ?? ar.reports.notAvailable}</Text>
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.medicationsLabel}: <Text>{medicalReport.clinicalInfo.medications ?? ar.reports.notAvailable}</Text>
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.allergiesLabel}: <Text>{medicalReport.clinicalInfo.allergies ?? ar.reports.notAvailable}</Text>
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.familyHistoryLabel}: <Text>{medicalReport.clinicalInfo.familyHistory ?? ar.reports.notAvailable}</Text>
              </Text>
            </View>
          ) : (
            <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.reports.noClinicalInfo}</Text>
          )}

          <Text style={[styles.subSectionTitle, { color: tokens.colors.text }]}>{ar.reports.latestAssessmentTitle}</Text>
          {medicalReport.latestApprovedAssessment ? (
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.assessmentTypeLabel}: <Text>{typeLabel(medicalReport.latestApprovedAssessment.type)}</Text>
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.severityLabel}: <Text>{severityLabel(medicalReport.latestApprovedAssessment.severityCategory)}</Text>
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.ssi4TotalLabel}: <Text>{medicalReport.latestApprovedAssessment.ssi4Total ?? ar.reports.notAvailable}</Text>
              </Text>
              <Text style={{ color: tokens.colors.textSecondary }}>
                {ar.reports.approvedAtLabel}: <Text>{medicalReport.latestApprovedAssessment.approvedAt ?? ar.reports.notApprovedYet}</Text>
              </Text>
            </View>
          ) : (
            <Text style={{ color: tokens.colors.textSecondary, marginBottom: 16 }}>{ar.reports.noApprovedAssessment}</Text>
          )}

          <Text style={[styles.subSectionTitle, { color: tokens.colors.text }]}>{ar.reports.activePlanTitle}</Text>
          {medicalReport.activeTreatmentPlan ? (
            <View>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.goalsLabel}: <Text>{medicalReport.activeTreatmentPlan.goals}</Text>
              </Text>
              <Text style={{ color: tokens.colors.text }}>
                {ar.reports.reviewDateLabel}: <Text>{medicalReport.activeTreatmentPlan.reviewDate}</Text>
              </Text>
            </View>
          ) : (
            <Text style={{ color: tokens.colors.textSecondary }}>{ar.reports.noActivePlan}</Text>
          )}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scrollContent: { padding: 24 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  subSectionTitle: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8, gap: 2 },
});
