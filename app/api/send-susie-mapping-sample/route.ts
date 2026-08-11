import { NextResponse } from "next/server";

const TARGET = "https://services.leadconnectorhq.com/hooks/QLS1wvtsvzL1YsLFxYcM/webhook-trigger/755b174e-111d-4a3a-956f-36dc9c2f4a14";

export async function GET() {
  const payload = {
    submission_id: `mapping-test-${Date.now()}`,
    submitted_at: new Date().toISOString(),
    first_name: "Mapping",
    last_name: "Test",
    full_name: "Mapping Test",
    email: "mapping-test@example.com",
    phone: "+14805550123",
    consent: "Yes",
    interest: "Body Reset Evaluation",
    symptoms: "bloating, soreness",
    previously_tried: "massage, stretching",
    goals: "reduce inflammation, feel better",
    priority: "high",
    urgency: "soon",
    preferred_next_step: "book consultation",
    recommended_treatment: "Lymphatic Wellness",
    recommendation_key: "lymphatic",
    recommendation_reasons: "sample payload for HighLevel mapping",
    score_summary: "mapping test",
    lead_stage: "Quiz Completed",
    funnel_path: "Smart Body Reset Evaluation Lead-First Funnel",
    source: "website-evaluation",
    page: "/body-reset",
    firstName: "Mapping",
    lastName: "Test",
    fullName: "Mapping Test",
    previouslyTried: "massage, stretching",
    preferredNextStep: "book consultation",
    recommendedTreatment: "Lymphatic Wellness",
    recommendationKey: "lymphatic",
    recommendationReasons: "sample payload for HighLevel mapping",
    scoreSummary: "mapping test",
    leadStage: "Quiz Completed",
    funnelPath: "Smart Body Reset Evaluation Lead-First Funnel",
    raw_payload: "mapping test"
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
