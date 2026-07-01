-- Floor King CRM — add "Installer pick-up" as a material handling option,
-- alongside Cash & Carry, Deliver to site, and Deliver for acclimation.
-- Safe to re-run.

alter type public.job_delivery add value if not exists 'installer_pickup';
