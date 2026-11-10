-- Supabase also serves the public schema over its Data API. The app connects as the role that owns
-- these tables, and row level security doesn't restrict a table's owner, so switching it on with no
-- policies closes that API without changing anything for the app. New tables need the same line.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = current_schema() loop
    execute format('alter table %I enable row level security', t.tablename);
  end loop;
end $$;
