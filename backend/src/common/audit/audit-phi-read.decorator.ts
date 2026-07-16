import { SetMetadata } from '@nestjs/common';

export const AUDIT_PHI_READ_KEY = 'auditPhiRead';

// Marks a GET route as resolving PHI (a specific patient's clinical profile,
// or their speech-sample recordings) so AuditInterceptor logs who accessed it
// and when — GET requests are otherwise never logged. Deliberately opt-in per
// route rather than a blanket "log every GET": most GETs in this app (health
// checks, the exercise library, a staff member's own /auth/me) carry no PHI,
// and logging every one of them would bury the routes that actually matter
// for an incident investigation ("who viewed this patient's data") in noise.
export const AuditPhiRead = () => SetMetadata(AUDIT_PHI_READ_KEY, true);
