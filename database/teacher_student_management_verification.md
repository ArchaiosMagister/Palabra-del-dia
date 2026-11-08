# Teacher student management verification — 2026-11-08

Implemented in index.html and 4eso/index.html on main. Supabase project rzjemisvaaqpnvvgfntl.

## Security and behavior
- Teacher authorization is checked against teacher_admins on every manage_student call; no editable user metadata is used.
- Create and rotate use pgcrypto gen_random_bytes(24), producing 192 random bits. Only SHA-256 hashes are stored. Plaintext codes are returned once and held only in the current page.
- Rotation preserves student IDs and votes, clears auth_user_id, and replaces the old hash.
- Browser roles cannot read invite_code_hash. Direct browser writes are restricted to display_name and still require teacher RLS.
- claim-student-code validates the JWT with getUser and uses a service-role-only atomic claim RPC. A row lock serializes claiming with rotation. Existing bearer-code re-login behavior is retained.
- A teacher session cannot claim a student code.
- Fixed an existing undefined variable in teacher login's finally block.
- Preserved concurrent theme-selector changes.

## Checks passed
- JavaScript syntax in both HTML pages.
- Authenticated nonteacher denied management.
- Authenticated role denied hash reads and internal claim RPC.
- Teacher create, rename, rotate, generated-code format and stored hash.
- Valid claim links a student; rotation clears the link; old code rejected; replacement code accepted.
- Tests ran inside transactions and rolled back all fixtures.
- Before/after checksums of all existing student rows and both ranking datasets matched. 43 student rows retained. The votes table contained zero rows before this work and remains unchanged.
- GitHub contents read back exactly matched submitted HTML.
- Both public GitHub Pages URLs served bytes matching their GitHub blob SHAs:
  index.html: 4c3eedc613d099eec506a1ea93e3f78cc52b0a12
  4eso/index.html: 2404f5ada7c91c9fa93d8b723ff811afb38d9389
- Edge Function claim-student-code deployed ACTIVE version 2 with verify_jwt enabled.

## Advisory context and limits
Supabase still flags authenticated SECURITY DEFINER functions: manage_student intentionally uses this privilege with an explicit teacher check, empty search_path, fully qualified objects and revoked PUBLIC/anon execution. review_word_proposal already existed.
Anonymous Auth sessions are the existing code-login design; teacher membership/row ownership predicates supply authorization. No-policy RLS on teacher_codes and the legacy votos_palabras table intentionally denies client access. Leaked-password protection remains an existing Auth setting warning.
Advisory references: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable and https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins
No interactive browser test using the owner's actual teacher code was performed; authorization and lifecycle tests used transaction-scoped database role/session fixtures.
