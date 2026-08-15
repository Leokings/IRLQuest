-- The project-level RLS event trigger only needs to run as an event trigger.
-- It must not be exposed as a callable Data API function.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
