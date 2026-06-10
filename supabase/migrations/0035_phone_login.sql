-- Allow employees to sign in with phone + PIN. Phones are stored as digits on
-- the profile; one phone can map to at most one login.
create unique index if not exists profiles_phone_unique
  on public.profiles (phone)
  where phone is not null and phone <> '';
