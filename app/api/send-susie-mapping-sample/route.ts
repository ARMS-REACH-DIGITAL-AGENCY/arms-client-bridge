import { NextResponse } from "next/server";

const TARGET = "https://services.leadconnectorhq.com/hooks/QLS1wvtsvzL1YsLFxYcM/webhook-trigger/b5ab78ed-4b64-4c63-ae6e-90d591e468c0";

export async function GET() {
  const payload = {
    submission_id: `direct-webhook-test-${Date.now()}`,
    submitted_at: new Date().toISOString(),
    first_name: "Direct",
    last_name: "Webhook Test",
    full_name: "Direct Webhook Test",
    email: "direct-webhook-test@example.com",
    phone: "+14805550124",
    consent: "Yes",
    interest: "Body Reset Evaluation",
    symptoms: "test symptoms",
    previously_tried: "test prior treatment",
    goals: "verify inbound webhook",
    priority: "high",
    urgency: "soon",
    preferred_next_step: "book consultation",
    recommended_treatment: "Lymphatic Wellness",
    recommendation_key: "lymphatic",
    recommendation_reasons: "direct POST test of current HighLevel trigger",
    score_summary: "direct webhook verification",
    lead_stage: "Quiz Completed",
    funnel_path: "Smart Body Reset Evaluation Lead-First Funnel",
    source: "direct-webhook-verification",
    page: "/body-reset",
    firstName: "Direct",
    lastName: "Webhook Test",
    fullName: "Direct Webhook Test",
    previouslyTried: "test prior treatment",
    preferredNextStep: "book consultation",
    recommendedTreatment: "Lymphatic Wellness",
    recommendationKey: "lymphatic",
    recommendationReasons: "direct POST test of current HighLevel trigger",
    scoreSummary: "direct webhook verification",
    leadStage: "Quiz Completed",
    funnelPath: "Smart Body Reset Evaluation Lead-First Funnel",
    raw_payload: "direct webhook verification"
  };

  const response = await fetch(TARGET, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await response.text();
  return NextResponse.json({ ok: response.ok, status: response.status, response: text.slice(0, 2000), submission_id: payload.submission_id }, { status: response.ok ? 200 : 502 });
}
