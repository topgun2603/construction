-- Cost codes were built beside the full audit log, so their tables are attached here, after both.
-- Budgets are money: who moved a line's budget, and from what, is exactly what the log is for.
SELECT audit_attach('cost_codes');
SELECT audit_attach('cost_code_templates');
SELECT audit_attach('cost_code_template_items');
