import { isDiningBenefitCredit } from "./dining-credits";
import type { DashboardData } from "./workspace-types";

export function refundMatchingReviews(dashboard: DashboardData) {
  return (dashboard.refundReviews ?? []).filter(refund => refund.remaining > 0
    && !isDiningBenefitCredit({ kind: "refund", description: refund.description })
    && dashboard.activity.some(entry => entry.id === refund.id));
}

export function obligationMatchingReviews(dashboard: DashboardData) {
  return dashboard.obligations.filter(obligation => obligation.active && obligation.suggestion);
}

export function openReviewCount(dashboard: DashboardData) {
  return dashboard.reviews.length + refundMatchingReviews(dashboard).length + obligationMatchingReviews(dashboard).length;
}
