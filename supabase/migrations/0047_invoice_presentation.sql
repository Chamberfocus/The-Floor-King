-- Floor King CRM — invoices can present as itemized (line by line) or as a
-- lump sum ("ball of wax"), same as estimates. Backward compatible: existing
-- invoices default to 'detailed' (current itemized behavior). Safe to re-run.

alter table public.invoices
  add column if not exists presentation public.estimate_presentation
  not null default 'detailed';
