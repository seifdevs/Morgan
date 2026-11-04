export type PlanId = 'starter' | 'pro' | 'max';
export type Plan = { id: PlanId; name: string; monthlyCents: number; annualCents: number; limits: { workspaces: number; seats: number; financialRecords: number; forecastDays: number; scenariosPerWorkspace: number; intelligenceRequests: number; pdfReports: number }; monitor: 'core'|'full' };
declare const plans: Record<PlanId, Plan>;
export default plans;
