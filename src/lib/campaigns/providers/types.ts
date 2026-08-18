export type CampaignProviderId = "meta" | "ycloud";

export type NormalizedTemplateRow = {
  provider_template_id: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components_json: unknown[];
  variable_schema_json: Record<string, unknown>;
  provider_payload_json: Record<string, unknown>;
};
